// Supabase Edge Function: the AI coach.
// Receives one turn from the app, talks to Claude (streaming), runs the
// coach's tools against the person's own rows (Row Level Security applies,
// because we act with their JWT), and streams events back as SSE.
//
// Secrets (set with `supabase secrets set`): ANTHROPIC_API_KEY.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  cleanView,
  contextBlock,
  effortLine,
  habitWeekLabel,
  openerCandidates,
  MODE_CHECKIN,
  MODE_ONBOARDING,
  MODE_TIDY,
  PERSONA,
  todayNudge,
  type ContextConnections,
  type ContextGoal,
  type ContextInput,
  type ContextSeries,
} from "./prompt.ts";
import {
  birthYearProblem,
  BLOCK_ALREADY_LOGGED,
  BLOCK_DONE_EARLY,
  BLOCK_LATER_NO,
  BLOCK_NO_NEXT,
  blockNoNext,
  blockOpenThatDay,
  COME_BACK_NOTE,
  doneDateProblem,
  draftStream,
  finalVersion,
  goalHints,
  greetingWriteRefusal,
  nextStepHint,
  NOLIO_EDIT_REFUSAL,
  NOLIO_TIME_REFUSAL,
  nolioEditAllowed,
  NUDGE_NO_NOTE,
  offerNudgeKind,
  priorProblem,
  repeatGuard,
  replyShape,
  REVIEW_NOTES,
  REVIEW_RESULTS,
  reviewPatch,
  sameBlockAnswer,
  TIME_ALREADY_LOGGED,
  WHOOP_HIDDEN_REPLY,
  WHOOP_MEMORY_REFUSAL,
  whoopInMemory,
} from "./rules.ts";
import { zonedToUtc } from "../_shared/ics.ts";
import { trainingsForCoach } from "../_shared/nolio.ts";
import {
  addDays,
  chooseOpener,
  dailySituation,
  daysBetween,
  experimentDue,
  goalEffort,
  habitStreak,
  hasPlanGoal,
  isOpenerKind,
  leansOnCoach,
  localClock,
  NUDGE_LONG_DAYS,
  NUDGE_NOT_NOW_DAYS,
  type NudgeKind,
  OBSTACLE_MAX,
  openBlocksOn,
  openWeekBlocks,
  PATTERN_DAYS,
  PLAN_B_MAX,
  reviewNoteWeek,
  reviewWeek,
  sameTimeLogged,
  streakLabel,
  SUPPORT_EVERY_DAYS,
  weekGoalSummary,
  weekStart,
  type OpenerKind,
} from "../_shared/plan.ts";
import { liveRhythms, parseClock, parseWeekdays, seriesLabel, SERIES_MAX_ACTIVE, WEEKDAY_CODES } from "../_shared/series.ts";
import { spokenStream, stripEmoji } from "../_shared/spoken.ts";
import { whoopForCoach } from "../_shared/whoop.ts";

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
const GOAL_KINDS = ["goal", "dream"] as const;
const MEMORY_MAX = 1000;
const EVENT_KINDS = ["termin", "block"] as const;
const OFFERS = ["experiment", "begleitung", "blockmuster", "plan_b", "rhythmus", "flaute", "stunden", "etappen"] as const;
const MAX_MILESTONES = 12;
const DEFAULT_TZ = "Europe/Zurich";
const DAY_MS = 24 * 3600 * 1000;

type Ev = Record<string, unknown> & { type: string };

interface ReqBody {
  mode: "onboarding" | "checkin" | "tidy";
  thread: string;
  message?: string;
  context: { day: string; localTime: string; timezone: string; season: string; phase: string; weather?: string; hasLocation: boolean; view?: string };
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
      // what the app shows (the space); validated, never trusted as instructions
      view: cleanView(c.view),
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
        nachgefragt: { type: "boolean", description: "true, nachdem du einmal danach gefragt hast (unter „Zum Nachfragen“): dann nicht wieder." },
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
        word: { type: "string", description: "Ein Wort für die Stimmung (nicht für das, was sie tut), z.B. „ruhig“, „müde“, „voller Vorfreude“." },
      },
      required: ["valence", "energy", "word"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "set_day_focus",
    description: "Setzt den Fokus für heute (höchstens sechs Wörter), der unter dem Kreis angezeigt wird.",
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
    description: "Aktualisiert den Namen, mit dem du die Person ansprichst, ihren Wohnort oder ihr Geburtsjahr (nur, wenn sie es selbst nennt).",
    input_schema: {
      type: "object",
      properties: {
        display_name: { type: "string" },
        location_name: { type: "string" },
        birth_year: { type: ["integer", "null"], minimum: 1900, maximum: 2100, description: "Nur das Jahr, z.B. 1994. Für „Leben“ in der App; nie danach fragen. null entfernt es." },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "create_event",
    description:
      "Trägt einen Eintrag direkt in den Kalender „Bucket List“ auf dem iPhone der Person ein: einen Termin (Rennen, Arbeitsschicht, Vorlesung, Training, Treffen, Prüfung …) oder einen gemeinsam geplanten Block. Zeiten in der lokalen Zeit der Person.",
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
          description:
            "Erinnerung so viele Minuten vorher (Standard 30, bei Blöcken 10). Bei ganztägigen Einträgen ab Mitternacht gezählt: weglassen = 8 Uhr am Tag (-480), 360 = 18 Uhr am Vortag.",
        },
        kind: {
          type: "string",
          enum: [...EVENT_KINDS],
          description: "termin (Standard): ein Termin der Person. block: Zeit, die ihr gemeinsam geplant habt, z.B. Fokuszeit oder ein Training für ein Ziel.",
        },
        goal_id: { type: "string", description: "Optional: das Ziel oder der Traum, dem der Eintrag dient (id aus dem Kontext)." },
      },
      required: ["title", "start"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_event",
    description:
      "Ändert einen Eintrag im Kalender „Bucket List“ (id aus dem Kontext), z.B. um einen Block zu verschieben. Einträge vom Trainer (Nolio) nicht: bei denen nur reminder_minutes.",
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
    description:
      "Löscht einen Eintrag aus dem Kalender „Bucket List“, z.B. wenn ein Termin abgesagt wurde oder ein Block nicht mehr passt. Nie einen Eintrag vom Trainer (Nolio).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "create_series",
    description:
      "Legt einen Wochenrhythmus an: Blöcke, die jede Woche an denselben Tagen zur selben Zeit wiederkehren. Sie stehen im Kalender „Bucket List“ acht Wochen voraus und kommen von selbst nach, bis zum Ende (ohne until bis zum Tag vor dem Zieldatum). Nur nach ihrem klaren Ja. Zeiten in ihrer lokalen Zeit.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Kurz, z.B. „Laufen“." },
        goal_id: { type: "string", description: "Das Ziel, dem er dient (id aus dem Kontext)." },
        weekdays: { type: "array", items: { type: "string", enum: [...WEEKDAY_CODES] }, description: "Die Wochentage, z.B. [„di“, „do“]." },
        time: { type: "string", description: "Beginn HH:MM, z.B. 18:00." },
        minutes: { type: "integer", description: "Länge in Minuten (Standard 60)." },
        location: { type: "string" },
        reminder_minutes: { type: "integer", description: "Erinnerung so viele Minuten vorher (Standard 10)." },
        from: { type: "string", description: "Erster Tag YYYY-MM-DD (Standard heute)." },
        until: { type: "string", description: "Optional: letzter Tag YYYY-MM-DD." },
      },
      required: ["title", "weekdays", "time"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "update_series",
    description:
      "Ändert einen Wochenrhythmus (id unter „Wochenrhythmus“ im Kontext) für alle kommenden Tage, zu denen sie noch nichts gesagt hat; vergangene bleiben, ebenso Tage, die sie einzeln geändert hat. ab: erst ab diesem Tag („ab Januar nur noch dienstags“). pausiert: true lässt ihn ruhen (die kommenden Tage gehen aus dem Kalender), false nimmt ihn wieder auf. ende: true beendet ihn (mit ab nach dem Tag davor). ausfall: ein einzelner Tag YYYY-MM-DD fällt aus, für einen Tag, der noch nicht im Kalender steht (sonst delete_event).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        weekdays: { type: "array", items: { type: "string", enum: [...WEEKDAY_CODES] } },
        time: { type: "string", description: "HH:MM" },
        minutes: { type: "integer" },
        title: { type: "string" },
        location: { type: "string" },
        reminder_minutes: { type: "integer" },
        until: { type: "string", description: "Letzter Tag YYYY-MM-DD, leer = bis zum Zieldatum." },
        ab: { type: "string", description: "YYYY-MM-DD: die Änderung gilt erst ab diesem Tag." },
        pausiert: { type: "boolean" },
        ende: { type: "boolean" },
        ausfall: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "create_goal",
    description:
      "Legt ein Ziel an (die Person sieht es bei ihren Zielen): etwas Konkretes, auf das die Person hinarbeitet (Rennen, Prüfung, Projekt), mit Datum, auch ungefähr. Mit kind dream einen Traum für ihre Bucket List: etwas, das sie in ihrem Leben einmal erleben möchte, ein Datum nur, wenn sie eines nennt. Bei Zielen enthält die Antwort die Aufwand-Zeile mit der Machbarkeit.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Kurz, z.B. „Halbmarathon Zürich“ oder „Polarlichter sehen“." },
        kind: {
          type: "string",
          enum: [...GOAL_KINDS],
          description: "goal (Standard): ein konkretes Ziel. dream: ein Lebenstraum für die Bucket List, ohne Rückfrage, sobald sie so einen Wunsch nennt.",
        },
        why: { type: "string", description: "Warum es ihr wichtig ist, in ihren Worten. Nur, wenn sie es gesagt hat." },
        target_date: {
          type: "string",
          description: "YYYY-MM-DD, z.B. der Renntag. Ungefähres sofort auf das nächste solche Datum: „im Juni“ = 30. Juni, „Ende Juli“ = 31. Juli. Nur weglassen, wenn es wirklich kein Datum gibt.",
        },
        status: {
          type: "string",
          enum: ["active", "paused", "done"],
          description:
            "active (Standard). paused für ein zu grosses Ziel, das mit ihrer Zeit oder ihrem Stand klar unerreichbar wirkt, bis ihr ehrlich darüber gesprochen habt. done nur für einen Traum, der sich schon erfüllt hat.",
        },
        done_date: { type: "string", description: "YYYY-MM-DD, nur mit status done: wann sich der Traum erfüllt hat (ungefähr genügt)." },
        memory: { type: "string", description: "Nur bei einem erfüllten Traum: wie es war, kurz und in ihren Worten, in der Ich-Form, so wie sie es sagt (nicht in der dritten Person)." },
        effort_hours: {
          type: "number",
          minimum: 0,
          maximum: 100000,
          description: "Geschätzter Gesamtaufwand in Stunden, realistisch, z.B. Halbmarathon aus einer Laufbasis in 12 Wochen ≈ 60.",
        },
        weekly_hours: { type: "number", minimum: 0, maximum: 168, description: "Stunden pro Woche, die sie realistisch investieren kann. Nur, wenn sie es gesagt hat." },
        prior_hours: {
          type: "number",
          minimum: 0,
          maximum: 100000,
          description: "Nur Stunden, die sie schon für genau dieses Ziel gearbeitet hat, und nur eine Zahl, die sie genannt oder bestätigt hat. Nie aus Erfahrung oder Jahren umgerechnet.",
        },
        prior_bestaetigt: { type: "boolean", description: "true, wenn sie eine grosse Zahl prior_hours selbst genannt oder bestätigt hat." },
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
    description:
      "Ändert ein Ziel oder einen Traum (id aus dem Kontext) oder setzt den Status: done (erreicht, ein Traum hat sich erfüllt), paused, dropped (aufgegeben) oder wieder active.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        kind: { type: "string", enum: [...GOAL_KINDS], description: "goal oder dream (auf der Bucket List)." },
        done_date: { type: "string", description: "YYYY-MM-DD, mit status done: wann es sich erfüllt hat, wenn nicht heute (ungefähr genügt)." },
        memory: { type: "string", description: "Wie es war (erfüllter Traum), kurz und in ihren Worten, in der Ich-Form, so wie sie es sagt (nicht in der dritten Person); leer entfernt es." },
        reminded: { type: "boolean", description: "true, nachdem du sie an diesen Traum erinnert hast (der Traum unter „Anstoss heute“)." },
        nicht_jetzt: { type: "boolean", description: "Nur bei einem Traum, zusammen mit reminded: true, wenn sie „nicht jetzt“ gesagt hat. Dann ruht er drei Monate." },
        planen: {
          type: "boolean",
          description: "Nur bei einem Traum: true, wenn ihr ihn gerade zusammen plant und du nach ihrem Ja speicherst (sie will ihn wahr machen oder hat dich darum gebeten). Nicht, wenn sie nur nennt, wann.",
        },
        why: { type: "string", description: "Leer, um es zu entfernen." },
        obstacle: { type: "string", description: "Was ihr bei diesem Ziel dazwischenkommen könnte, kurz und in ihren Worten, z.B. „Regen“. Leer entfernt es." },
        plan_b: {
          type: "string",
          description:
            "Ihr Plan B: ein Wenn-dann-Satz in ihren Worten, in der Ich-Form, z.B. „Wenn es regnet, laufe ich auf dem Laufband.“ Erst nach ihrem Ja; sie sieht ihn im Ziel. Leer entfernt ihn.",
        },
        target_date: { type: "string", description: "YYYY-MM-DD oder leer, um das Datum zu entfernen." },
        status: { type: "string", enum: [...GOAL_STATUS] },
        effort_hours: { type: ["number", "null"], description: "Geschätzter Gesamtaufwand in Stunden; null entfernt die Schätzung." },
        weekly_hours: { type: ["number", "null"], description: "Stunden pro Woche, die sie investieren kann; null = unbekannt." },
        prior_hours: { type: "number", description: "Nur Stunden für genau dieses Ziel, die sie genannt oder bestätigt hat. Nie aus Erfahrung umgerechnet." },
        prior_bestaetigt: { type: "boolean", description: "true, wenn sie eine grosse Zahl prior_hours selbst genannt oder bestätigt hat." },
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
        nachgefragt: { type: "boolean", description: "true, nachdem du einmal nach dieser überfälligen Etappe gefragt hast: dann nicht wieder, bis ein neues Datum vorbei ist." },
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
    description:
      "Legt eine Gewohnheit an, etwas Wiederkehrendes wie „dreimal pro Woche laufen“. Gleich, wenn die Person es ausdrücklich möchte; schlägst du sie selbst vor, erst nach ihrem Ja.",
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
    name: "log_time",
    description:
      "Hält Zeit fest, die die Person in ein Ziel gesteckt hat, z.B. „heute 1,5 Stunden trainiert“ (minutes 90). Mit event_id beantwortest du einen Block dieses Ziels: einen vergangenen mit den tatsächlichen Minuten oder 0, wenn er nicht stattgefunden hat, oder einen von heute, den sie schon erledigt hat. Eine neue Antwort zum selben Block ersetzt die frühere.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string" },
        minutes: { type: "integer", minimum: 0, maximum: 1440, description: "1 bis 1440; 0 nur mit event_id (der Block hat nicht stattgefunden)." },
        day: { type: "string", description: "YYYY-MM-DD, Standard heute (mit event_id der Tag des Blocks). Nicht in der Zukunft." },
        event_id: { type: "string", description: "Optional: der Block (id aus dem Kontext), den das bestätigt oder korrigiert, ein vergangener oder einer von heute." },
        note: { type: "string", description: "Optional, kurz, z.B. „Intervalle“." },
        zusaetzlich: { type: "boolean", description: "Nur ohne event_id: true, wenn es wirklich Zeit dazu war, neben einem Block dieses Tages oder dieselbe Zeit ein zweites Mal." },
      },
      required: ["goal_id", "minutes"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "wochenblick",
    description:
      "Hält fest, wie der Wochenblick ausging: gemacht (ihr habt zurück- und vorausgeschaut), abgelehnt (sie wollte diese Woche nicht oder ging nicht darauf ein), will oder will_nicht (ihre Antwort auf die Frage, ob sie ihn überhaupt möchte).",
    input_schema: {
      type: "object",
      properties: { ergebnis: { type: "string", enum: [...REVIEW_RESULTS] } },
      required: ["ergebnis"],
      additionalProperties: false,
    },
  },
  {
    name: "come_back",
    description:
      "Nach ihrem Ja, dass du darauf zurückkommen sollst: hält fest, was sie am Abend Wichtiges über ihr Leben gesagt hat, kurz und in ihren Worten. In der nächsten Begrüssung am Morgen kommst du genau einmal darauf zurück.",
    input_schema: {
      type: "object",
      properties: { thema: { type: "string", description: "Kurz, in ihren Worten, z.B. „dass sie für alle die Jacken hält“." } },
      required: ["thema"],
      additionalProperties: false,
    },
  },
  {
    name: "note_offer",
    description:
      "Hält fest, dass du etwas angeboten hast, das nur selten kommt: experiment (ein kleines Experiment, höchstens einmal pro Woche), begleitung (der einmalige Hinweis auf Menschen in ihrem Leben oder eine Fachperson), blockmuster (du hast angeboten, die Blöcke eines Ziels nach ihrem Muster anzupassen; mit goal_id, höchstens einmal pro Woche und Ziel), plan_b (du hast gefragt, was ihr bei einem Ziel dazwischenkommen könnte; mit goal_id, einmal pro Ziel), rhythmus (du hast für ein Ziel einen Wochenrhythmus angeboten; mit goal_id, einmal pro Ziel), stunden (du hast nach ihren Stunden pro Woche für ein Ziel gefragt; mit goal_id, einmal pro Ziel), etappen (du hast Etappen für ein Ziel vorgeschlagen; mit goal_id, einmal pro Ziel) oder flaute (du hast angeboten, den Rhythmus eines Ziels zu ändern oder zu pausieren; mit goal_id).",
    input_schema: {
      type: "object",
      properties: {
        what: { type: "string", enum: [...OFFERS] },
        goal_id: { type: "string", description: "Bei blockmuster, plan_b, rhythmus, stunden, etappen und flaute: das Ziel, um das es ging." },
        nein: { type: "boolean", description: "true, wenn sie zu diesem Anstoss Nein gesagt hat: Dann ruht diese Art zwei Wochen." },
      },
      required: ["what"],
      additionalProperties: false,
    },
  },
  {
    name: "request_location",
    description: "Zeigt in der App einen Knopf, um den Standort freizugeben (für Wetter und Sonnenuntergang in den Farben).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "request_connections",
    description:
      "Zeigt in der App, welche Apps und Geräte die Person verbinden kann (WHOOP, Nolio, iPhone-Kalender). Ein einziges Mal fragen; danach nur, wenn sie es selbst anspricht.",
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
// Optional hours: undefined = unchanged; null or empty clears it where allowed.
const optHours = (v: unknown, max: number, field: string, clearable: boolean): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") {
    if (!clearable) throw new ToolInputError(`${field} muss eine Zahl sein`);
    return null;
  }
  return Math.round(num(v, 0, max, field) * 10) / 10;
};
/**
 * done_date (when a dream came true, if not today) → done_at, noon of that day in her time zone.
 * Only with status done; without done_date the database sets now() (trigger goals_done_at).
 */
function doneAtOf(v: unknown, status: string, today: string, tz: string): string | undefined {
  const day = optDate(v, "done_date");
  if (!day) return undefined;
  if (status !== "done") throw new ToolInputError("done_date nur zusammen mit status done");
  const problem = doneDateProblem(day, today);
  if (problem) throw new ToolInputError(problem);
  return zonedToUtc(`${day}T12:00`, tz);
}
// The owner-check triggers report a missing or someone else's goal as foreign_key_violation.
const missingGoal = (error: { code?: string }) => (error.code === "23503" ? new ToolInputError("Ziel nicht gefunden") : error);

/** Calendar day ("YYYY-MM-DD") of a moment in the person's time zone. */
const localDay = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

type Row = Record<string, unknown>;
type MilestoneRow = Row & { id: string; title: string; position: number; done_at: string | null };

// ---------- the weekly rhythm (public.series; its days are entries with series_id) ----------

/** The weekly rhythms of a goal that still run on `day` (active, not ended; none before the rhythm's migration). */
const goalRhythms = (sb: SupabaseClient, goalId: string, day: string) =>
  soft<{ id: string; title: string }[]>(
    sb.from("series").select("id, title").eq("goal_id", goalId).eq("active", true).or(`until_date.is.null,until_date.gte.${day}`).limit(10),
    [],
    "goal rhythms",
  );
/** update_goal: the goal is no longer active, so its rhythm rests. */
const RHYTHM_RESTS = "Sein Wochenrhythmus ruht jetzt mit dem Ziel, die kommenden Tage sind aus dem Kalender: sag es in einem Halbsatz. Wird das Ziel wieder aktiv, fragst du, ob er weiterlaufen soll (update_series pausiert false).";
/** The resting rhythms of a goal that could run again (not ended; none before the rhythm's migration). */
const restingRhythms = (sb: SupabaseClient, goalId: string, day: string) =>
  soft<{ id: string }[]>(
    sb.from("series").select("id").eq("goal_id", goalId).eq("active", false).or(`until_date.is.null,until_date.gte.${day}`).limit(1),
    [],
    "resting rhythms",
  );
/**
 * update_goal: the goal is active again, its rhythm still rests (it rested with the goal; that note is long gone from
 * the conversation by now): the one question, at the moment it matters.
 */
const RHYTHM_WAKES = "Sein Wochenrhythmus ruht noch: frag sie einmal, ob er wieder jede Woche im Kalender stehen soll; erst nach ihrem Ja update_series mit pausiert false.";

/** The tool result for one day of a rhythm changed or deleted on its own. */
const SERIES_DAY_NOTE = "Nur dieser Tag; der Wochenrhythmus bleibt, wie er ist.";
/** Before the rhythm's migration (no table): a clear answer instead of a failed save. */
const seriesMissing = (error: { code?: string }) =>
  error.code === "42P01" || error.code === "PGRST205" ? new ToolInputError("Wochenrhythmen gehen hier noch nicht: trag die Blöcke einzeln ein") : error;

/** After a rhythm was created or changed: its coming days in the calendar (the database entered them), for the app and the coach. */
async function seriesResult(sb: SupabaseClient, s: Row, tz: string, send: (e: Ev) => void, how: "created" | "changed" | "paused") {
  const res = await sb.from("events").select("*").eq("series_id", s.id).gte("starts_at", new Date().toISOString()).order("starts_at").limit(60);
  if (res.error) console.error("series days:", res.error.code ?? "error");
  const days = (res.data ?? []) as Row[];
  const first = days[0];
  const last = days[days.length - 1];
  // the app reloads its calendar (one toast for the rhythm, with its first day)
  if (first) send({ type: how === "created" ? "event_created" : "event_updated", event: first });
  else if (how !== "created") send({ type: "event_deleted", id: String(s.id), title: String(s.title) });
  const rule = { weekdays: (s.weekdays as number[]) ?? [], start_time: String(s.start_time), duration_minutes: Number(s.duration_minutes) || 60 };
  return {
    ok: true,
    id: s.id,
    rhythmus: seriesLabel(rule),
    im_kalender: first
      ? `${days.length} Tage, vom ${localDay(String(first.starts_at), tz)} bis ${localDay(String(last.starts_at), tz)}, danach kommen sie von selbst nach`
      : how === "paused"
        ? "ruht: keine kommenden Tage im Kalender"
        : "noch kein Tag im Kalender (Ziel nicht aktiv, Ende vorbei oder später als acht Wochen)",
    notiert:
      how === "created"
        ? "Sag in einem Halbsatz, ab wann er jede Woche im Kalender steht; die Tage nicht aufzählen."
        : how === "paused"
          ? "Er ruht; mit pausiert false läuft er wieder."
          : "Geändert für die kommenden Tage; vergangene und einzeln geänderte bleiben.",
  };
}
interface GoalTimeSum {
  logged_minutes: number;
  block_minutes: number;
  /** of block_minutes: blocks nobody answered that count only provisionally (a week after they ended) */
  provisional_minutes: number;
}
const NO_TIME: GoalTimeSum = { logged_minutes: 0, block_minutes: 0, provisional_minutes: 0 };

// numeric columns may arrive as strings; null stays null
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** A goal as the app shows it: milestones in order, effort as numbers, the time that went into it. */
const toGoal = (row: Row, time: GoalTimeSum = NO_TIME) => ({
  ...row,
  id: String(row.id),
  title: String(row.title),
  // before the Bucket List migration every row is a goal
  kind: row.kind === "dream" ? ("dream" as const) : ("goal" as const),
  done_at: (row.done_at as string | null | undefined) ?? null,
  memory: (row.memory as string | null | undefined) ?? null,
  // Plan B (its migration; before it: none)
  obstacle: (row.obstacle as string | null | undefined) ?? null,
  plan_b: (row.plan_b as string | null | undefined) ?? null,
  target_date: (row.target_date as string | null) ?? null,
  effort_hours: numOrNull(row.effort_hours),
  weekly_hours: numOrNull(row.weekly_hours),
  prior_hours: Number(row.prior_hours ?? 0) || 0,
  milestones: [...((row.milestones as MilestoneRow[] | null) ?? [])].sort((a, b) => a.position - b.position),
  time,
});

// (provisional_minutes comes with the honest-counting migration; before it: none)
const toTime = (r: Row | null | undefined): GoalTimeSum =>
  r ? { logged_minutes: Number(r.logged_minutes) || 0, block_minutes: Number(r.block_minutes) || 0, provisional_minutes: Number(r.provisional_minutes) || 0 } : NO_TIME;

/** The minutes of a block's answer as embedded (goal_time(minutes): a list, or one row), null = not answered. */
function answerMinutes(v: unknown): number | null {
  const row = (Array.isArray(v) ? v[0] : v) as { minutes?: unknown } | null | undefined;
  return row && row.minutes !== null && row.minutes !== undefined ? Number(row.minutes) || 0 : null;
}

/** What the coach's context reads of a goal; the Bucket List columns apart (they come with its migration). */
// (a milestone's updated_at: planning steps for a dream counts as activity for «liegt lange»; it is set on insert too)
const GOAL_COLS = "id, title, why, target_date, status, effort_hours, weekly_hours, prior_hours, milestones(id, title, due_date, done_at, position, updated_at)";
const BUCKET_COLS = "kind, done_at, memory, reminded_at, created_at, updated_at";

type DreamActivity = { lastTimeDay: string | null; lastBlockDay: string | null };

/**
 * For the reminders («liegt lange»: nothing for 60 days): per open dream the newest day with logged time
 * and the newest calendar block (a planned one too), both only from the last 60 days on. Only enriches
 * the context: on an error the dream simply counts by its own last change.
 */
async function dreamActivity(sb: SupabaseClient, ids: string[], today: string, tz: string): Promise<Map<string, DreamActivity>> {
  const out = new Map<string, DreamActivity>();
  if (!ids.length) return out;
  const since = addDays(today, -NUDGE_LONG_DAYS);
  const [time, blocks] = await Promise.all([
    soft<{ goal_id: string; day: string }[]>(sb.from("goal_time").select("goal_id, day").in("goal_id", ids).gte("day", since).order("day", { ascending: false }).limit(500), [], "dream time"),
    soft<{ goal_id: string; starts_at: string }[]>(
      sb.from("events").select("goal_id, starts_at").in("goal_id", ids).eq("kind", "block").gte("starts_at", zonedToUtc(since, tz)).order("starts_at", { ascending: false }).limit(500),
      [],
      "dream blocks",
    ),
  ]);
  const get = (id: string) => out.get(id) ?? out.set(id, { lastTimeDay: null, lastBlockDay: null }).get(id)!;
  for (const t of time) {
    const a = get(String(t.goal_id));
    if (!a.lastTimeDay || t.day > a.lastTimeDay) a.lastTimeDay = String(t.day);
  }
  for (const b of blocks) {
    const a = get(String(b.goal_id));
    const d = localDay(b.starts_at, tz);
    if (!a.lastBlockDay || d > a.lastBlockDay) a.lastBlockDay = d;
  }
  return out;
}

async function goalTime(sb: SupabaseClient, id: string): Promise<GoalTimeSum> {
  // "*": provisional_minutes only exists after its migration
  const { data, error } = await sb.from("goal_minutes").select("*").eq("goal_id", id).maybeSingle();
  if (error) throw error;
  return toTime(data);
}

async function loadGoal(sb: SupabaseClient, id: string) {
  const [res, time] = await Promise.all([sb.from("goals").select("*, milestones(*)").eq("id", id).maybeSingle(), goalTime(sb, id)]);
  if (res.error) throw res.error;
  if (!res.data) throw new ToolInputError("Ziel nicht gefunden");
  return toGoal(res.data, time);
}

/** First day of the habit history the app shows: the current week and the 15 before it. */
const habitsSince = (today: string) => addDays(weekStart(today), -15 * 7);

async function doneDays(sb: SupabaseClient, habitId: string, today: string): Promise<string[]> {
  const { data, error } = await sb.from("habit_logs").select("day").eq("habit_id", habitId).gte("day", habitsSince(today)).order("day");
  if (error) throw error;
  return (data ?? []).map((l) => String(l.day));
}

/**
 * Tools only the daily conversation runs (they answer «nur im täglichen Gespräch» elsewhere): its context brings the
 * rhythms, the Wochenblick and the «once» marks they belong to. Getting to know her, they are not offered at all, so
 * the coach never plans a call that can only fail (a rhythm she asks for then goes in as single blocks).
 */
const CHECKIN_ONLY = new Set(["create_series", "update_series", "note_offer", "wochenblick", "come_back"]);

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
  "log_time",
]);

async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { sb: SupabaseClient; userId: string; day: string; tz: string; mode: ReqBody["mode"]; send: (e: Ev) => void; whoop?: boolean },
): Promise<string> {
  const { sb, userId, day, send } = ctx;
  switch (name) {
    case "remember": {
      const category = String(input.category);
      if (!(CATEGORIES as readonly string[]).includes(category)) throw new ToolInputError("unbekannte Kategorie");
      const row = { user_id: userId, content: str(input.content, 2000, "content"), category, event_date: optDate(input.event_date) ?? null, source: "coach" };
      // WHOOP values were in the context: none of them (nor a pattern from them) becomes a memory
      if (ctx.whoop && whoopInMemory(row.content)) throw new ToolInputError(WHOOP_MEMORY_REFUSAL);
      const { data, error } = await sb.from("memories").insert(row).select().single();
      if (error) throw error;
      send({ type: "memory", memory: data });
      return JSON.stringify({ ok: true, id: data.id });
    }
    case "update_memory": {
      const id = str(input.id, 64, "id");
      const patch: Record<string, unknown> = {};
      if (input.content !== undefined) patch.content = str(input.content, 2000, "content");
      if (ctx.whoop && typeof patch.content === "string" && whoopInMemory(patch.content)) throw new ToolInputError(WHOOP_MEMORY_REFUSAL);
      const d = optDate(input.event_date);
      if (d !== undefined) patch.event_date = d;
      const asked = input.nachgefragt === undefined ? undefined : bool(input.nachgefragt, "nachgefragt");
      if (!Object.keys(patch).length && asked === undefined) throw new ToolInputError("nichts zu ändern");
      let saved: Row | null = null;
      if (Object.keys(patch).length) {
        let q = sb.from("memories").update(patch).eq("id", id);
        // While tidying up on its own, the coach only touches its own notes, never what the person wrote or confirmed.
        if (ctx.mode === "tidy") q = q.eq("source", "coach");
        const { data, error } = await q.select().maybeSingle();
        if (error) throw error;
        if (!data) throw new ToolInputError("Erinnerung nicht gefunden");
        saved = data;
      }
      // asked once about a dated note («Zum Nachfragen»): its own write, so a missing column (migration not
      // applied yet) never blocks the change itself
      if (asked !== undefined && ctx.mode !== "tidy") {
        const { data, error } = await sb.from("memories").update({ followed_up_at: asked ? new Date().toISOString() : null }).eq("id", id).select().maybeSingle();
        if (error) console.error("followed_up_at:", error.code ?? "error");
        else if (!data && !saved) throw new ToolInputError("Erinnerung nicht gefunden");
        else if (data) saved = data;
      }
      if (saved) send({ type: "memory_updated", memory: saved });
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
      const patch: Record<string, string | number | null> = {};
      if (input.display_name !== undefined) patch.display_name = str(input.display_name, 60, "display_name");
      if (input.location_name !== undefined) patch.location_name = str(input.location_name, 80, "location_name");
      // she wants it gone («Vergiss mein Geburtsjahr»): null removes it
      if (input.birth_year === null) patch.birth_year = null;
      else if (input.birth_year !== undefined) {
        // only the year, for «Leben»; saved when she says it, never asked for
        const problem = birthYearProblem(input.birth_year, day);
        if (problem) throw new ToolInputError(problem);
        patch.birth_year = input.birth_year as number;
      }
      if (!Object.keys(patch).length) throw new ToolInputError("nichts zu ändern");
      const { error } = await sb.from("profiles").update(patch).eq("id", userId);
      if (error) throw error;
      send({ type: "profile", profile: patch });
      return JSON.stringify({ ok: true });
    }
    case "create_event":
    case "update_event": {
      const row: Row = {};
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
      }
      if (input.end !== undefined) row.ends_at = when(input.end, "end").iso;
      if (input.location !== undefined) row.location = str(input.location, 200, "location");
      if (input.notes !== undefined) row.notes = str(input.notes, 2000, "notes");
      if (input.kind !== undefined) row.kind = oneOf(input.kind, EVENT_KINDS, "kind");
      const goalId = optGoalId(input.goal_id);
      if (goalId !== undefined) row.goal_id = goalId;
      // All-day reminders count from midnight: negative = that day (-480 = 08:00), positive = the evening before.
      const reminder = (allDay: boolean) => Math.round(num(input.reminder_minutes, allDay ? -1440 : 0, 10080, "reminder_minutes"));
      // A planned block is close at hand: a short heads-up is enough.
      const defaultReminder = (allDay: boolean, kind: unknown) => (allDay ? -480 : kind === "block" ? 10 : 30);
      const endsBeforeStart = (start: unknown, end: unknown) => typeof start === "string" && typeof end === "string" && Date.parse(end) < Date.parse(start);
      if (name === "create_event") {
        if (!row.title || !row.starts_at) throw new ToolInputError("title und start sind nötig");
        if (endsBeforeStart(row.starts_at, row.ends_at)) throw new ToolInputError("end liegt vor start");
        const allDay = row.all_day === true;
        // a planned block needs an end to count toward its goal: one hour unless said otherwise
        if (row.kind === "block" && !allDay && !row.ends_at) row.ends_at = new Date(Date.parse(String(row.starts_at)) + 3600_000).toISOString();
        row.reminder_minutes = input.reminder_minutes !== undefined ? reminder(allDay) : defaultReminder(allDay, row.kind);
        const { data, error } = await sb.from("events").insert({ ...row, user_id: userId, source: "coach" }).select().single();
        if (error) throw missingGoal(error);
        send({ type: "event_created", event: data });
        return JSON.stringify({ ok: true, id: data.id });
      }
      const id = uuid(input.id, "id");
      if (!Object.keys(row).length && input.reminder_minutes === undefined) throw new ToolInputError("nichts zu ändern");
      // "*": series_id only after the rhythm's migration
      const cur = await sb.from("events").select("*").eq("id", id).maybeSingle();
      if (cur.error) throw cur.error;
      if (!cur.data) throw new ToolInputError("Termin nicht gefunden");
      // the trainer's plan from Nolio: only the reminder is hers to change
      if (cur.data.source === "nolio" && !nolioEditAllowed(input)) throw new ToolInputError(NOLIO_EDIT_REFUSAL);
      const { starts_at, ends_at, all_day, reminder_minutes, kind } = cur.data;
      const allDay = (row.all_day as boolean | undefined) ?? all_day;
      if (input.reminder_minutes !== undefined) row.reminder_minutes = reminder(allDay);
      // Between timed and all-day the old offset means something else (30 min before midnight): use the default.
      else if (allDay !== all_day && reminder_minutes !== null) row.reminder_minutes = defaultReminder(allDay, row.kind ?? kind);
      // Moving an entry (e.g. a block) keeps its length, and the end never lands before the start.
      if (row.starts_at !== undefined && row.ends_at === undefined && ends_at) {
        if (allDay !== all_day) row.ends_at = null;
        else if (allDay) {
          // whole days, so a DST change in between doesn't cut off or add a day
          const span = daysBetween(localDay(starts_at, ctx.tz), localDay(ends_at, ctx.tz));
          row.ends_at = zonedToUtc(addDays(localDay(String(row.starts_at), ctx.tz), span), ctx.tz);
        } else row.ends_at = new Date(Date.parse(String(row.starts_at)) + Date.parse(ends_at) - Date.parse(starts_at)).toISOString();
      }
      if (endsBeforeStart(row.starts_at ?? starts_at, row.ends_at === undefined ? ends_at : row.ends_at)) throw new ToolInputError("end liegt vor start");
      const { data, error } = await sb.from("events").update(row).eq("id", id).select().maybeSingle();
      if (error) throw missingGoal(error);
      if (!data) throw new ToolInputError("Termin nicht gefunden");
      send({ type: "event_updated", event: data });
      return JSON.stringify(data.series_id ? { ok: true, notiert: SERIES_DAY_NOTE } : { ok: true });
    }
    case "delete_event": {
      const id = uuid(input.id, "id");
      const cur = await sb.from("events").select("source").eq("id", id).maybeSingle();
      if (cur.error) throw cur.error;
      if (!cur.data) throw new ToolInputError("Termin nicht gefunden");
      if (cur.data.source === "nolio") throw new ToolInputError(NOLIO_EDIT_REFUSAL);
      const { data, error } = await sb.from("events").delete().eq("id", id).neq("source", "nolio").select("*");
      if (error) throw error;
      if (!data?.length) throw new ToolInputError("Termin nicht gefunden");
      send({ type: "event_deleted", id, title: data[0].title });
      // one day of a rhythm: only that day falls away (the database keeps it as a skip marker)
      return JSON.stringify(data[0].series_id ? { ok: true, notiert: SERIES_DAY_NOTE } : { ok: true });
    }
    case "create_series": {
      if (ctx.mode !== "checkin") throw new ToolInputError("nur im täglichen Gespräch");
      const weekdays = parseWeekdays(input.weekdays);
      if (!weekdays) throw new ToolInputError("weekdays: z.B. [\"di\", \"do\"]");
      const time = parseClock(input.time);
      if (!time) throw new ToolInputError("time: HH:MM, z.B. 18:00");
      const from = optDate(input.from, "from") ?? day;
      if (from < day) throw new ToolInputError("from liegt in der Vergangenheit");
      const until = optDate(input.until, "until") ?? null;
      if (until && until < from) throw new ToolInputError("until liegt vor from");
      const goalId = optGoalId(input.goal_id) ?? null;
      const row: Row = {
        user_id: userId,
        goal_id: goalId,
        title: str(input.title, 200, "title"),
        weekdays,
        start_time: time,
        duration_minutes: input.minutes === undefined ? 60 : Math.round(num(input.minutes, 5, 720, "minutes")),
        location: optText(input.location, 200, "location") ?? null,
        reminder_minutes: input.reminder_minutes === undefined ? 10 : Math.round(num(input.reminder_minutes, 0, 10080, "reminder_minutes")),
        time_zone: ctx.tz,
        start_date: from,
        until_date: until,
        source: "coach",
      };
      const [goal, others] = await Promise.all([
        goalId ? sb.from("goals").select("status, target_date").eq("id", goalId).maybeSingle() : Promise.resolve(null),
        sb.from("series").select("id, goal_id, weekdays, start_time, active, start_date, until_date").eq("active", true).limit(40),
      ]);
      if (others.error) throw seriesMissing(others.error);
      if (goal?.error) throw goal.error;
      if (goal && !goal.data) throw new ToolInputError("Ziel nicht gefunden");
      if (goal?.data && goal.data.status !== "active") throw new ToolInputError("Das Ziel ist nicht aktiv: erst wieder aufnehmen (update_goal status active)");
      // only the rhythms that still run (an ended one, or the old part of one split «ab Januar», never counts)
      type Running = { goal_id: string | null; weekdays: number[]; start_time: string; active: boolean; start_date: string; until_date: string | null };
      const active = liveRhythms((others.data ?? []) as Running[], day);
      if (active.some((o) => o.goal_id === goalId && String(o.start_time).slice(0, 5) === time && o.weekdays.some((w) => weekdays.includes(w))))
        throw new ToolInputError("Diesen Rhythmus gibt es schon (siehe „Wochenrhythmus“): ändere ihn mit update_series");
      if (active.length >= SERIES_MAX_ACTIVE) throw new ToolInputError(`Höchstens ${SERIES_MAX_ACTIVE} Wochenrhythmen gleichzeitig: einen ändern oder beenden`);
      const { data, error } = await sb.from("series").insert(row).select().single();
      if (error) throw error.code === "23503" ? missingGoal(error) : seriesMissing(error);
      return JSON.stringify(await seriesResult(sb, data as Row, ctx.tz, send, "created"));
    }
    case "update_series": {
      if (ctx.mode !== "checkin") throw new ToolInputError("nur im täglichen Gespräch");
      const id = uuid(input.id, "id");
      const cur = await sb.from("series").select("*").eq("id", id).maybeSingle();
      if (cur.error) throw seriesMissing(cur.error);
      if (!cur.data) throw new ToolInputError("Rhythmus nicht gefunden");
      const s = cur.data as Row;
      const patch: Row = {};
      if (input.weekdays !== undefined) {
        const w = parseWeekdays(input.weekdays);
        if (!w) throw new ToolInputError("weekdays: z.B. [\"di\", \"do\"]");
        patch.weekdays = w;
      }
      if (input.time !== undefined) {
        const t = parseClock(input.time);
        if (!t) throw new ToolInputError("time: HH:MM, z.B. 18:00");
        patch.start_time = t;
      }
      if (input.minutes !== undefined) patch.duration_minutes = Math.round(num(input.minutes, 5, 720, "minutes"));
      if (input.title !== undefined) patch.title = str(input.title, 200, "title");
      if (input.location !== undefined) patch.location = optText(input.location, 200, "location") ?? null;
      if (input.reminder_minutes !== undefined) patch.reminder_minutes = Math.round(num(input.reminder_minutes, 0, 10080, "reminder_minutes"));
      if (input.until !== undefined) patch.until_date = input.until === "" || input.until === null ? null : optDate(input.until, "until");
      if (input.pausiert !== undefined) patch.active = !bool(input.pausiert, "pausiert");
      const ab = optDate(input.ab, "ab") ?? null;
      if (ab && ab < day) throw new ToolInputError("ab liegt in der Vergangenheit");
      const ausfall = optDate(input.ausfall, "ausfall") ?? null;
      if (ausfall && ausfall < day) throw new ToolInputError("ausfall liegt in der Vergangenheit");
      const ende = input.ende !== undefined && bool(input.ende, "ende");
      if (ende) {
        const last = ab ? addDays(ab, -1) : null;
        // ends after the day before `ab`; without one (or nothing of it before then) it goes: its coming days with it
        if (last && last >= String(s.start_date) && last >= day) {
          const { error } = await sb.from("series").update({ until_date: last }).eq("id", id);
          if (error) throw error;
        } else {
          const { error } = await sb.from("series").delete().eq("id", id);
          if (error) throw error;
        }
        send({ type: "event_deleted", id, title: String(s.title) });
        return JSON.stringify({ ok: true, notiert: last ? `Der Rhythmus endet nach dem ${last}; die Tage danach sind aus dem Kalender.` : "Der Rhythmus ist beendet; seine kommenden Tage sind aus dem Kalender, die vergangenen bleiben." });
      }
      if (ausfall) patch.skip_days = [...((s.skip_days as string[] | null) ?? []), ausfall];
      if (!Object.keys(patch).length) throw new ToolInputError("nichts zu ändern");
      // «ab Januar»: the rhythm splits there (split_series), the change goes to the part from then on
      let target = id;
      if (ab && Object.keys(patch).some((k) => k !== "skip_days")) {
        const split = await sb.rpc("split_series", { p_id: id, p_from: ab });
        if (split.error) throw split.error.code === "22023" ? new ToolInputError("Der Rhythmus endet vor diesem Tag") : split.error;
        target = String(split.data);
      }
      const { data, error } = await sb.from("series").update(patch).eq("id", target).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new ToolInputError("Rhythmus nicht gefunden");
      return JSON.stringify(await seriesResult(sb, data as Row, ctx.tz, send, patch.active === false ? "paused" : "changed"));
    }
    case "create_goal": {
      const title = str(input.title, 200, "title");
      const kind = input.kind === undefined ? "goal" : oneOf(input.kind, GOAL_KINDS, "kind");
      const why = optText(input.why, 1000, "why") ?? null;
      const target_date = optDate(input.target_date, "target_date") ?? null;
      const memory = optText(input.memory, MEMORY_MAX, "memory") ?? null;
      const effort = {
        effort_hours: optHours(input.effort_hours, 100000, "effort_hours", true) ?? null,
        weekly_hours: optHours(input.weekly_hours, 168, "weekly_hours", true) ?? null,
        prior_hours: optHours(input.prior_hours, 100000, "prior_hours", true) ?? 0,
      };
      const status = input.status === undefined ? "active" : oneOf(input.status, ["active", "paused", "done"] as const, "status");
      // a dream she already lived goes on the list fulfilled; a goal is created to work toward
      if (status === "done" && kind !== "dream") throw new ToolInputError("status done nur für einen Traum, der sich schon erfüllt hat (kind dream)");
      const doneAt = doneAtOf(input.done_date, status, day, ctx.tz);
      const prior = priorProblem(effort.prior_hours, effort.effort_hours, input.prior_bestaetigt === true);
      if (prior) throw new ToolInputError(prior);
      if (input.milestones !== undefined && !Array.isArray(input.milestones)) throw new ToolInputError("milestones muss eine Liste sein");
      const list = (input.milestones as unknown[] | undefined) ?? [];
      if (list.length > MAX_MILESTONES) throw new ToolInputError(`höchstens ${MAX_MILESTONES} Etappen`);
      const steps = list.map((m, i) => {
        const o = (m && typeof m === "object" ? m : {}) as Row;
        return { title: str(o.title, 200, `milestones[${i}].title`), due_date: optDate(o.due_date, `milestones[${i}].due_date`) ?? null, position: i };
      });
      const row: Row = { user_id: userId, title, why, target_date, status, ...effort, source: "coach" };
      // only with the Bucket List migration's columns: a goal without them saves as before
      if (kind === "dream") row.kind = kind;
      if (memory !== null) row.memory = memory;
      if (doneAt) row.done_at = doneAt;
      const { data: goal, error } = await sb.from("goals").insert(row).select().single();
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
      // A new goal has no time yet.
      const saved = toGoal({ ...goal, milestones });
      // a dream she already lived: the app shows «Erfüllt» and washes it in the colour flow
      send({ type: "goal_saved", goal: saved, created: true, ...(saved.kind === "dream" && status === "done" ? { fulfilled: true } : {}) });
      // the effort line computed here, so the coach never does the sums itself (a dream needs one only with an estimate)
      return JSON.stringify({
        ok: true,
        id: goal.id,
        kind: saved.kind,
        status,
        milestones: saved.milestones.map((m) => ({ id: m.id, title: m.title })),
        ...(saved.kind !== "dream" || saved.effort_hours ? { aufwand: effortLine(saved, day) } : {}),
        ...goalHints(saved, day),
      });
    }
    case "update_goal": {
      const id = uuid(input.id, "id");
      const patch: Row = {};
      if (input.title !== undefined) patch.title = str(input.title, 200, "title");
      const why = optText(input.why, 1000, "why");
      if (why !== undefined) patch.why = why;
      // her Plan B in her words (a stored one also notes that it was asked: trigger goals_plan_b_asked)
      const obstacle = optText(input.obstacle, OBSTACLE_MAX, "obstacle");
      if (obstacle !== undefined) patch.obstacle = obstacle;
      const planB = optText(input.plan_b, PLAN_B_MAX, "plan_b");
      if (planB !== undefined) patch.plan_b = planB;
      const target = optDate(input.target_date, "target_date");
      if (target !== undefined) patch.target_date = target;
      if (input.status !== undefined) patch.status = oneOf(input.status, GOAL_STATUS, "status");
      if (input.kind !== undefined) patch.kind = oneOf(input.kind, GOAL_KINDS, "kind");
      const memory = optText(input.memory, MEMORY_MAX, "memory");
      if (memory !== undefined) patch.memory = memory;
      // the coach mentioned the dream: the database sets reminded_at to its own now() (trigger goals_reminded_at),
      // and keeps updated_at, so «liegt lange» doesn't restart because of the reminder itself
      if (input.reminded !== undefined && bool(input.reminded, "reminded")) patch.reminded_at = new Date().toISOString();
      // her «nicht jetzt» to a dream: it was brought up, and rests for three months (nudge_after, written below)
      const notNow = input.nicht_jetzt !== undefined && bool(input.nicht_jetzt, "nicht_jetzt");
      if (notNow) patch.reminded_at = new Date().toISOString();
      if (input.done_date !== undefined) {
        // with status done in this call, or on a goal that is done already (the date is corrected)
        let status = patch.status as string | undefined;
        if (status === undefined) {
          const cur = await sb.from("goals").select("status").eq("id", id).maybeSingle();
          if (cur.error) throw cur.error;
          if (!cur.data) throw new ToolInputError("Ziel nicht gefunden");
          status = String(cur.data.status);
        }
        patch.done_at = doneAtOf(input.done_date, status, day, ctx.tz);
      }
      const effortHours = optHours(input.effort_hours, 100000, "effort_hours", true);
      if (effortHours !== undefined) patch.effort_hours = effortHours;
      const weeklyHours = optHours(input.weekly_hours, 168, "weekly_hours", true);
      if (weeklyHours !== undefined) patch.weekly_hours = weeklyHours;
      const priorHours = optHours(input.prior_hours, 100000, "prior_hours", true);
      if (priorHours !== undefined) patch.prior_hours = priorHours ?? 0;
      if (!Object.keys(patch).length) throw new ToolInputError("nichts zu ändern");
      // did this call fulfil it? (the app's «Erfüllt» and wash don't depend on how old done_at is:
      // with done_date it is noon of that day, hours or days ago)
      let wasDone = true;
      if (patch.status === "done") {
        const cur = await sb.from("goals").select("status").eq("id", id).maybeSingle();
        if (cur.error) throw cur.error;
        if (!cur.data) throw new ToolInputError("Ziel nicht gefunden");
        wasDone = cur.data.status === "done";
      }
      if (priorHours && input.prior_bestaetigt !== true) {
        // compared with the estimate as it will be after this change
        let estimate = effortHours;
        if (estimate === undefined) {
          const cur = await sb.from("goals").select("effort_hours").eq("id", id).maybeSingle();
          if (cur.error) throw cur.error;
          if (!cur.data) throw new ToolInputError("Ziel nicht gefunden");
          estimate = numOrNull(cur.data.effort_hours);
        }
        const prior = priorProblem(priorHours, estimate, false);
        if (prior) throw new ToolInputError(prior);
      }
      // reached, paused or dropped: its weekly rhythm rests with it (trigger goals_series), its coming days go
      const resting = patch.status !== undefined && patch.status !== "active" ? await goalRhythms(sb, id, day) : [];
      // active again (it was not): a rhythm that rested with it waits for her word
      let waking = false;
      if (patch.status === "active") {
        const [cur, rhythms] = await Promise.all([sb.from("goals").select("status").eq("id", id).maybeSingle(), restingRhythms(sb, id, day)]);
        waking = !cur.error && !!cur.data && cur.data.status !== "active" && rhythms.length > 0;
      }
      const [{ data, error }, time] = await Promise.all([
        sb.from("goals").update(patch).eq("id", id).select("*, milestones(*)").maybeSingle(),
        goalTime(sb, id),
      ]);
      if (error) throw error;
      if (!data) throw new ToolInputError("Ziel nicht gefunden");
      const goal = toGoal(data, time);
      for (const r of resting) send({ type: "event_deleted", id: r.id, title: r.title });
      if (notNow && goal.kind === "dream") {
        // its own write: a missing column (migration not applied yet) never undoes the reminder
        const rest = await sb.from("goals").update({ nudge_after: addDays(day, NUDGE_NOT_NOW_DAYS) }).eq("id", id);
        if (rest.error) console.error("nudge_after:", rest.error.code ?? "error");
      }
      // a dream brought up is the day's Anstoss; her «nicht jetzt» lets the dreams rest two weeks (this one three months)
      if (patch.reminded_at && goal.kind === "dream" && ctx.mode === "checkin") await noteNudge(sb, day, "traum", notNow);
      send({ type: "goal_saved", goal, ...(!wasDone && data.status === "done" && goal.kind === "dream" ? { fulfilled: true } : {}) });
      // Where the effort stands now, e.g. after she said how much time she has per week (dreams: only with an estimate).
      return JSON.stringify({
        ok: true,
        ...(goal.kind !== "dream" || goal.effort_hours ? { aufwand: effortLine(goal, day) } : {}),
        // only noting a reminder plans nothing: the invitation was the step (no milestones pushed on top).
        // A dream gets its milestones only when the coach says it is planning it with her (planen, after her
        // yes), never because she named a year, and never while getting to know her.
        ...(Object.keys(patch).length === 1 && patch.reminded_at ? {} : goalHints(goal, day, input.planen === true && ctx.mode !== "onboarding")),
        ...(patch.reminded_at
          ? { notiert: notNow ? "Erinnert; der Traum ruht jetzt drei Monate. Heute keinen weiteren Traum ansprechen." : "Erinnert. Heute keinen weiteren Traum ansprechen." }
          : {}),
        ...(resting.length && data.status !== "active" ? { rhythmus: RHYTHM_RESTS } : {}),
        ...(waking && data.status === "active" ? { rhythmus: RHYTHM_WAKES } : {}),
      });
    }
    case "delete_goal": {
      const id = uuid(input.id, "id");
      // Milestones go with it; habits and calendar entries stay, without the link; its weekly rhythm goes with
      // its coming days (the past ones stay as plain blocks).
      const rhythms = await goalRhythms(sb, id, day);
      const { data, error } = await sb.from("goals").delete().eq("id", id).select("id, title");
      if (error) throw error;
      if (!data?.length) throw new ToolInputError("Ziel nicht gefunden");
      send({ type: "goal_deleted", id, title: data[0].title });
      for (const r of rhythms) send({ type: "event_deleted", id: r.id, title: r.title });
      return JSON.stringify(rhythms.length ? { ok: true, rhythmus: "Sein Wochenrhythmus ist mit dem Ziel beendet: sag es in einem Halbsatz." } : { ok: true });
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
      const done = input.done === undefined ? undefined : bool(input.done, "done");
      const asked = input.nachgefragt === undefined ? undefined : bool(input.nachgefragt, "nachgefragt");
      if (!Object.keys(patch).length && done === undefined && asked === undefined) throw new ToolInputError("nichts zu ändern");
      const cur = await sb.from("milestones").select("goal_id, done_at, due_date").eq("id", id).maybeSingle();
      if (cur.error) throw cur.error;
      if (!cur.data) throw new ToolInputError("Etappe nicht gefunden");
      // Marking it done again keeps the day it was first reached.
      if (done === false) patch.done_at = null;
      else if (done === true && !cur.data.done_at) patch.done_at = new Date().toISOString();
      if (Object.keys(patch).length) {
        const { data, error } = await sb.from("milestones").update(patch).eq("id", id).select("id").maybeSingle();
        if (error) throw error;
        if (!data) throw new ToolInputError("Etappe nicht gefunden");
      }
      if (asked !== undefined) {
        // asked once about this overdue date: a new date that passes again may be asked about again.
        // Its own write, so a missing column (migration not applied yet) never blocks the change itself.
        const mark = await sb.from("milestones").update({ overdue_asked_for: asked ? (cur.data.due_date ?? null) : null }).eq("id", id);
        if (mark.error) console.error("overdue_asked_for:", mark.error.code ?? "error");
      }
      const goal = await loadGoal(sb, String(cur.data.goal_id));
      send({ type: "goal_saved", goal });
      // Lets the coach notice the last step and offer to mark the goal as reached; after a step is done, the next one.
      return JSON.stringify({
        ok: true,
        open_milestones: goal.milestones.filter((m) => !m.done_at).length,
        ...(done === true ? nextStepHint(goal.milestones as { id: string; title: string; due_date: string | null; done_at: string | null; position: number }[]) : {}),
      });
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
        // only from one on: never «0 von 3» to repeat
        ...(habitWeekLabel(h, day) ? { this_week: habitWeekLabel(h, day) } : {}),
        streak: streakLabel(habitStreak(h, day)) ?? "keine",
      });
    }
    case "log_time": {
      const goalId = uuid(input.goal_id, "goal_id");
      const eventId = input.event_id === undefined || input.event_id === null || input.event_id === "" ? null : uuid(input.event_id, "event_id");
      if (typeof input.minutes !== "number" || !Number.isFinite(input.minutes)) throw new ToolInputError("minutes muss eine Zahl sein");
      const minutes = Math.round(input.minutes);
      if (minutes > 1440 || minutes < (eventId ? 0 : 1)) throw new ToolInputError(eventId ? "minutes: 0 bis 1440" : "minutes: 1 bis 1440 (0 nur mit event_id)");
      const note = optText(input.note, 300, "note");
      const extra = input.zusaetzlich === undefined ? false : bool(input.zusaetzlich, "zusaetzlich");
      const goalRes = await sb.from("goals").select("id, title").eq("id", goalId).maybeSingle();
      if (goalRes.error) throw goalRes.error;
      if (!goalRes.data) throw new ToolInputError("Ziel nicht gefunden");
      let blockDay: string | null = null;
      let doneEarly = false;
      if (eventId) {
        const ev = await sb.from("events").select("starts_at, kind, goal_id, source, reminder_minutes").eq("id", eventId).maybeSingle();
        if (ev.error) throw ev.error;
        if (!ev.data) throw new ToolInputError("Block nicht gefunden");
        if (ev.data.source === "nolio") throw new ToolInputError(NOLIO_TIME_REFUSAL);
        if (ev.data.kind !== "block") throw new ToolInputError("event_id muss ein geplanter Block sein");
        if (String(ev.data.goal_id).toLowerCase() !== goalId.toLowerCase()) throw new ToolInputError("Der Block gehört nicht zu diesem Ziel; ohne event_id eintragen");
        blockDay = localDay(ev.data.starts_at, ctx.tz);
        // a block of today that starts later counts when she says it is done already (K6); a later day never
        if (Date.parse(ev.data.starts_at) > Date.now()) {
          if (blockDay > day) throw new ToolInputError("Der Block liegt an einem späteren Tag");
          if (minutes === 0) throw new ToolInputError(BLOCK_LATER_NO);
          // done before it comes: its alarm would ring for something she did already
          doneEarly = ev.data.reminder_minutes !== null && ev.data.reminder_minutes !== undefined;
        }
      }
      const logDay = optDate(input.day, "day") ?? blockDay ?? day;
      if (logDay > day) throw new ToolInputError("day liegt in der Zukunft");
      const fields = { goal_id: goalId, day: logDay, minutes, ...(note !== undefined ? { note } : {}) };
      const insert = () =>
        sb.from("goal_time").insert({ ...fields, user_id: userId, source: eventId ? "block" : "coach", event_id: eventId, note: note ?? null });
      if (eventId) {
        // The same answer again (a later turn repeating her «Nein»): nothing to save and no second time_logged.
        const stored = await sb.from("goal_time").select("goal_id, day, minutes, note").eq("event_id", eventId).maybeSingle();
        if (stored.error) throw stored.error;
        if (sameBlockAnswer(stored.data, { goalId, minutes, day: logDay, note })) return JSON.stringify({ ok: true, hint: BLOCK_ALREADY_LOGGED });
        // One answer per block; a new one replaces it (update, else insert; a race ends in an update).
        const update = () => sb.from("goal_time").update(fields).eq("event_id", eventId).select("id");
        let res = await update();
        if (res.error) throw res.error;
        if (!res.data?.length) {
          const ins = await insert();
          if (ins.error?.code === "23505") res = await update(); // answered in the meantime
          else if (ins.error) throw missingGoal(ins.error);
          if (res.error) throw res.error;
        }
        if (doneEarly) {
          const off = await sb.from("events").update({ reminder_minutes: null }).eq("id", eventId);
          // the time is saved: a failure here only leaves the alarm
          if (off.error) {
            console.error("reminder off:", off.error.code ?? "error");
            doneEarly = false;
          }
        }
      } else {
        // the same minutes for this goal on this day already there (said again, or a block or a habit that has them):
        // no second row unless she really did it twice (D1)
        if (!extra) {
          const same = await sb.from("goal_time").select("goal_id, day, minutes").eq("goal_id", goalId).eq("day", logDay).eq("minutes", minutes).limit(1);
          if (same.error) throw same.error;
          if (sameTimeLogged(same.data ?? [], goalId, logDay, minutes)) return JSON.stringify({ ok: true, hint: TIME_ALREADY_LOGGED });
          // a block of this goal on that day without an answer (past, running or later today) would count as well:
          // nothing saved, the coach answers the block or says it was more time (D1 with K6)
          const dayStart = Date.parse(`${logDay}T00:00:00Z`);
          const blocks = await sb
            .from("events")
            .select("id, starts_at, all_day, source, goal_time(id)")
            .eq("goal_id", goalId)
            .eq("kind", "block")
            .eq("all_day", false)
            .neq("source", "nolio") // a planned Nolio training is never answered by hand
            .gte("starts_at", new Date(dayStart - DAY_MS).toISOString())
            .lt("starts_at", new Date(dayStart + 2 * DAY_MS).toISOString())
            .order("starts_at")
            .limit(20);
          if (blocks.error) throw blocks.error;
          const open = openBlocksOn(blocks.data ?? [], logDay, (iso) => localDay(iso, ctx.tz));
          if (open.length) {
            const time = new Intl.DateTimeFormat("de-CH", { timeZone: ctx.tz, hour: "2-digit", minute: "2-digit" });
            return JSON.stringify({ ok: false, hint: blockOpenThatDay(open.map((b) => ({ id: String(b.id), time: time.format(new Date(b.starts_at)) }))) });
          }
        }
        const ins = await insert();
        if (ins.error) throw missingGoal(ins.error);
      }
      send({ type: "time_logged", goal_id: goalId, title: goalRes.data.title, minutes });
      // The new totals, so the coach can mention the progress in a word. The time is saved
      // already: a failure here must not look like a failed save (a retry would count twice).
      try {
        const goal = await loadGoal(sb, goalId);
        send({ type: "goal_saved", goal });
        const e = goalEffort(goal, day);
        return JSON.stringify({
          ok: true,
          // without the provisional hours (blocks nobody answered yet): those are never said as done
          done_hours: Math.round((e.done - e.provisional) * 10) / 10,
          ...(e.provisional > 0 ? { vorlaeufig_hours: e.provisional } : {}),
          remaining_hours: e.remaining,
          needed_per_week: e.neededPerWeek,
          feasibility: e.feasibility,
          // her «Nein»: the protocol, with her Plan B for this goal when there is one (a quiet reminder)
          ...(eventId && minutes === 0 ? { naechster_schritt: blockNoNext(goal.kind === "dream" ? null : goal.plan_b) } : {}),
          // a dream without an estimate gets no «Aufwand noch nicht geschätzt» to fill in (as create/update_goal)
          ...(goal.kind !== "dream" || goal.effort_hours ? { aufwand: effortLine(goal, day) } : {}),
          ...(doneEarly ? { erinnerung: BLOCK_DONE_EARLY } : {}),
        });
      } catch (err) {
        console.error(err);
        return JSON.stringify({ ok: true, ...(eventId && minutes === 0 ? { naechster_schritt: BLOCK_NO_NEXT } : {}), ...(doneEarly ? { erinnerung: BLOCK_DONE_EARLY } : {}) });
      }
    }
    case "wochenblick": {
      if (ctx.mode !== "checkin") throw new ToolInputError("nur im täglichen Gespräch");
      const result = oneOf(input.ergebnis, REVIEW_RESULTS, "ergebnis");
      // the week it is about, by her clock (from Sunday 16:00 the coming one; on the weekend always the coming one:
      // she may plan it herself before the window opens, and then no second one comes that evening or on Monday)
      const clock = localClock(new Date(), ctx.tz);
      const week = reviewNoteWeek(day, clock.day === day ? clock.minutes : 12 * 60);
      const cur = await sb.from("profiles").select("review_declines, review_week").eq("id", userId).maybeSingle();
      if (cur.error) throw cur.error;
      // the same week declined again (a later turn): already noted, no second decline
      const patch = reviewPatch(result, week, Number(cur.data?.review_declines) || 0, cur.data?.review_week ?? null);
      if (!Object.keys(patch).length) return JSON.stringify({ ok: true, notiert: "Schon notiert. Diese Woche nicht mehr; sprecht über den Tag." });
      const { error } = await sb.from("profiles").update(patch).eq("id", userId);
      if (error) throw error;
      await noteNudge(sb, day, "wochenblick");
      return JSON.stringify({ ok: true, notiert: REVIEW_NOTES[result] });
    }
    case "come_back": {
      if (ctx.mode !== "checkin") throw new ToolInputError("nur im täglichen Gespräch");
      // her yes of an evening (NEXT #4): the next morning's greeting comes back to it once (days.come_back)
      const topic = str(input.thema, 300, "thema");
      const { error } = await sb
        .from("days")
        .upsert({ user_id: userId, day, come_back: topic, come_back_at: null, updated_at: new Date().toISOString() }, { onConflict: "user_id,day" });
      if (error) throw error;
      return JSON.stringify({ ok: true, notiert: COME_BACK_NOTE });
    }
    case "note_offer": {
      if (ctx.mode !== "checkin") throw new ToolInputError("nur im täglichen Gespräch");
      const what = oneOf(input.what, OFFERS, "what");
      // the day's one Anstoss (profiles.nudge_day), and with nein her «Nein» to its kind: it rests two weeks
      const kind = offerNudgeKind(what);
      const no = kind !== null && input.nein !== undefined && bool(input.nein, "nein");
      const noted = async (note: string) => {
        if (kind) await noteNudge(sb, day, kind, no);
        return JSON.stringify({ ok: true, notiert: no ? NUDGE_NO_NOTE : note });
      };
      if (what === "stunden" || what === "etappen") {
        // once per goal (goals.hours_asked_at, steps_asked_at, the server's clock): the Anstoss never comes again for it
        const goalId = uuid(input.goal_id, "goal_id");
        const res = await sb
          .from("goals")
          .update(what === "stunden" ? { hours_asked_at: new Date().toISOString() } : { steps_asked_at: new Date().toISOString() })
          .eq("id", goalId)
          .select("id");
        if (res.error) throw res.error;
        if (!res.data?.length) throw new ToolInputError("Ziel nicht gefunden");
        return await noted(
          what === "stunden"
            ? "Notiert. Nach den Stunden pro Woche für dieses Ziel fragst du nicht nochmals; nennt sie eine Zahl, speicherst du sie mit update_goal weekly_hours."
            : "Notiert. Etappen für dieses Ziel schlägst du nicht nochmals von dir aus vor; gespeichert werden sie nach ihrem Ja mit add_milestone.",
        );
      }
      if (what === "rhythmus") {
        // once per goal (goals.rhythm_asked_at, the server's clock; a new rhythm for it sets it too)
        const goalId = uuid(input.goal_id, "goal_id");
        const res = await sb.from("goals").update({ rhythm_asked_at: new Date().toISOString() }).eq("id", goalId).select("id");
        if (res.error) throw res.error;
        if (!res.data?.length) throw new ToolInputError("Ziel nicht gefunden");
        return await noted("Notiert. Einen Wochenrhythmus für dieses Ziel bietest du nicht nochmals an; legst ihn nur nach ihrem Ja an.");
      }
      if (what === "flaute") {
        // per rhythm (series.lapse_asked_at): the next offer only after another three weeks like this
        const goalId = uuid(input.goal_id, "goal_id");
        const res = await sb.from("series").update({ lapse_asked_at: new Date().toISOString() }).eq("goal_id", goalId).select("id");
        if (res.error) throw seriesMissing(res.error);
        if (!res.data?.length) throw new ToolInputError("Kein Wochenrhythmus für dieses Ziel");
        return JSON.stringify({ ok: true, notiert: "Notiert. Geändert oder pausiert wird er erst nach ihrem Ja; bleibt er, ist das in Ordnung." });
      }
      if (what === "plan_b") {
        // once per goal (goals.plan_b_asked_at, the server's clock): the context never asks again for it
        const goalId = uuid(input.goal_id, "goal_id");
        const res = await sb.from("goals").update({ plan_b_asked_at: new Date().toISOString() }).eq("id", goalId).select("id");
        if (res.error) throw res.error;
        if (!res.data?.length) throw new ToolInputError("Ziel nicht gefunden");
        return await noted("Notiert. Nach einem Plan B für dieses Ziel fragst du nicht nochmals.");
      }
      if (what === "blockmuster") {
        // per goal (goals.pattern_asked_at, the server's clock): the pattern line then says it came this week
        const goalId = uuid(input.goal_id, "goal_id");
        const res = await sb.from("goals").update({ pattern_asked_at: new Date().toISOString() }).eq("id", goalId).select("id");
        if (res.error) throw res.error;
        if (!res.data?.length) throw new ToolInputError("Ziel nicht gefunden");
        return JSON.stringify({ ok: true, notiert: "Notiert. Diese Woche bietest du für dieses Ziel keine weitere Anpassung an." });
      }
      const { error } = await sb
        .from("profiles")
        .update(what === "experiment" ? { experiment_at: new Date().toISOString() } : { support_hint_at: new Date().toISOString() })
        .eq("id", userId);
      if (error) throw error;
      return await noted(what === "experiment" ? "Notiert. Diese Woche kein weiteres Experiment." : "Notiert. Den Hinweis nicht wiederholen.");
    }
    case "request_location": {
      send({ type: "request_location" });
      return JSON.stringify({ ok: true, note: "Die App zeigt jetzt den Knopf zum Freigeben." });
    }
    case "request_connections": {
      if (ctx.mode === "tidy") throw new ToolInputError("nicht beim Aufräumen");
      // asked once: the context says so from now on (never again unless she brings it up)
      const { error } = await sb.from("profiles").update({ connections_asked_at: new Date().toISOString() }).eq("id", userId);
      if (error) console.error("connections_asked_at:", error.code ?? "error"); // the app still shows the choice
      send({ type: "request_connections" });
      return JSON.stringify({ ok: true, note: "Die App zeigt jetzt, was sich verbinden lässt. Nicht nochmals fragen." });
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

/** WHOOP is set up on this server (the function secrets exist; their values are never read here). */
const whoopConfigured = () => !!Deno.env.get("WHOOP_CLIENT_ID") && !!Deno.env.get("WHOOP_CLIENT_SECRET") && (Deno.env.get("WHOOP_TOKEN_KEY") ?? "").length >= 32;
/** Nolio exists only for the app's owner (her personal key). */
const nolioOwner = (userId: string) =>
  !!Deno.env.get("NOLIO_API_KEY") && (Deno.env.get("NOLIO_OWNER_USER_ID") ?? "").trim().toLowerCase() === userId.toLowerCase();

type Res<T> = { data: T | null; error: unknown };
const whoopStatusOf = (s: unknown) => (s === "connected" || s === "pending" || s === "needs_reconnect" ? s : null);
/** A query that only enriches the context: a missing table (migration not applied yet) or any error → fallback. */
async function soft<T>(q: PromiseLike<Res<T>>, fallback: T, what: string): Promise<T> {
  try {
    const { data, error } = await q;
    if (error) {
      console.error(`coach context ${what}:`, (error as { code?: string }).code ?? "error");
      return fallback;
    }
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * The day's Anstoss came (profiles.nudge_day and nudge_kind: no other one today), and with `no` her «Nein» to its kind
 * (profiles.nudge_no: it rests NUDGE_NO_DAYS). Its own write (the function note_nudge): a missing function before its
 * migration never undoes what the tool saved.
 */
async function noteNudge(sb: SupabaseClient, day: string, kind: NudgeKind, no = false): Promise<void> {
  const { error } = await sb.rpc("note_nudge", { p_day: day, p_kind: kind, p_no: no });
  if (error) console.error("note_nudge:", (error as { code?: string }).code ?? "error");
}

type CoachProfile = {
  review_week?: string | null;
  review_declines?: number | null;
  review_wanted?: boolean | null;
  experiment_at?: string | null;
  support_hint_at?: string | null;
};

type PlanBRow = { obstacle: string | null; plan_b: string | null; plan_b_asked_at: string };
type SeriesRow = ContextSeries;

/** A goal's Plan B for the context: without a row none and never asked; without the rows (unknown) never asked. */
const planBOf = (rows: Map<string, PlanBRow> | null | undefined, id: string): Pick<ContextGoal, "obstacle" | "plan_b" | "plan_b_asked_at"> => {
  if (!rows) return { plan_b_asked_at: undefined };
  const r = rows.get(id);
  return { obstacle: r?.obstacle ?? null, plan_b: r?.plan_b ?? null, plan_b_asked_at: r?.plan_b_asked_at ?? null };
};

/**
 * What the daily conversation needs on top of the rest (the opener, a pause, the Wochenblick, the «once»
 * marks). Every query only enriches the context: on an error (e.g. a column before its migration) a fallback.
 * `day`: her today (the thread).
 */
async function loadDaily(sb: SupabaseClient, userId: string, day: string, now: number) {
  const [lastSeen, lastSpoke, lastTalk, talk, profile, openers, todayLog, followed, asked, resting, patternAsked, planB, , series, seriesDays, rhythmAsked, comeBack, nudge, nudgeAsked, sessions] = await Promise.all([
    // the last day before today with a conversation, however long ago (a pause)
    soft<{ thread: string }[]>(sb.from("messages").select("thread").lt("thread", day).order("id", { ascending: false }).limit(1), [], "last seen"),
    // her own last message before today and when (the Wochenblick: a greeting she never answered is no conversation);
    // the Kennenlernen has its own thread ("onboarding"), which sorts after every day and so is never found here
    soft<{ thread: string; created_at: string }[]>(
      sb.from("messages").select("thread, created_at").eq("role", "user").eq("hidden", false).lt("thread", day).order("id", { ascending: false }).limit(1),
      [],
      "last spoke",
    ),
    // the end of the last conversation within a week (not only yesterday): what she said before a gap survives
    soft<{ id: number; role: string; content: string; thread: string }[]>(
      sb.from("messages").select("id, role, content, thread").gte("thread", addDays(day, -7)).lt("thread", day).eq("hidden", false).order("id", { ascending: false }).limit(40),
      [],
      "last talk",
    ),
    // how much she said per day over two weeks (only counted, never read)
    soft<{ thread: string }[]>(
      sb.from("messages").select("thread").eq("role", "user").eq("hidden", false).gte("thread", addDays(day, -14)).lt("thread", day).limit(2000),
      [],
      "talk",
    ),
    soft<CoachProfile | null>(
      sb.from("profiles").select("review_week, review_declines, review_wanted, experiment_at, support_hint_at").eq("id", userId).maybeSingle(),
      null,
      "coach profile",
    ),
    soft<{ day: string; opener: string | null }[]>(sb.from("days").select("day, opener").gte("day", addDays(day, -7)).lte("day", day), [], "openers"),
    soft<{ goal_id: string; minutes: number }[]>(sb.from("goal_time").select("goal_id, minutes").eq("day", day).limit(200), [], "today time"),
    soft<{ id: string; followed_up_at: string }[]>(sb.from("memories").select("id, followed_up_at").not("followed_up_at", "is", null).limit(400), [], "followed up"),
    soft<{ id: string; overdue_asked_for: string }[]>(sb.from("milestones").select("id, overdue_asked_for").not("overdue_asked_for", "is", null).limit(400), [], "overdue asked"),
    soft<{ id: string; nudge_after: string }[]>(sb.from("goals").select("id, nudge_after").gte("nudge_after", day).limit(100), [], "resting dreams"),
    // when the coach last offered to adapt a goal's blocks (null: unknown, e.g. before the column: then never offered)
    soft<{ id: string; pattern_asked_at: string }[] | null>(
      sb.from("goals").select("id, pattern_asked_at").not("pattern_asked_at", "is", null).limit(200),
      null,
      "pattern asked",
    ),
    // Plan B per goal: what could get in the way, her if-then sentence, when the coach asked (a stored Plan B sets
    // it too, so these are all goals with any); null: unknown (e.g. before the column), then never asked
    soft<{ id: string; obstacle: string | null; plan_b: string | null; plan_b_asked_at: string }[] | null>(
      sb.from("goals").select("id, obstacle, plan_b, plan_b_asked_at").not("plan_b_asked_at", "is", null).limit(200),
      null,
      "plan b",
    ),
    // the weekly rhythms fill their coming days on every conversation (idempotent; the new ones lie 8 weeks ahead,
    // beyond what the context lists, so nothing waits for it)
    soft<number>(sb.rpc("extend_series"), 0, "extend series"),
    // the rhythms (null: unknown, e.g. before their migration: then no line and no offer) and which entries are their days
    soft<SeriesRow[] | null>(
      sb
        .from("series")
        .select("id, goal_id, title, weekdays, start_time, duration_minutes, location, reminder_minutes, time_zone, start_date, until_date, active, skip_days, lapse_asked_at")
        .order("created_at")
        .limit(20),
      null,
      "series",
    ),
    soft<{ id: string; series_id: string }[]>(
      sb
        .from("events")
        .select("id, series_id")
        .not("series_id", "is", null)
        .gte("starts_at", new Date(now - PATTERN_DAYS * DAY_MS).toISOString())
        .lt("starts_at", new Date(now + 61 * DAY_MS).toISOString())
        .limit(600),
      [],
      "series days",
    ),
    // a rhythm offered once per goal (null: unknown, then never offered)
    soft<{ id: string; rhythm_asked_at: string }[] | null>(
      sb.from("goals").select("id, rhythm_asked_at").not("rhythm_asked_at", "is", null).limit(200),
      null,
      "rhythm asked",
    ),
    // what she asked the coach to come back to on one of the last three days (come_back), and whether it came
    soft<{ day: string; come_back: string; come_back_at: string | null }[]>(
      sb.from("days").select("day, come_back, come_back_at").not("come_back", "is", null).gte("day", addDays(day, -3)).lt("day", day).order("day", { ascending: false }).limit(3),
      [],
      "come back",
    ),
    // the day's one Anstoss: when the last one came, its kind, and her «Nein» per kind (null: unknown, e.g. before the
    // columns: then no Anstoss, since nothing could be noted)
    soft<{ nudge_day: string | null; nudge_kind: string | null; nudge_no: Record<string, string> | null } | null>(
      sb.from("profiles").select("nudge_day, nudge_kind, nudge_no").eq("id", userId).maybeSingle(),
      null,
      "nudge",
    ),
    // a goal's weekly hours and steps asked once as the Anstoss (null: unknown, then never asked)
    soft<{ id: string; hours_asked_at: string | null; steps_asked_at: string | null }[] | null>(
      sb.from("goals").select("id, hours_asked_at, steps_asked_at").or("hours_asked_at.not.is.null,steps_asked_at.not.is.null").limit(200),
      null,
      "nudge asked",
    ),
    // what she really did per goal over four weeks (every time with minutes, oldest first): the size of a proposal
    soft<{ goal_id: string; minutes: number }[]>(
      sb
        .from("goal_time")
        .select("goal_id, minutes")
        .gt("minutes", 0)
        .gte("day", addDays(day, -PATTERN_DAYS))
        .lte("day", day)
        .order("day")
        .order("created_at")
        .limit(500),
      [],
      "sessions",
    ),
  ]);
  const sessionsOf = new Map<string, number[]>();
  for (const t of sessions) (sessionsOf.get(String(t.goal_id)) ?? sessionsOf.set(String(t.goal_id), []).get(String(t.goal_id))!).push(Number(t.minutes) || 0);
  const talkCounts: Record<string, number> = {};
  for (const r of talk) talkCounts[String(r.thread)] = (talkCounts[String(r.thread)] ?? 0) + 1;
  const talkThread = lastTalk[0] ? String(lastTalk[0].thread) : null;
  return {
    lastSeen: lastSeen[0] ? String(lastSeen[0].thread) : null,
    lastSpoke: lastSpoke[0] ? { thread: String(lastSpoke[0].thread), created_at: String(lastSpoke[0].created_at) } : null,
    lastTalk: talkThread ? { day: talkThread, rows: lastTalk.filter((m) => String(m.thread) === talkThread).slice(0, 12) } : null,
    talkCounts,
    profile,
    openers: openers.map((r) => ({ day: String(r.day), kind: r.opener ?? null })),
    todayLog: todayLog.map((t) => ({ goal_id: String(t.goal_id), minutes: Number(t.minutes) || 0 })),
    followed: new Map(followed.map((r) => [String(r.id), String(r.followed_up_at)])),
    asked: new Map(asked.map((r) => [String(r.id), String(r.overdue_asked_for)])),
    resting: new Map(resting.map((r) => [String(r.id), String(r.nudge_after)])),
    patternAsked: patternAsked ? new Map(patternAsked.map((r) => [String(r.id), String(r.pattern_asked_at)])) : null,
    planB: planB
      ? new Map(planB.map((r) => [String(r.id), { obstacle: r.obstacle ?? null, plan_b: r.plan_b ?? null, plan_b_asked_at: String(r.plan_b_asked_at) }]))
      : null,
    series,
    seriesOf: new Map(seriesDays.map((r) => [String(r.id), String(r.series_id)])),
    rhythmAsked: rhythmAsked ? new Map(rhythmAsked.map((r) => [String(r.id), String(r.rhythm_asked_at)])) : null,
    comeBack: comeBack.map((r) => ({ day: String(r.day), text: String(r.come_back ?? ""), at: r.come_back_at ? String(r.come_back_at) : null })).filter((r) => r.text.trim()),
    nudge: nudge
      ? {
          day: nudge.nudge_day ? String(nudge.nudge_day).slice(0, 10) : null,
          kind: nudge.nudge_kind ?? null,
          no: nudge.nudge_no && typeof nudge.nudge_no === "object" ? nudge.nudge_no : null,
        }
      : undefined,
    nudgeAsked: nudgeAsked ? new Map(nudgeAsked.map((r) => [String(r.id), { hours: r.hours_asked_at ?? null, steps: r.steps_asked_at ?? null }])) : null,
    sessions: sessionsOf,
  };
}

/**
 * Planned against done per goal for the week from `monday` (the Wochenblick looks back on it), and the blocks of
 * that week nobody answered, with their id (so a «nein» can still be recorded).
 */
async function weekSummaryFor(sb: SupabaseClient, goalIds: string[], monday: string, tz: string, now: number) {
  if (!goalIds.length) return { goals: [], open: [] };
  const [blocks, log] = await Promise.all([
    soft<Row[]>(
      sb
        .from("events")
        .select("id, title, goal_id, starts_at, ends_at, all_day, location, kind, source, goal_time(id)")
        .eq("kind", "block")
        .in("goal_id", goalIds)
        .gte("starts_at", zonedToUtc(monday, tz))
        .lt("starts_at", zonedToUtc(addDays(monday, 7), tz))
        .limit(200),
      [],
      "week blocks",
    ),
    soft<{ goal_id: string; day: string; minutes: number }[]>(
      sb.from("goal_time").select("goal_id, day, minutes").in("goal_id", goalIds).gte("day", monday).lte("day", addDays(monday, 6)).limit(500),
      [],
      "week time",
    ),
  ]);
  const rows = blocks.map((b) => ({
    id: String(b.id),
    title: String(b.title ?? ""),
    goal_id: (b.goal_id as string | null) ?? null,
    starts_at: String(b.starts_at),
    ends_at: (b.ends_at as string | null) ?? null,
    all_day: b.all_day === true,
    location: (b.location as string | null) ?? null,
    kind: String(b.kind),
    source: (b.source as string | null) ?? null,
    answered: !!((b.goal_time as unknown[] | null) ?? []).length,
  }));
  const dayOf = (iso: string) => localDay(iso, tz);
  const goals = weekGoalSummary(
    goalIds,
    rows,
    log.map((t) => ({ goal_id: String(t.goal_id), day: String(t.day), minutes: Number(t.minutes) || 0 })),
    monday,
    new Date(now),
    dayOf,
  );
  const open = openWeekBlocks(rows, goalIds, monday, new Date(now), dayOf).map(({ answered: _a, ...b }) => b);
  return { goals, open };
}

async function converse({ sb, userId, body, send }: { sb: SupabaseClient; userId: string; body: ReqBody; send: (e: Ev) => void }) {
  const { mode, thread, message, context } = body;

  const tz = context.timezone || DEFAULT_TZ;
  const now = Date.now();
  const eventCols = "id, title, starts_at, ends_at, all_day, location, kind, goal_id, source";
  const iso = (t: number) => new Date(t).toISOString();
  // the daily conversation (a thread per day): the last week counts for the excerpt and the WHOOP marks
  const daily = mode === "checkin" && DATE_RE.test(thread);
  const weekThreads = daily ? Array.from({ length: 7 }, (_, i) => addDays(thread, -(i + 1))) : [];
  const dailyP = daily ? loadDaily(sb, userId, thread, now) : Promise.resolve(null);
  const owner = nolioOwner(userId);
  type Msg = { id?: number | string; role: string; content: string };
  // active and paused goals and dreams; bucket = false: without the Bucket List columns (before its migration)
  const openGoals = (bucket = true) =>
    sb
      .from("goals")
      .select<string, Row>(bucket ? `${GOAL_COLS}, ${BUCKET_COLS}` : GOAL_COLS)
      .in("status", ["active", "paused"])
      .order("target_date", { ascending: true, nullsFirst: false })
      .order("created_at")
      .limit(40);

  const [
    profileRes,
    memoriesRes,
    historyRes,
    daysRes,
    termineRes,
    blocksRes,
    pastBlocksRes,
    goalsRes,
    habitsRes,
    extraProfile,
    pushDevice,
    whoopConn,
    nolioSync,
    nolioRows,
    whoopMarkedRows,
    fulfilledRows,
    birthYear,
  ] = await Promise.all([
    sb.from("profiles").select("display_name, location_name, summary, nature_palette, created_at").eq("id", userId).single(),
    sb.from("memories").select("id, category, event_date, content, source").order("created_at", { ascending: true }).limit(400),
    mode === "tidy"
      ? Promise.resolve({ data: [] as { role: string; content: string }[] })
      : sb.from("messages").select("id, role, content").eq("thread", thread).order("id", { ascending: false }).limit(80),
    // Two weeks of mood and energy, so the coach can notice patterns, and today's mood and focus.
    sb.from("days").select("day, mood, focus").lte("day", context.day).order("day", { ascending: false }).limit(15),
    // Appointments from two days back on, also far out (a race in spring), so nothing is entered twice.
    sb.from("events").select(eventCols).eq("kind", "termin").gte("starts_at", iso(now - 2 * DAY_MS)).order("starts_at").limit(60),
    // Planned blocks in their own query, so many of them can't crowd out the appointments;
    // two months ahead, so the coach can still move a planned training plan when something comes up.
    sb
      .from("events")
      .select(eventCols)
      .eq("kind", "block")
      .gte("starts_at", iso(now - 2 * DAY_MS))
      .lt("starts_at", iso(now + 60 * DAY_MS))
      .order("starts_at")
      .limit(150),
    // Past blocks for a goal from the last four weeks (the newest first), with the answer (goal_time) given for them:
    // the pattern per goal, and the open ones of the last week to ask about.
    sb
      .from("events")
      .select(`${eventCols}, goal_time(minutes)`)
      .eq("kind", "block")
      .eq("all_day", false)
      .neq("source", "nolio") // the trainer's plan: the completed training counts by itself
      .not("goal_id", "is", null)
      .gte("starts_at", iso(now - PATTERN_DAYS * DAY_MS))
      .lte("ends_at", iso(now))
      .order("starts_at", { ascending: false })
      .limit(200),
    // Goals and open dreams with the time that went into them (the view goal_minutes), fetched right
    // after, and for open dreams what happened lately (for the reminders «liegt lange»).
    openGoals()
      // before the Bucket List migration (42703: no such column)
      .then((res) => (res.error?.code === "42703" || res.error?.code === "PGRST204" ? openGoals(false) : res))
      .then(async (res) => {
        const rows = res.data ?? [];
        const ids = rows.map((g) => String(g.id));
        // tidying needs no reminders
        const dreams = mode === "tidy" ? [] : rows.filter((g) => g.kind === "dream" && g.status === "active").map((g) => String(g.id));
        if (res.error || !ids.length) return { ...res, time: new Map<string, GoalTimeSum>(), activity: new Map<string, DreamActivity>() };
        const [t, activity] = await Promise.all([
          sb.from("goal_minutes").select("*").in("goal_id", ids), // "*": provisional_minutes only after its migration
          dreamActivity(sb, dreams, context.day, tz),
        ]);
        if (t.error) console.error(t.error);
        return { ...res, time: new Map((t.data ?? []).map((r) => [String(r.goal_id), toTime(r)])), activity };
      }),
    // The filter on habit_logs.day limits the embedded logs, not the habits.
    sb
      .from("habits")
      .select("id, title, per_week, goal_id, habit_logs(day)")
      .eq("active", true)
      .gte("habit_logs.day", habitsSince(context.day))
      .order("created_at")
      .limit(30),
    // Columns from later migrations, apart so that a missing one never breaks the coach.
    soft<{ connections_asked_at?: string | null; calendar_fetched_at?: string | null; notify_morning?: string | null; notify_evening?: string | null } | null>(
      sb.from("profiles").select("connections_asked_at, calendar_fetched_at, notify_morning, notify_evening").eq("id", userId).maybeSingle(),
      null,
      "profile",
    ),
    // a device that allowed notifications (null: unknown)
    mode === "tidy" ? Promise.resolve(null) : soft<{ id: string }[] | null>(sb.from("push_subscriptions").select("id").limit(1), null, "push subscriptions"),
    mode === "tidy"
      ? Promise.resolve(null)
      : soft<{ status: string; consent_ai: boolean } | null>(
          sb.from("connections").select("status, consent_ai").eq("provider", "whoop").maybeSingle(),
          null,
          "connections",
        ),
    owner && mode !== "tidy" ? soft<{ last_sync_at: string | null } | null>(sb.from("nolio_sync").select("last_sync_at").maybeSingle(), null, "nolio_sync") : Promise.resolve(null),
    // Completed trainings of the last week, only for the coach shape (trainingsForCoach) below.
    owner && mode !== "tidy"
      ? soft<Parameters<typeof trainingsForCoach>[0]>(
          sb
            .from("nolio_trainings")
            .select("day, sport_name, minutes, distance_km, source, device_name, restricted")
            .eq("restricted", false)
            .gte("day", addDays(context.day, -7))
            .lte("day", context.day)
            .order("day")
            .limit(40),
          [],
          "nolio_trainings",
        )
      : Promise.resolve([] as Parameters<typeof trainingsForCoach>[0]),
    // Its own replies that had WHOOP values in their context (messages.whoop), in today's thread and the week before.
    mode === "tidy"
      ? Promise.resolve([] as { id: number }[])
      : soft<{ id: number }[]>(
          sb
            .from("messages")
            .select("id")
            .in("thread", [thread, ...weekThreads])
            .eq("whoop", true)
            .limit(200),
          [],
          "whoop_marked",
        ),
    // Fulfilled dreams, the newest first (the Bucket List keeps them as memories)
    mode === "tidy"
      ? Promise.resolve([] as Row[])
      : soft<Row[]>(
          sb.from("goals").select<string, Row>(`${GOAL_COLS}, ${BUCKET_COLS}`).eq("kind", "dream").eq("status", "done").order("done_at", { ascending: false }).limit(20),
          [],
          "fulfilled dreams",
        ),
    // Only a fact for questions about «Leben»; its own query, so a missing column never breaks the profile.
    soft<{ birth_year?: number | null } | null>(sb.from("profiles").select("birth_year").eq("id", userId).maybeSingle(), null, "birth_year"),
  ]);
  if (profileRes.error) throw profileRes.error;
  // The rest only enriches the context: the coach still talks without it.
  for (const r of [memoriesRes, daysRes, termineRes, blocksRes, pastBlocksRes, goalsRes, habitsRes]) if (r.error) console.error(r.error);
  const dailyCtx = await dailyP;
  const goals = (goalsRes.data ?? []).map((g) => {
    const goal = toGoal(g, goalsRes.time.get(String(g.id)));
    return {
      ...goal,
      status: String(g.status),
      activity: goalsRes.activity.get(String(g.id)),
      // a dream resting after her «nicht jetzt», and the overdue dates already asked about
      nudge_after: dailyCtx?.resting.get(goal.id) ?? null,
      // adapting its blocks offered lately (undefined: unknown, then never offered)
      pattern_asked_at: dailyCtx?.patternAsked ? (dailyCtx.patternAsked.get(goal.id) ?? null) : undefined,
      // her Plan B, and whether the coach asked for one (undefined: unknown, then never asked)
      ...planBOf(dailyCtx?.planB, goal.id),
      // a weekly rhythm offered once (undefined: unknown, then never offered)
      rhythm_asked_at: dailyCtx?.rhythmAsked ? (dailyCtx.rhythmAsked.get(goal.id) ?? null) : undefined,
      // its weekly hours and steps asked once as the Anstoss (undefined: unknown, then never asked)
      hours_asked_at: dailyCtx?.nudgeAsked ? (dailyCtx.nudgeAsked.get(goal.id)?.hours ?? null) : undefined,
      steps_asked_at: dailyCtx?.nudgeAsked ? (dailyCtx.nudgeAsked.get(goal.id)?.steps ?? null) : undefined,
      // what she really did for it lately (the size of a proposal); without the daily data: her answered blocks
      ...(dailyCtx ? { sessions: dailyCtx.sessions.get(goal.id) ?? [] } : {}),
      milestones: goal.milestones.map((m) => ({ ...m, overdue_asked_for: dailyCtx?.asked.get(String(m.id)) ?? null })),
    };
  });
  const goalIds = new Set(goals.map((g) => g.id));
  // which entries are days of a weekly rhythm (its own query, so the event queries work before the rhythm's migration)
  const seriesOf = <E extends { id: string }>(e: E): E & { series_id?: string } => {
    const sid = dailyCtx?.seriesOf.get(String(e.id));
    return sid ? { ...e, series_id: sid } : e;
  };
  const events = [...(termineRes.data ?? []), ...(blocksRes.data ?? [])].map(seriesOf).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  // Her own past blocks for a goal in the context, oldest first, with their answer (null = none): the pattern per goal.
  const recentBlocks = (pastBlocksRes.data ?? [])
    .filter((b) => goalIds.has(String(b.goal_id)))
    .reverse()
    .map(({ goal_time: answer, ...b }) => seriesOf({ ...b, minutes: answerMinutes(answer) }));
  // Not answered yet, from the last week: the coach may ask once whether it happened.
  const pastBlocks = recentBlocks
    .filter((b) => b.minutes === null && Date.parse(b.starts_at) >= now - 7 * DAY_MS)
    .slice(-30)
    .map(({ minutes: _none, ...b }) => b);

  // today apart from the days before it
  const allDays = daysRes.data ?? [];
  const today = allDays.find((d) => d.day === context.day) ?? null;
  const recentDays = allDays.filter((d) => d.day !== context.day).slice(0, 14);

  // WHOOP values only with her consent, and then as one line (whoopForCoach checks it again)
  const whoopOn = whoopConfigured();
  let whoopLine: string | null = null;
  if (whoopOn && whoopConn?.consent_ai === true && whoopConn.status === "connected") {
    const rows = await soft<{ day: string }[]>(
      sb
        .from("whoop_days")
        .select("day, recovery_score, hrv_ms, resting_hr, sleep_minutes, sleep_performance, day_strain, workout_count, workout_minutes")
        .gte("day", addDays(context.day, -6))
        .lte("day", context.day),
      [],
      "whoop_days",
    );
    whoopLine = whoopForCoach(whoopConn, rows, context.day);
  }
  // Earlier replies that used WHOOP values go back to the coach only while she still allows it.
  const whoopAllowed = whoopOn && whoopConn?.consent_ai === true && whoopConn.status === "connected";
  const whoopMarked = new Set(whoopMarkedRows.map((r) => String(r.id)));
  const marked = (m: Msg) => m.id !== undefined && whoopMarked.has(String(m.id));
  const historyRows = ((historyRes.data ?? []) as Msg[]).map((m) => (!whoopAllowed && marked(m) ? { ...m, content: WHOOP_HIDDEN_REPLY } : m));
  const talkRows: Msg[] = dailyCtx?.lastTalk?.rows ?? [];
  const talkVisible = whoopAllowed ? talkRows : talkRows.filter((m) => !marked(m));
  // this reply has WHOOP values in its context: today's line, or earlier replies with them
  const whoopInContext =
    !!whoopLine || (whoopAllowed && (((historyRes.data ?? []) as Msg[]).some(marked) || (!(historyRes.data ?? []).length && talkRows.some(marked))));
  const connections: ContextConnections | undefined =
    mode === "tidy"
      ? undefined
      : {
          whoop: whoopOn ? { status: whoopStatusOf(whoopConn?.status), consent_ai: whoopConn?.consent_ai === true } : null,
          nolio: { available: owner, connected: owner && !!nolioSync?.last_sync_at },
          calendarSubscribed: extraProfile ? !!extraProfile.calendar_fetched_at : null,
          // unknown (column missing) → undefined: the coach doesn't ask
          askedAt: extraProfile ? (extraProfile.connections_asked_at ?? null) : undefined,
          // the classic screens have no Verbindungen outside onboarding (only the space sends a view)
          offerable: mode === "onboarding" || !!context.view,
          // when the notifications come and where she changes them (unknown profile: no line)
          notify: extraProfile
            ? { morning: extraProfile.notify_morning ?? null, evening: extraProfile.notify_evening ?? null, device: pushDevice ? pushDevice.length > 0 : null }
            : undefined,
        };

  const opener =
    mode === "tidy"
      ? "(Stilles Aufräumen der Erinnerungen.)"
      : (message ?? (mode === "onboarding" ? "(Die App wird zum ersten Mal geöffnet.)" : "(Die App wurde gerade geöffnet.)"));
  // Tidying is invisible: nothing goes into the conversation.
  if (mode !== "tidy") await sb.from("messages").insert({ user_id: userId, thread, role: "user", content: opener, hidden: !message });

  const history: Anthropic.Beta.BetaMessageParam[] = historyRows
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "user", content: opener }];
  // The API wants the conversation to start with the person.
  while (messages.length && messages[0].role !== "user") messages.shift();

  const habits = (habitsRes.data ?? []).map(({ habit_logs, ...h }) => ({
    ...h,
    done_days: ((habit_logs as { day: string }[] | null) ?? []).map((l) => l.day).sort(),
  }));
  const { created_at: startedAt, ...profileRow } = profileRes.data;
  const input: ContextInput = {
    ...context,
    timezone: tz,
    now: iso(now),
    profile: { ...profileRow, birth_year: typeof birthYear?.birth_year === "number" ? birthYear.birth_year : null },
    // the early dream invitation belongs to her second week with the app
    startedAt: typeof startedAt === "string" ? startedAt : null,
    memories: (memoriesRes.data ?? []).map((m) => ({ ...m, followed_up_at: dailyCtx?.followed.get(String(m.id)) ?? null })),
    recentDays,
    today,
    // only while today's conversation is still empty: the greeting may pick up one point from it
    lastTalk: !(historyRes.data ?? []).length && dailyCtx?.lastTalk && talkVisible.length ? { day: dailyCtx.lastTalk.day, messages: [...talkVisible].reverse() } : undefined,
    lastSeen: dailyCtx ? dailyCtx.lastSeen : undefined,
    todayLog: dailyCtx?.todayLog,
    connections,
    trainings: trainingsForCoach(nolioRows),
    whoop: whoopLine,
    // the selects above have every field; fulfilled dreams after the open goals and dreams
    goals: [...goals, ...fulfilledRows.map((g) => toGoal(g))] as unknown as ContextGoal[],
    habits,
    events,
    pastBlocks,
    recentBlocks,
    series: dailyCtx?.series ?? undefined,
    nudge: dailyCtx?.nudge,
  };

  if (dailyCtx) {
    const p = dailyCtx.profile;
    // her clock, a pause, a heavy time and the Wochenblick, from what was stored (dailySituation); an unknown
    // Wochenblick state (columns before their migration): never offered, since nothing could be noted
    const { minutes, pause, heavy, review: due } = dailySituation({
      day: context.day,
      now: new Date(now),
      tz,
      lastSeenDay: dailyCtx.lastSeen,
      lastSpoke: dailyCtx.lastSpoke,
      todayMood: today?.mood,
      recentDays,
      review: p ? { week: p.review_week ?? null, declines: Number(p.review_declines) || 0, wanted: typeof p.review_wanted === "boolean" ? p.review_wanted : null } : null,
      hasPlanGoal: hasPlanGoal(goals),
      // a greeting that opened with it on an earlier day and that she answered: offered, even if no tool noted it (K9)
      reviewOfferedOn: dailyCtx.openers.filter((r) => r.kind === "wochenblick" && r.day < context.day && (dailyCtx.talkCounts[r.day] ?? 0) > 0).map((r) => r.day),
    });
    if (due) {
      const monday = addDays(reviewWeek(context.day, minutes), -7);
      input.review = { due, monday, ...(await weekSummaryFor(sb, goals.map((g) => g.id), monday, tz, now)) };
    }
    // unknown state (columns before their migration): no rare offers, since nothing could be noted
    if (p) {
      const supportAt = p.support_hint_at ? localDay(p.support_hint_at, tz) : null;
      input.hints = {
        experiment: experimentDue(goals, p.experiment_at, context.day, (t) => localDay(t, tz)),
        support: leansOnCoach(dailyCtx.talkCounts, recentDays, context.day) && (!supportAt || daysBetween(supportAt, context.day) >= SUPPORT_EVERY_DAYS),
      };
    }
    // The first greeting of the day: how it opens is chosen here, so it really changes from day to day
    // (chooseOpener), and noted on the day (days.opener).
    if (!message && !(historyRes.data ?? []).length) {
      const stored = dailyCtx.openers.find((r) => r.day === context.day)?.kind;
      // her yes of an evening (come_back): not brought up yet, or brought up in today's greeting (a second open today)
      const pendingBack = dailyCtx.comeBack.find((r) => !r.at) ?? null;
      const raisedBack = dailyCtx.comeBack.find((r) => r.at && localDay(r.at, tz) === context.day) ?? null;
      // the day's one Anstoss (todayNudge): it opens the greeting after three days without one (the Wochenblick: its own opener)
      const nudge = todayNudge(input);
      const kind: OpenerKind = isOpenerKind(stored)
        ? stored
        : chooseOpener(
            {
              minutes,
              pause,
              wochenblick: !!input.review,
              available: openerCandidates(input),
              quiet: heavy,
              comeBack: !!pendingBack,
              anstoss: !!nudge?.greeting && nudge.kind !== "wochenblick",
            },
            dailyCtx.openers.filter((r) => r.day !== context.day),
            context.day,
          );
      input.opener = kind;
      if (kind === "zurueck") input.comeBack = (raisedBack ?? pendingBack)?.text;
      if (kind !== stored) {
        const { error } = await sb.from("days").upsert({ user_id: userId, day: context.day, opener: kind }, { onConflict: "user_id,day" });
        if (error) console.error("days.opener:", error.code ?? "error");
      }
      // the greeting carries the day's Anstoss: no other one today (its own tool notes that it was asked)
      if (kind !== stored && nudge && (kind === "anstoss" || (kind === "wochenblick" && nudge.kind === "wochenblick"))) await noteNudge(sb, context.day, nudge.kind);
      // exactly once: from now on it is brought up (a later open today still finds it for the stored opener)
      if (kind === "zurueck" && pendingBack && !raisedBack) {
        const { error } = await sb.from("days").update({ come_back_at: iso(now) }).eq("user_id", userId).eq("day", pendingBack.day);
        if (error) console.error("days.come_back_at:", error.code ?? "error");
      }
    }
  }

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // Stable: persona + mode rules (cached across requests).
    { type: "text", text: `${PERSONA}\n\n${mode === "onboarding" ? MODE_ONBOARDING : mode === "tidy" ? MODE_TIDY : MODE_CHECKIN}`, cache_control: { type: "ephemeral" } },
    // Changes every turn: time, weather, memories, goals, habits, calendar.
    { type: "text", text: contextBlock(input) },
  ];

  const tools =
    mode === "onboarding"
      ? TOOLS.filter((t) => !CHECKIN_ONLY.has(t.name))
      : mode === "tidy"
        ? TOOLS.filter((t) => ["remember", "update_memory", "forget"].includes(t.name))
        : TOOLS.filter((t) => t.name !== "finish_onboarding");
  let fullText = "";
  let lastRoundText = ""; // what the last round that said something said

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

    // everything is read aloud: no emojis or emoticons, also when the model slips one in, and never a
    // sentence about the reply itself (a draft's «Das sind zwei Fragen, also nur eine:»); a greeting (no
    // message) goes out whole, as finalVersion, so not even the draft before such a sentence is heard
    const spoken = spokenStream();
    const draft = draftStream({ whole: !message });
    // the same reply again after a tool round (once in a live check, around a redundant call): heard and saved once
    const repeat = repeatGuard(lastRoundText);
    let roundText = "";
    const out = (text: string) => {
      if (!text) return;
      if (!roundText && fullText) {
        fullText += "\n\n";
        send({ type: "text", text: "\n\n" });
      }
      roundText += text;
      fullText += text;
      send({ type: "text", text });
    };
    const emit = (text: string) => out(repeat.push(text));
    stream.on("text", (delta) => emit(draft.push(spoken.push(delta))));

    const msg = await stream.finalMessage();
    emit(draft.push(spoken.flush()));
    emit(draft.flush());
    out(repeat.flush());
    if (roundText) lastRoundText = roundText;

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
        // a turn without her words (the greeting) writes nothing of hers (K4); tidying is no conversation
        const refused = mode !== "tidy" && !message ? greetingWriteRefusal(tu.name, input) : null;
        if (refused) return { type: "tool_result" as const, tool_use_id: tu.id, content: refused, is_error: true };
        const out = await runTool(tu.name, input, { sb, userId, day: context.day, tz, mode, send, whoop: whoopInContext });
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

  // a draft that slipped in before the reply: only the final version is kept (and is what the coach sees later)
  const reply = finalVersion(stripEmoji(fullText).trim());
  if (mode !== "tidy" && reply) {
    // the shape only (no content), to spot long answers and double questions
    const shape = replyShape(reply);
    console.log(`coach reply: words=${shape.words} questions=${shape.questions}${shape.words > 70 ? " long" : ""}${shape.questions > 1 ? " multi-question" : ""}`);
    // marked when WHOOP values were in its context: cleared on disconnect and after 14 days (whoop_purge)
    const row: Record<string, unknown> = { user_id: userId, thread, role: "assistant", content: reply };
    let saved = await sb.from("messages").insert(whoopInContext ? { ...row, whoop: true } : row);
    if (saved.error && whoopInContext) saved = await sb.from("messages").insert(row); // never lose the reply over the mark
    if (saved.error) console.error("coach reply not saved:", (saved.error as { code?: string }).code ?? "error");
  }
}
