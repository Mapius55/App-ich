// Supabase Edge Function: the AI coach.
// Receives one turn from the app, talks to Claude (streaming), runs the
// coach's tools against the person's own rows (Row Level Security applies,
// because we act with their JWT), and streams events back as SSE.
//
// Secrets (set with `supabase secrets set`): ANTHROPIC_API_KEY.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import { contextBlock, MODE_CHECKIN, MODE_ONBOARDING, MODE_TIDY, PERSONA } from "./prompt.ts";
import { zonedToUtc } from "../_shared/ics.ts";

const MODEL = "claude-opus-5-5";
// Conversation, not heavy reasoning: low effort keeps replies quick on the phone.
const EFFORT = "low" as const;
const MAX_TOOL_ROUNDS = 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATEGORIES = ["person", "arbeit", "werte", "rhythmus", "ziel", "termin", "ort", "natur", "anderes"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type Ev = Record<string, unknown> & { type: string };

interface ReqBody {
  mode: "onboarding" | "checkin" | "tidy";
  thread: string;
  message?: string;
  context: { day: string; localTime: string; timezone: string; season: string; phase: string; weather?: string; hasLocation: boolean };
}

function parseBody(raw: unknown): ReqBody {
  const b = raw as Partial<ReqBody>;
  if (b?.mode !== "onboarding" && b?.mode !== "checkin" && b?.mode !== "tidy") throw new Error("mode");
  if (typeof b.thread !== "string" || !(b.thread === "onboarding" || DATE_RE.test(b.thread))) throw new Error("thread");
  if (b.message !== undefined && (typeof b.message !== "string" || b.message.length > 4000)) throw new Error("message");
  const c = b.context;
  if (!c || typeof c.localTime !== "string" || !DATE_RE.test(String(c.day))) throw new Error("context");
  const s = (v: unknown, n = 120) => String(v ?? "").slice(0, n);
  return {
    mode: b.mode,
    thread: b.thread,
    message: b.message?.trim() || undefined,
    context: {
      day: c.day,
      localTime: s(c.localTime),
      timezone: s(c.timezone, 60),
      season: s(c.season, 30),
      phase: s(c.phase, 40),
      weather: c.weather ? s(c.weather, 80) : undefined,
      hasLocation: !!c.hasLocation,
    },
  };
}

// ---------- Tools ----------
// eager_input_streaming streams tool input as it's generated; the SDK's parser
// is tolerant, so every input is validated here before it touches the database.

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "remember",
    description: "Speichert eine bleibende Erinnerung über die Person (sichtbar und bearbeitbar auf ihrer Seite „Was ich über dich weiss“).",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Ein Gedanke, kurz, dritte Person, ohne Namen." },
        category: { type: "string", enum: [...CATEGORIES] },
        event_date: { type: "string", description: "YYYY-MM-DD, nur bei Terminen/Rennen/Ereignissen." },
      },
      required: ["content", "category"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_memory",
    description: "Ändert eine bestehende Erinnerung (id aus dem Kontext).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        content: { type: "string" },
        event_date: { type: "string", description: "YYYY-MM-DD oder leer, um das Datum zu entfernen." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "forget",
    description: "Löscht eine Erinnerung, die nicht mehr stimmt oder die die Person nicht gespeichert haben möchte.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "set_mood",
    description: "Hält fest, wie es der Person heute geht. Färbt den Kreis.",
    input_schema: {
      type: "object",
      properties: {
        valence: { type: "number", description: "-1 (schwer) bis 1 (leicht/froh)" },
        energy: { type: "number", description: "0 (müde) bis 1 (voller Energie)" },
        word: { type: "string", description: "Ein Wort, z.B. „ruhig“, „müde“, „voller Vorfreude“." },
      },
      required: ["valence", "energy", "word"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "set_day_focus",
    description: "Setzt den Fokus für heute, der unter dem Kreis angezeigt wird.",
    input_schema: { type: "object", properties: { focus: { type: "string" } }, required: ["focus"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "set_nature_palette",
    description: "Setzt fünf Farben aus der Lieblingsnatur der Person; sie fliessen in den Kreis ein.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Kurzer Name, z.B. „Bergsee im Engadin“." },
        colors: { type: "array", items: { type: "string", description: "#rrggbb" }, minItems: 3, maxItems: 5 },
      },
      required: ["name", "colors"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_profile",
    description: "Aktualisiert den Namen, mit dem du die Person ansprichst, oder ihren Wohnort.",
    input_schema: {
      type: "object",
      properties: { display_name: { type: "string" }, location_name: { type: "string" } },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "create_event",
    description:
      "Trägt einen Termin direkt in den Kalender „I am“ auf dem iPhone der Person ein (Rennen, Training, Treffen, Prüfung …). Zeiten in der lokalen Zeit der Person.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Kurz, z.B. „Halbmarathon Zürich“." },
        start: { type: "string", description: "YYYY-MM-DDTHH:MM (lokal) oder YYYY-MM-DD für ganztägig." },
        end: { type: "string", description: "Optional, gleiches Format wie start." },
        location: { type: "string" },
        notes: { type: "string" },
        reminder_minutes: {
          type: "integer",
          description: "Erinnerung so viele Minuten vorher (Standard 30). Bei ganztägigen Terminen weglassen (dann 8 Uhr am Tag).",
        },
      },
      required: ["title", "start"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_event",
    description: "Ändert einen Termin im Kalender „I am“ (id aus dem Kontext).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        location: { type: "string" },
        notes: { type: "string" },
        reminder_minutes: { type: "integer" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "delete_event",
    description: "Löscht einen Termin aus dem Kalender „I am“, z.B. wenn er abgesagt wurde.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "request_location",
    description: "Zeigt in der App einen Knopf, um den Standort freizugeben (für Wetter und Sonnenuntergang in den Farben).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "finish_onboarding",
    description: "Beendet das Kennenlernen. Nur aufrufen, wenn du genug über die Person weisst.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "3–5 Sätze: wer die Person ist, was ihr wichtig ist, worauf sie hinarbeitet." },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

class ToolInputError extends Error {}

const str = (v: unknown, max: number, field: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new ToolInputError(`${field} fehlt`);
  return v.trim().slice(0, max);
};
const num = (v: unknown, min: number, max: number, field: string): number => {
  if (typeof v !== "number" || Number.isNaN(v)) throw new ToolInputError(`${field} muss eine Zahl sein`);
  return Math.max(min, Math.min(max, v));
};
const optDate = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v)) throw new ToolInputError("event_date muss YYYY-MM-DD sein");
  return v;
};

async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { sb: SupabaseClient; userId: string; day: string; tz: string; mode: ReqBody["mode"]; send: (e: Ev) => void },
): Promise<string> {
  const { sb, userId, day, send } = ctx;
  switch (name) {
    case "remember": {
      const category = String(input.category);
      if (!(CATEGORIES as readonly string[]).includes(category)) throw new ToolInputError("unbekannte Kategorie");
      const row = { user_id: userId, content: str(input.content, 2000, "content"), category, event_date: optDate(input.event_date) ?? null, source: "coach" };
      const { data, error } = await sb.from("memories").insert(row).select().single();
      if (error) throw error;
      send({ type: "memory", memory: data });
      return JSON.stringify({ ok: true, id: data.id });
    }
    case "update_memory": {
      const id = str(input.id, 64, "id");
      const patch: Record<string, unknown> = {};
      if (input.content !== undefined) patch.content = str(input.content, 2000, "content");
      const d = optDate(input.event_date);
      if (d !== undefined) patch.event_date = d;
      if (!Object.keys(patch).length) throw new ToolInputError("nichts zu ändern");
      let q = sb.from("memories").update(patch).eq("id", id);
      // While tidying up on its own, the coach only touches its own notes, never what the person wrote or confirmed.
      if (ctx.mode === "tidy") q = q.eq("source", "coach");
      const { data, error } = await q.select().maybeSingle();
      if (error) throw error;
      if (!data) throw new ToolInputError("Erinnerung nicht gefunden");
      send({ type: "memory_updated", memory: data });
      return JSON.stringify({ ok: true });
    }
    case "forget": {
      const id = str(input.id, 64, "id");
      let q = sb.from("memories").delete().eq("id", id);
      if (ctx.mode === "tidy") q = q.eq("source", "coach");
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data?.length) throw new ToolInputError(ctx.mode === "tidy" ? "selbst eingetragen – bitte stehen lassen" : "Erinnerung nicht gefunden");
      send({ type: "memory_deleted", id });
      return JSON.stringify({ ok: true });
    }
    case "set_mood": {
      const mood = {
        valence: num(input.valence, -1, 1, "valence"),
        energy: num(input.energy, 0, 1, "energy"),
        word: str(input.word, 40, "word"),
      };
      const { error } = await sb.from("days").upsert({ user_id: userId, day, mood, updated_at: new Date().toISOString() }, { onConflict: "user_id,day" });
      if (error) throw error;
      send({ type: "mood", mood });
      return JSON.stringify({ ok: true });
    }
    case "set_day_focus": {
      const focus = str(input.focus, 120, "focus");
      const { error } = await sb.from("days").upsert({ user_id: userId, day, focus, updated_at: new Date().toISOString() }, { onConflict: "user_id,day" });
      if (error) throw error;
      send({ type: "focus", focus });
      return JSON.stringify({ ok: true });
    }
    case "set_nature_palette": {
      const colors = Array.isArray(input.colors) ? input.colors.filter((c): c is string => typeof c === "string" && HEX_RE.test(c)).slice(0, 5) : [];
      if (colors.length < 3) throw new ToolInputError("mindestens 3 Farben im Format #rrggbb");
      const nature = { name: str(input.name, 60, "name"), colors };
      const { error } = await sb.from("profiles").update({ nature_palette: nature }).eq("id", userId);
      if (error) throw error;
      send({ type: "palette", nature });
      return JSON.stringify({ ok: true });
    }
    case "update_profile": {
      const patch: Record<string, string> = {};
      if (input.display_name !== undefined) patch.display_name = str(input.display_name, 60, "display_name");
      if (input.location_name !== undefined) patch.location_name = str(input.location_name, 80, "location_name");
      if (!Object.keys(patch).length) throw new ToolInputError("nichts zu ändern");
      const { error } = await sb.from("profiles").update(patch).eq("id", userId);
      if (error) throw error;
      send({ type: "profile", profile: patch });
      return JSON.stringify({ ok: true });
    }
    case "create_event":
    case "update_event": {
      const row: Record<string, unknown> = {};
      const when = (v: unknown, field: string) => {
        const txt = str(v, 20, field);
        try {
          return { iso: zonedToUtc(txt, ctx.tz), allDay: !txt.includes("T") };
        } catch {
          throw new ToolInputError(`${field}: YYYY-MM-DDTHH:MM oder YYYY-MM-DD`);
        }
      };
      if (input.title !== undefined) row.title = str(input.title, 200, "title");
      if (input.start !== undefined) {
        const s0 = when(input.start, "start");
        row.starts_at = s0.iso;
        row.all_day = s0.allDay;
        if (s0.allDay && input.reminder_minutes === undefined && name === "create_event") row.reminder_minutes = -480; // 08:00 that day
      }
      if (input.end !== undefined) row.ends_at = when(input.end, "end").iso;
      if (input.location !== undefined) row.location = str(input.location, 200, "location");
      if (input.notes !== undefined) row.notes = str(input.notes, 2000, "notes");
      if (input.reminder_minutes !== undefined) row.reminder_minutes = Math.round(num(input.reminder_minutes, 0, 10080, "reminder_minutes"));
      if (name === "create_event") {
        if (!row.title || !row.starts_at) throw new ToolInputError("title und start sind nötig");
        if (row.reminder_minutes === undefined) row.reminder_minutes = 30;
        const { data, error } = await sb.from("events").insert({ ...row, user_id: userId, source: "coach" }).select().single();
        if (error) throw error;
        send({ type: "event_created", event: data });
        return JSON.stringify({ ok: true, id: data.id });
      }
      const id = str(input.id, 64, "id");
      if (!Object.keys(row).length) throw new ToolInputError("nichts zu ändern");
      const { data, error } = await sb.from("events").update(row).eq("id", id).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new ToolInputError("Termin nicht gefunden");
      send({ type: "event_updated", event: data });
      return JSON.stringify({ ok: true });
    }
    case "delete_event": {
      const id = str(input.id, 64, "id");
      const { data, error } = await sb.from("events").delete().eq("id", id).select("id, title");
      if (error) throw error;
      if (!data?.length) throw new ToolInputError("Termin nicht gefunden");
      send({ type: "event_deleted", id, title: data[0].title });
      return JSON.stringify({ ok: true });
    }
    case "request_location": {
      send({ type: "request_location" });
      return JSON.stringify({ ok: true, note: "Die App zeigt jetzt den Knopf zum Freigeben." });
    }
    case "finish_onboarding": {
      if (ctx.mode !== "onboarding") throw new ToolInputError("nur im Kennenlernen");
      const summary = str(input.summary, 1500, "summary");
      const { error } = await sb.from("profiles").update({ summary, onboarded: true }).eq("id", userId);
      if (error) throw error;
      send({ type: "onboarding_done" });
      return JSON.stringify({ ok: true });
    }
    default:
      throw new ToolInputError(`unbekanntes Werkzeug ${name}`);
  }
}

// ---------- Request handler ----------

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  const auth = req.headers.get("Authorization");
  if (!auth) return new Response("Unauthorized", { status: 401, headers: CORS });

  let body: ReqBody;
  try {
    body = parseBody(await req.json());
  } catch (e) {
    return new Response(`Bad request: ${(e as Error).message}`, { status: 400, headers: CORS });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (userErr || !userData.user) return new Response("Unauthorized", { status: 401, headers: CORS });
  const userId = userData.user.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Ev) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await converse({ sb, userId, body, send });
      } catch (err) {
        console.error(err);
        send({ type: "error", message: friendlyError(err) });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
});

function friendlyError(err: unknown): string {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return "Der Coach ist fast bereit: Auf dem Server fehlt noch der Claude-Schlüssel (ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.AuthenticationError) return "Der Claude-Schlüssel auf dem Server ist ungültig.";
  if (err instanceof Anthropic.PermissionDeniedError || (err instanceof Anthropic.BadRequestError && /credit|billing/i.test(err.message)))
    return "Beim Claude-Konto fehlt Guthaben oder eine Berechtigung (platform.claude.com → Billing).";
  if (err instanceof Anthropic.RateLimitError) return "Ich bin gerade etwas überlastet. Versuch es gleich nochmal.";
  if (err instanceof Anthropic.APIConnectionError) return "Ich erreiche die KI gerade nicht. Versuch es gleich nochmal.";
  if (err instanceof Anthropic.APIError) return `Da ist etwas schiefgelaufen (${err.status}). Versuch es gleich nochmal.`;
  return "Da ist etwas schiefgelaufen. Versuch es gleich nochmal.";
}

async function converse({ sb, userId, body, send }: { sb: SupabaseClient; userId: string; body: ReqBody; send: (e: Ev) => void }) {
  const { mode, thread, message, context } = body;

  const [profileRes, memoriesRes, historyRes, daysRes, eventsRes] = await Promise.all([
    sb.from("profiles").select("display_name, location_name, summary, nature_palette").eq("id", userId).single(),
    sb.from("memories").select("id, category, event_date, content, source").order("created_at", { ascending: true }).limit(400),
    mode === "tidy"
      ? Promise.resolve({ data: [] as { role: string; content: string }[] })
      : sb.from("messages").select("role, content").eq("thread", thread).order("id", { ascending: false }).limit(80),
    // Two weeks of mood and energy, so the coach can notice patterns.
    sb.from("days").select("day, mood, focus").lt("day", context.day).order("day", { ascending: false }).limit(14),
    sb
      .from("events")
      .select("id, title, starts_at, all_day, location")
      .gte("starts_at", new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString())
      .order("starts_at")
      .limit(60),
  ]);
  if (profileRes.error) throw profileRes.error;

  const opener =
    mode === "tidy"
      ? "(Stilles Aufräumen der Erinnerungen.)"
      : (message ?? (mode === "onboarding" ? "(Die App wird zum ersten Mal geöffnet.)" : "(Die App wurde gerade geöffnet.)"));
  // Tidying is invisible: nothing goes into the conversation.
  if (mode !== "tidy") await sb.from("messages").insert({ user_id: userId, thread, role: "user", content: opener, hidden: !message });

  const history: Anthropic.Beta.BetaMessageParam[] = (historyRes.data ?? [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "user", content: opener }];
  // The API wants the conversation to start with the person.
  while (messages.length && messages[0].role !== "user") messages.shift();

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // Stable: persona + mode rules (cached across requests).
    { type: "text", text: `${PERSONA}\n\n${mode === "onboarding" ? MODE_ONBOARDING : mode === "tidy" ? MODE_TIDY : MODE_CHECKIN}`, cache_control: { type: "ephemeral" } },
    // Changes every turn: time, weather, memories.
    {
      type: "text",
      text: contextBlock({
        ...context,
        profile: profileRes.data,
        memories: memoriesRes.data ?? [],
        recentDays: daysRes.data ?? [],
        events: (eventsRes.data ?? []).map((e) => ({
          id: e.id,
          title: e.title,
          when: new Intl.DateTimeFormat("de-CH", {
            timeZone: context.timezone || "Europe/Zurich",
            weekday: "short",
            day: "numeric",
            month: "short",
            ...(e.all_day ? {} : { hour: "2-digit", minute: "2-digit" }),
          }).format(new Date(e.starts_at)),
          location: e.location,
        })),
      }),
    },
  ];

  const tools =
    mode === "onboarding"
      ? TOOLS
      : mode === "tidy"
        ? TOOLS.filter((t) => ["remember", "update_memory", "forget"].includes(t.name))
        : TOOLS.filter((t) => t.name !== "finish_onboarding");
  let fullText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      // Opus 5.5 always thinks adaptively; effort is the dial.
      output_config: { effort: EFFORT },
      // If the model declines for policy reasons, the API retries on its default fallback.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools,
      messages,
    });

    let roundText = "";
    stream.on("text", (delta) => {
      if (!roundText && fullText) {
        fullText += "\n\n";
        send({ type: "text", text: "\n\n" });
      }
      roundText += delta;
      fullText += delta;
      send({ type: "text", text: delta });
    });

    const msg = await stream.finalMessage();

    if (msg.stop_reason === "refusal") {
      const t = "Dazu kann ich leider nichts sagen. Magst du mir erzählen, was dich sonst gerade beschäftigt?";
      send({ type: "text", text: (fullText ? "\n\n" : "") + t });
      fullText += (fullText ? "\n\n" : "") + t;
      break;
    }

    const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    // Only run tools on a clean tool_use stop: a call cut off by max_tokens may carry truncated input.
    if (msg.stop_reason !== "tool_use" || toolUses.length === 0) break;

    messages.push({ role: "assistant", content: msg.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        try {
          const input = tu.input && typeof tu.input === "object" ? (tu.input as Record<string, unknown>) : {};
          const out = await runTool(tu.name, input, { sb, userId, day: context.day, tz: context.timezone || "Europe/Zurich", mode, send });
          return { type: "tool_result" as const, tool_use_id: tu.id, content: out };
        } catch (e) {
          const msgText = e instanceof ToolInputError ? e.message : "Speichern fehlgeschlagen";
          if (!(e instanceof ToolInputError)) console.error(e);
          return { type: "tool_result" as const, tool_use_id: tu.id, content: msgText, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  if (mode !== "tidy" && fullText.trim()) {
    await sb.from("messages").insert({ user_id: userId, thread, role: "assistant", content: fullText.trim() });
  }
}
