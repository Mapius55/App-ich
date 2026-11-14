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
import { addDays, habitStreak, habitWeek, streakLabel, weekStart } from "../_shared/plan.ts";

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOAL_STATUS = ["active", "done", "paused", "dropped"] as const;
const EVENT_KINDS = ["termin", "block"] as const;
const MAX_MILESTONES = 12;
const DEFAULT_TZ = "Europe/Zurich";

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
  // An unknown zone would make every date conversion and the context throw.
  const zone = (v: unknown) => {
    const z = s(v, 60);
    try {
      return z ? new Intl.DateTimeFormat("en", { timeZone: z }).resolvedOptions().timeZone : DEFAULT_TZ;
    } catch {
      return DEFAULT_TZ;
    }
  };
  return {
    mode: b.mode,
    thread: b.thread,
    message: b.message?.trim() || undefined,
    context: {
      day: c.day,
      localTime: s(c.localTime),
      timezone: zone(c.timezone),
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
      "Trägt einen Eintrag direkt in den Kalender „I am“ auf dem iPhone der Person ein: einen Termin (Rennen, Training, Treffen, Prüfung …) oder einen gemeinsam geplanten Block. Zeiten in der lokalen Zeit der Person.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Kurz, z.B. „Halbmarathon Zürich“." },
        start: { type: "string", description: "YYYY-MM-DDTHH:MM (lokal) oder YYYY-MM-DD für ganztägig." },
        end: { type: "string", description: "Optional, gleiches Format wie start. Bei Blöcken immer angeben." },
        location: { type: "string" },
        notes: { type: "string" },
        reminder_minutes: {
          type: "integer",
          description: "Erinnerung so viele Minuten vorher (Standard 30, bei Blöcken 10). Bei ganztägigen Terminen weglassen (dann 8 Uhr am Tag).",
        },
        kind: {
          type: "string",
          enum: [...EVENT_KINDS],
          description: "termin (Standard): ein Termin der Person. block: Zeit, die ihr gemeinsam geplant habt, z.B. Fokuszeit oder ein Training für ein Ziel.",
        },
        goal_id: { type: "string", description: "Optional: das Ziel, dem der Eintrag dient (id aus dem Kontext)." },
      },
      required: ["title", "start"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_event",
    description: "Ändert einen Eintrag im Kalender „I am“ (id aus dem Kontext), z.B. um einen Block zu verschieben.",
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
        kind: { type: "string", enum: [...EVENT_KINDS] },
        goal_id: { type: "string", description: "id eines Ziels oder leer, um die Verbindung zu lösen." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "delete_event",
    description: "Löscht einen Eintrag aus dem Kalender „I am“, z.B. wenn ein Termin abgesagt wurde oder ein Block nicht mehr passt.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "create_goal",
    description:
      "Legt ein Ziel auf der Seite „Plan“ an: etwas Konkretes, auf das die Person hinarbeitet (Rennen, Prüfung, Projekt), oft mit Datum.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Kurz, z.B. „Halbmarathon Zürich“." },
        why: { type: "string", description: "Warum es ihr wichtig ist, in ihren Worten. Nur, wenn sie es gesagt hat." },
        target_date: { type: "string", description: "YYYY-MM-DD, z.B. der Renntag. Weglassen, wenn es kein Datum gibt." },
        milestones: {
          type: "array",
          description: "Nur Etappen, die die Person selbst genannt hat, in ihrer Reihenfolge.",
          items: {
            type: "object",
            properties: { title: { type: "string" }, due_date: { type: "string", description: "YYYY-MM-DD, optional." } },
            required: ["title"],
            additionalProperties: false,
          },
          maxItems: MAX_MILESTONES,
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_goal",
    description: "Ändert ein Ziel (id aus dem Kontext) oder setzt seinen Status: done (erreicht), paused, dropped (aufgegeben) oder wieder active.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        why: { type: "string", description: "Leer, um es zu entfernen." },
        target_date: { type: "string", description: "YYYY-MM-DD oder leer, um das Datum zu entfernen." },
        status: { type: "string", enum: [...GOAL_STATUS] },
      },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "delete_goal",
    description: "Löscht ein Ziel mit seinen Etappen. Nur, wenn die Person es ausdrücklich möchte, sonst lieber status done oder dropped.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "add_milestone",
    description: "Hängt eine Etappe an ein Ziel an (id aus dem Kontext). Erst, wenn die Person mit den Etappen einverstanden ist.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string" },
        title: { type: "string", description: "Kurz, z.B. „10 km am Stück laufen“." },
        due_date: { type: "string", description: "YYYY-MM-DD, optional." },
      },
      required: ["goal_id", "title"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_milestone",
    description: "Ändert eine Etappe (id aus dem Kontext). done: true, wenn die Person sie geschafft hat, false nimmt das zurück.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD oder leer, um das Datum zu entfernen." },
        done: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "delete_milestone",
    description: "Löscht eine Etappe, die nicht mehr passt.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "create_habit",
    description: "Legt eine Gewohnheit an, etwas Wiederkehrendes wie „dreimal pro Woche laufen“. Erst nach einer kurzen Bestätigung der Person.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Kurz, z.B. „Laufen“." },
        per_week: { type: "integer", minimum: 1, maximum: 7, description: "Wie oft pro Woche, 7 = jeden Tag." },
        goal_id: { type: "string", description: "Optional: das Ziel, dem sie dient (id aus dem Kontext)." },
      },
      required: ["title", "per_week"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_habit",
    description: "Ändert eine Gewohnheit (id aus dem Kontext). active: false beendet sie, wenn die Person sie nicht mehr möchte.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        per_week: { type: "integer", minimum: 1, maximum: 7 },
        active: { type: "boolean" },
        goal_id: { type: "string", description: "id eines Ziels oder leer, um die Verbindung zu lösen." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "log_habit",
    description: "Hakt eine Gewohnheit ab, wenn die Person erzählt, dass sie es getan hat. done: false nimmt es zurück.",
    input_schema: {
      type: "object",
      properties: {
        habit_id: { type: "string" },
        done: { type: "boolean", description: "Standard true." },
        day: { type: "string", description: "YYYY-MM-DD, Standard heute. Bei „gestern“ das Datum ausrechnen." },
      },
      required: ["habit_id"],
      additionalProperties: false,
    },
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
// A real calendar day, so "2026-02-30" is caught here rather than by Postgres.
const isDay = (v: string) => {
  if (!DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v);
};
const optDate = (v: unknown, field = "event_date"): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !isDay(v)) throw new ToolInputError(`${field} muss YYYY-MM-DD sein`);
  return v;
};
// Optional text: undefined = unchanged, empty = clear.
const optText = (v: unknown, max: number, field: string): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && !v.trim())) return null;
  return str(v, max, field);
};
const bool = (v: unknown, field: string): boolean => {
  if (typeof v !== "boolean") throw new ToolInputError(`${field} muss true oder false sein`);
  return v;
};
const uuid = (v: unknown, field: string): string => {
  const id = str(v, 64, field);
  if (!UUID_RE.test(id)) throw new ToolInputError(`${field}: unbekannte id, bitte aus dem Kontext nehmen`);
  return id;
};
// Optional link to a goal: undefined = unchanged, empty = no goal.
const optGoalId = (v: unknown): string | null | undefined => (v === undefined ? undefined : v === null || v === "" ? null : uuid(v, "goal_id"));
const oneOf = <T extends string>(v: unknown, values: readonly T[], field: string): T => {
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) throw new ToolInputError(`${field}: erlaubt sind ${values.join(", ")}`);
  return v as T;
};
const perWeek = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 7) throw new ToolInputError("per_week muss eine ganze Zahl von 1 bis 7 sein");
  return v;
};
// The owner-check triggers report a missing or someone else's goal as foreign_key_violation.
const missingGoal = (error: { code?: string }) => (error.code === "23503" ? new ToolInputError("Ziel nicht gefunden") : error);

type Row = Record<string, unknown>;
type MilestoneRow = Row & { id: string; title: string; position: number; done_at: string | null };

/** A goal as the app shows it: with its milestones in order. */
const toGoal = (row: Row) => ({ ...row, milestones: [...((row.milestones as MilestoneRow[] | null) ?? [])].sort((a, b) => a.position - b.position) });

async function loadGoal(sb: SupabaseClient, id: string) {
  const { data, error } = await sb.from("goals").select("*, milestones(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ToolInputError("Ziel nicht gefunden");
  return toGoal(data);
}

/** First day of the habit history the app shows: the current week and the 15 before it. */
const habitsSince = (today: string) => addDays(weekStart(today), -15 * 7);

async function doneDays(sb: SupabaseClient, habitId: string, today: string): Promise<string[]> {
  const { data, error } = await sb.from("habit_logs").select("day").eq("habit_id", habitId).gte("day", habitsSince(today)).order("day");
  if (error) throw error;
  return (data ?? []).map((l) => String(l.day));
}

// Changes to goals and habits run one after another within a round (see converse()).
const PLAN_TOOLS = new Set([
  "create_goal",
  "update_goal",
  "delete_goal",
  "add_milestone",
  "update_milestone",
  "delete_milestone",
  "create_habit",
  "update_habit",
  "log_habit",
]);

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
      if (input.kind !== undefined) row.kind = oneOf(input.kind, EVENT_KINDS, "kind");
      const goalId = optGoalId(input.goal_id);
      if (goalId !== undefined) row.goal_id = goalId;
      const endsBeforeStart = (start: unknown, end: unknown) => typeof start === "string" && typeof end === "string" && Date.parse(end) < Date.parse(start);
      if (name === "create_event") {
        if (!row.title || !row.starts_at) throw new ToolInputError("title und start sind nötig");
        if (endsBeforeStart(row.starts_at, row.ends_at)) throw new ToolInputError("end liegt vor start");
        // A planned block is close at hand: a short heads-up is enough.
        if (row.reminder_minutes === undefined) row.reminder_minutes = row.kind === "block" ? 10 : 30;
        const { data, error } = await sb.from("events").insert({ ...row, user_id: userId, source: "coach" }).select().single();
        if (error) throw missingGoal(error);
        send({ type: "event_created", event: data });
        return JSON.stringify({ ok: true, id: data.id });
      }
      const id = str(input.id, 64, "id");
      if (!Object.keys(row).length) throw new ToolInputError("nichts zu ändern");
      if (row.starts_at !== undefined || row.ends_at !== undefined) {
        // Moving an entry (e.g. a block) keeps its length, and the end never lands before the start.
        const cur = await sb.from("events").select("starts_at, ends_at, all_day").eq("id", id).maybeSingle();
        if (cur.error) throw cur.error;
        if (!cur.data) throw new ToolInputError("Termin nicht gefunden");
        const { starts_at, ends_at, all_day } = cur.data;
        if (row.starts_at !== undefined && row.ends_at === undefined && ends_at) {
          row.ends_at = row.all_day === all_day ? new Date(Date.parse(String(row.starts_at)) + Date.parse(ends_at) - Date.parse(starts_at)).toISOString() : null;
        }
        if (endsBeforeStart(row.starts_at ?? starts_at, row.ends_at === undefined ? ends_at : row.ends_at)) throw new ToolInputError("end liegt vor start");
      }
      const { data, error } = await sb.from("events").update(row).eq("id", id).select().maybeSingle();
      if (error) throw missingGoal(error);
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
    case "create_goal": {
      const title = str(input.title, 200, "title");
      const why = optText(input.why, 1000, "why") ?? null;
      const target_date = optDate(input.target_date, "target_date") ?? null;
      if (input.milestones !== undefined && !Array.isArray(input.milestones)) throw new ToolInputError("milestones muss eine Liste sein");
      const list = (input.milestones as unknown[] | undefined) ?? [];
      if (list.length > MAX_MILESTONES) throw new ToolInputError(`höchstens ${MAX_MILESTONES} Etappen`);
      const steps = list.map((m, i) => {
        const o = (m && typeof m === "object" ? m : {}) as Row;
        return { title: str(o.title, 200, `milestones[${i}].title`), due_date: optDate(o.due_date, `milestones[${i}].due_date`) ?? null, position: i };
      });
      const { data: goal, error } = await sb.from("goals").insert({ user_id: userId, title, why, target_date, source: "coach" }).select().single();
      if (error) throw error;
      let milestones: Row[] = [];
      if (steps.length) {
        const res = await sb
          .from("milestones")
          .insert(steps.map((m) => ({ ...m, user_id: userId, goal_id: goal.id })))
          .select();
        if (res.error) {
          // No transactions over PostgREST: undo the goal so a retry doesn't leave a half-saved twin.
          await sb.from("goals").delete().eq("id", goal.id);
          throw res.error;
        }
        milestones = res.data ?? [];
      }
      const saved = toGoal({ ...goal, milestones });
      send({ type: "goal_saved", goal: saved });
      return JSON.stringify({ ok: true, id: goal.id, milestones: saved.milestones.map((m) => ({ id: m.id, title: m.title })) });
    }
    case "update_goal": {
      const id = uuid(input.id, "id");
      const patch: Row = {};
      if (input.title !== undefined) patch.title = str(input.title, 200, "title");
      const why = optText(input.why, 1000, "why");
      if (why !== undefined) patch.why = why;
      const target = optDate(input.target_date, "target_date");
      if (target !== undefined) patch.target_date = target;
      if (input.status !== undefined) patch.status = oneOf(input.status, GOAL_STATUS, "status");
      if (!Object.keys(patch).length) throw new ToolInputError("nichts zu ändern");
      const { data, error } = await sb.from("goals").update(patch).eq("id", id).select("*, milestones(*)").maybeSingle();
      if (error) throw error;
      if (!data) throw new ToolInputError("Ziel nicht gefunden");
      send({ type: "goal_saved", goal: toGoal(data) });
      return JSON.stringify({ ok: true });
    }
    case "delete_goal": {
      const id = uuid(input.id, "id");
      // Milestones go with it; habits and calendar entries stay, without the link.
      const { data, error } = await sb.from("goals").delete().eq("id", id).select("id, title");
      if (error) throw error;
      if (!data?.length) throw new ToolInputError("Ziel nicht gefunden");
      send({ type: "goal_deleted", id, title: data[0].title });
      return JSON.stringify({ ok: true });
    }
    case "add_milestone": {
      const goalId = uuid(input.goal_id, "goal_id");
      const row = { title: str(input.title, 200, "title"), due_date: optDate(input.due_date, "due_date") ?? null };
      const last = await sb.from("milestones").select("position").eq("goal_id", goalId).order("position", { ascending: false }).limit(1).maybeSingle();
      if (last.error) throw last.error;
      const position = last.data ? Number(last.data.position) + 1 : 0;
      const { data, error } = await sb.from("milestones").insert({ ...row, position, goal_id: goalId, user_id: userId }).select("id").single();
      if (error) throw missingGoal(error);
      send({ type: "goal_saved", goal: await loadGoal(sb, goalId) });
      return JSON.stringify({ ok: true, id: data.id });
    }
    case "update_milestone": {
      const id = uuid(input.id, "id");
      const patch: Row = {};
      if (input.title !== undefined) patch.title = str(input.title, 200, "title");
      const due = optDate(input.due_date, "due_date");
      if (due !== undefined) patch.due_date = due;
      if (input.done !== undefined) patch.done_at = bool(input.done, "done") ? new Date().toISOString() : null;
      if (!Object.keys(patch).length) throw new ToolInputError("nichts zu ändern");
      const { data, error } = await sb.from("milestones").update(patch).eq("id", id).select("goal_id").maybeSingle();
      if (error) throw error;
      if (!data) throw new ToolInputError("Etappe nicht gefunden");
      const goal = await loadGoal(sb, data.goal_id);
      send({ type: "goal_saved", goal });
      // Lets the coach notice the last step and offer to mark the goal as reached.
      return JSON.stringify({ ok: true, open_milestones: goal.milestones.filter((m) => !m.done_at).length });
    }
    case "delete_milestone": {
      const id = uuid(input.id, "id");
      const { data, error } = await sb.from("milestones").delete().eq("id", id).select("goal_id");
      if (error) throw error;
      if (!data?.length) throw new ToolInputError("Etappe nicht gefunden");
      send({ type: "goal_saved", goal: await loadGoal(sb, data[0].goal_id) });
      return JSON.stringify({ ok: true });
    }
    case "create_habit": {
      const row = {
        user_id: userId,
        title: str(input.title, 120, "title"),
        per_week: perWeek(input.per_week),
        goal_id: optGoalId(input.goal_id) ?? null,
        source: "coach",
      };
      const { data, error } = await sb.from("habits").insert(row).select().single();
      if (error) throw missingGoal(error);
      send({ type: "habit_saved", habit: { ...data, done_days: [] } });
      return JSON.stringify({ ok: true, id: data.id });
    }
    case "update_habit": {
      const id = uuid(input.id, "id");
      const patch: Row = {};
      if (input.title !== undefined) patch.title = str(input.title, 120, "title");
      if (input.per_week !== undefined) patch.per_week = perWeek(input.per_week);
      if (input.active !== undefined) patch.active = bool(input.active, "active");
      const goalId = optGoalId(input.goal_id);
      if (goalId !== undefined) patch.goal_id = goalId;
      if (!Object.keys(patch).length) throw new ToolInputError("nichts zu ändern");
      const { data, error } = await sb.from("habits").update(patch).eq("id", id).select().maybeSingle();
      if (error) throw missingGoal(error);
      if (!data) throw new ToolInputError("Gewohnheit nicht gefunden");
      send({ type: "habit_saved", habit: { ...data, done_days: await doneDays(sb, id, day) } });
      return JSON.stringify({ ok: true });
    }
    case "log_habit": {
      const habitId = uuid(input.habit_id, "habit_id");
      const done = input.done === undefined ? true : bool(input.done, "done");
      const logDay = optDate(input.day, "day") ?? day;
      if (logDay > day) throw new ToolInputError("day liegt in der Zukunft");
      const { data: habit, error } = await sb.from("habits").select("id, title, per_week").eq("id", habitId).maybeSingle();
      if (error) throw error;
      if (!habit) throw new ToolInputError("Gewohnheit nicht gefunden");
      const res = done
        ? await sb.from("habit_logs").upsert({ habit_id: habitId, user_id: userId, day: logDay }, { onConflict: "habit_id,day", ignoreDuplicates: true })
        : await sb.from("habit_logs").delete().eq("habit_id", habitId).eq("day", logDay);
      if (res.error) throw res.error;
      send({ type: "habit_logged", habit_id: habitId, title: habit.title, day: logDay, done });
      // Where the week and the streak stand now, so the coach can mention a nice streak.
      const h = { per_week: Number(habit.per_week), done_days: await doneDays(sb, habitId, day) };
      return JSON.stringify({
        ok: true,
        this_week: `${habitWeek(h, day).doneThisWeek} von ${h.per_week}`,
        streak: streakLabel(habitStreak(h, day)) ?? "keine",
      });
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

  const tz = context.timezone || DEFAULT_TZ;
  const now = Date.now();
  const eventCols = "id, title, starts_at, ends_at, all_day, location, kind, goal_id";
  const in60Days = new Date(now + 60 * 24 * 3600 * 1000).toISOString();

  const [profileRes, memoriesRes, historyRes, daysRes, eventsRes, laterRes, goalsRes, habitsRes] = await Promise.all([
    sb.from("profiles").select("display_name, location_name, summary, nature_palette").eq("id", userId).single(),
    sb.from("memories").select("id, category, event_date, content, source").order("created_at", { ascending: true }).limit(400),
    mode === "tidy"
      ? Promise.resolve({ data: [] as { role: string; content: string }[] })
      : sb.from("messages").select("role, content").eq("thread", thread).order("id", { ascending: false }).limit(80),
    // Two weeks of mood and energy, so the coach can notice patterns.
    sb.from("days").select("day, mood, focus").lt("day", context.day).order("day", { ascending: false }).limit(14),
    // From two days back to two months ahead, with start and end, so the coach can plan around what's there.
    sb
      .from("events")
      .select(eventCols)
      .gte("starts_at", new Date(now - 2 * 24 * 3600 * 1000).toISOString())
      .lt("starts_at", in60Days)
      .order("starts_at")
      .limit(120),
    // Appointments further out (a race in spring), so they aren't entered twice; planned blocks would crowd them out above.
    sb.from("events").select(eventCols).gte("starts_at", in60Days).eq("kind", "termin").order("starts_at").limit(30),
    sb
      .from("goals")
      .select("id, title, why, target_date, status, milestones(id, title, due_date, done_at, position)")
      .in("status", ["active", "paused"])
      .order("target_date", { ascending: true, nullsFirst: false })
      .order("created_at")
      .limit(30),
    // The filter on habit_logs.day limits the embedded logs, not the habits.
    sb
      .from("habits")
      .select("id, title, per_week, goal_id, habit_logs(day)")
      .eq("active", true)
      .gte("habit_logs.day", habitsSince(context.day))
      .order("created_at")
      .limit(30),
  ]);
  if (profileRes.error) throw profileRes.error;
  // The rest only enriches the context: the coach still talks without it.
  for (const r of [memoriesRes, daysRes, eventsRes, laterRes, goalsRes, habitsRes]) if (r.error) console.error(r.error);

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
    // Changes every turn: time, weather, memories, goals, habits, calendar.
    {
      type: "text",
      text: contextBlock({
        ...context,
        timezone: tz,
        profile: profileRes.data,
        memories: memoriesRes.data ?? [],
        recentDays: daysRes.data ?? [],
        goals: goalsRes.data ?? [],
        habits: (habitsRes.data ?? []).map(({ habit_logs, ...h }) => ({
          ...h,
          done_days: ((habit_logs as { day: string }[] | null) ?? []).map((l) => l.day).sort(),
        })),
        events: [...(eventsRes.data ?? []), ...(laterRes.data ?? [])],
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
    const call = async (tu: Anthropic.Beta.BetaToolUseBlock): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
      try {
        const input = tu.input && typeof tu.input === "object" ? (tu.input as Record<string, unknown>) : {};
        const out = await runTool(tu.name, input, { sb, userId, day: context.day, tz, mode, send });
        return { type: "tool_result" as const, tool_use_id: tu.id, content: out };
      } catch (e) {
        const msgText = e instanceof ToolInputError ? e.message : "Speichern fehlgeschlagen";
        if (!(e instanceof ToolInputError)) console.error(e);
        return { type: "tool_result" as const, tool_use_id: tu.id, content: msgText, is_error: true };
      }
    };
    // Tools run in parallel, except changes to goals and habits: those run one after another in
    // call order, so several new milestones get distinct positions and the last goal_saved is complete.
    let planQueue: Promise<unknown> = Promise.resolve();
    const results = await Promise.all(
      toolUses.map((tu) => {
        if (!PLAN_TOOLS.has(tu.name)) return call(tu);
        const p = planQueue.then(() => call(tu)); // call() never rejects
        planQueue = p;
        return p;
      }),
    );
    messages.push({ role: "user", content: results });
  }

  if (mode !== "tidy" && fullText.trim()) {
    await sb.from("messages").insert({ user_id: userId, thread, role: "assistant", content: fullText.trim() });
  }
}
