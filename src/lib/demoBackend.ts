// Demo mode: runs fully in the browser with a scripted coach, so the app can
// be tried before Supabase and the AI are set up. Everything stays on this
// device. It's a preview, not a real coach.

import type {
  Backend,
  CalendarEvent,
  ChatMessage,
  CoachEvent,
  CoachRequest,
  DayState,
  EventInput,
  Goal,
  GoalInput,
  GoalTime,
  Habit,
  HabitInput,
  Memory,
  MemoryCategory,
  Milestone,
  Profile,
} from "./types";
import { normaliseUsername, USERNAME_RE } from "./types";
import type { NaturePalette } from "./palette";
import { addDays, dayOf, goalEffort, hoursLabel, weekStart } from "./plan";

interface DemoUser {
  passwordHash: string;
  profile: Profile;
  memories: Memory[];
  messages: Record<string, ChatMessage[]>;
  days: Record<string, DayState>;
  events: CalendarEvent[];
  /** with their milestones; their time is worked out when read, like the view goal_minutes */
  goals: StoredGoal[];
  /** like the goal_time table */
  goal_time: GoalTime[];
  /** done_days holds the whole history, like the habit_logs table */
  habits: Habit[];
}
type StoredGoal = Omit<Goal, "time">;

// The demo coach understands simple appointments, e.g. "Samstag um 9 habe ich ein Rennen"
// or "Training am 3.12. um 18:30". The real coach (Claude) understands anything.
const WEEKDAYS = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
const KINDS: [RegExp, string][] = [
  [/halbmarathon/i, "Halbmarathon"],
  [/marathon/i, "Marathon"],
  [/rennen|wettkampf|lauf\b/i, "Rennen"],
  [/training/i, "Training"],
  [/prüfung/i, "Prüfung"],
  [/arzt|zahnarzt/i, "Arzttermin"],
  [/treffen|meeting|termin/i, "Termin"],
];
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const MONTH = "(januar|jänner|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)";
const monthIndex = (name: string) => MONTHS.indexOf(name === "jänner" ? "januar" : name === "maerz" ? "märz" : name);

export interface DemoDate {
  date: Date; // local midnight
  /** "day": a calendar date (3.12., 6. Dezember); "month": only a month (bis März); "relative": morgen, a weekday */
  kind: "day" | "month" | "relative";
  /** where the date words are in the text, so a title can do without them */
  index: number;
  length: number;
}

/** Finds the first date of one of the given kinds. A date without year that has passed means next year. */
export function parseDemoDate(text: string, now = new Date(), kinds: DemoDate["kind"][] = ["day", "month", "relative"]): DemoDate | null {
  const t = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const make = (year: string | undefined, month: number, day: number): Date | null => {
    const y = year ? (+year < 100 ? 2000 + +year : +year) : now.getFullYear();
    const d = new Date(y, month, day);
    if (month < 0 || month > 11 || d.getMonth() !== month) return null; // 31.2. or a time like 18.30
    if (!year && d < today) d.setFullYear(y + 1, month, day);
    return d;
  };
  if (kinds.includes("day")) {
    for (const m of t.matchAll(/(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?/g)) {
      const d = make(m[3], +m[2] - 1, +m[1]);
      if (d) return { date: d, kind: "day", index: m.index, length: m[0].length };
    }
    for (const m of t.matchAll(new RegExp(`(\\d{1,2})\\.?\\s*${MONTH}(?![a-zäöü])(?:\\s+(\\d{4}))?`, "g"))) {
      const d = make(m[3], monthIndex(m[2]), +m[1]);
      if (d) return { date: d, kind: "day", index: m.index, length: m[0].length };
    }
  }
  if (kinds.includes("relative")) {
    const rel = (offset: number, at: number, length: number): DemoDate => ({
      date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
      kind: "relative",
      index: at,
      length,
    });
    if (t.includes("übermorgen")) return rel(2, t.indexOf("übermorgen"), 10);
    if (t.includes("morgen")) return rel(1, t.indexOf("morgen"), 6);
    const wd = WEEKDAYS.findIndex((w) => t.includes(w));
    if (wd >= 0) return rel((wd - now.getDay() + 7) % 7 || 7, t.indexOf(WEEKDAYS[wd]), WEEKDAYS[wd].length);
  }
  if (kinds.includes("month")) {
    // "bis März" means the whole month, so the goal date is its last day; "Anfang"/"Mitte" move it earlier.
    const m = new RegExp(`(?:(anfang|mitte|ende)\\s+)?\\b${MONTH}(?![a-zäöü])(?:\\s+(\\d{4}))?`).exec(t);
    if (m) {
      const month = monthIndex(m[2]);
      const y = m[3] ? +m[3] : now.getFullYear();
      const dayIn = (year: number) => (m[1] === "anfang" ? 1 : m[1] === "mitte" ? 15 : new Date(year, month + 1, 0).getDate());
      let d = new Date(y, month, dayIn(y));
      if (!m[3] && d < today) d = new Date(y + 1, month, dayIn(y + 1));
      return { date: d, kind: "month", index: m.index, length: m[0].length };
    }
  }
  return null;
}

export function parseDemoEvent(text: string, now = new Date()): { title: string; start: Date; allDay: boolean } | null {
  const kind = KINDS.find(([re]) => re.test(text));
  if (!kind) return null;
  const found = parseDemoDate(text, now, ["day", "relative"]);
  if (!found) return null;
  const date = new Date(found.date);
  const tm = text.toLowerCase().match(/um (\d{1,2})(?:[:.](\d{2}))?/);
  if (tm) date.setHours(+tm[1], tm[2] ? +tm[2] : 0, 0, 0);
  return { title: kind[1], start: date, allDay: !tm };
}

// The demo coach also notices a goal ("Mein Ziel ist der Halbmarathon am 6. Dezember",
// "Ich will bis März 10 kg abnehmen") and a habit done today ("Ich war heute laufen").
const GOAL_START = /^\s*(?:(mein ziel)(?:\s+ist)?(?:\s+es)?\s*[:,]?|ich (?:will|möchte|moechte))\s+/i;
const DATE_WORDS = /(?:\s*\b(?:bis|am|zum|zur|im|in|vor|spätestens|ende|anfang|mitte)\b)+\s*$/i;
const ARTICLE = /^(?:der|die|das|den|dem|ein|eine|einen|einem)\s+/i;
// "um 18:30", "um 9 Uhr" – but not "um 10 kg", "um 5 Minuten"
const CLOCK = /\bum \d{1,2}(?:[:.]\d{2})?(?!\d)(?!\s*(?:%|(?:kg|kilo|km|cm|m|meter|prozent|punkte|plätze|minuten|min|sekunden|sek|stunden|std|h|mal|x)(?![a-zäöü])))/i;
const LEADING_CLOCK = /^um\s+\d{1,2}(?:[:.]\d{2}(?:\s*uhr)?|\s*uhr)(?![a-zäöü\d])[\s,]*/i;
// appointments of everyday life; races and exams can be goals
const EVERYDAY = new Set(["Training", "Arzttermin", "Termin"]);

/** A goal in a message, or null. Title without the lead-in and the date words; target date as YYYY-MM-DD. */
export function parseDemoGoal(text: string, now = new Date()): { title: string; target_date: string | null } | null {
  const lead = GOAL_START.exec(text);
  if (!lead || /\?\s*$/.test(text)) return null; // questions aren't goals
  let rest = text.slice(lead[0].length);
  if (/^(?:nicht|kein)/i.test(rest)) return null;
  const found = parseDemoDate(rest, now, ["day", "month"]);
  // "ich will …" is everyday speech ("ich will heute früh schlafen"); only with a date is it a goal,
  // and not with a clock time or an everyday appointment ("ich will am 5.12. zum Zahnarzt")
  if (!lead[1]) {
    if (!found || CLOCK.test(text)) return null;
    const ev = parseDemoEvent(text, now);
    if (ev && EVERYDAY.has(ev.title)) return null;
  }
  if (found) {
    const before = rest.slice(0, found.index).replace(DATE_WORDS, "");
    const after = rest.slice(found.index + found.length);
    // "… am 6.12. Ich freue mich": the date's dot also ended the sentence
    const ends = /\.$/.test(rest.slice(found.index, found.index + found.length)) && before.trim() && /^\s+[A-ZÄÖÜ]/.test(after);
    rest = before + (ends ? ". " : " ") + after;
  }
  let title = rest.split(/[.!?;](?:\s|$)/)[0].replace(/\s+/g, " ").replace(/^[\s,:–-]+|[\s,:–-]+$/g, "");
  title = title.replace(LEADING_CLOCK, "").replace(ARTICLE, "").slice(0, 120).trim();
  if (title.length < 3 || /^(?:das|dies|es|so)$/i.test(title)) return null;
  return { title: title[0].toUpperCase() + title.slice(1), target_date: found ? dayOf(found.date) : null };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .split(/[^a-z0-9äöüàáâçéèêëíìîïñóòôúùû]+/)
    .filter(Boolean);
// past-tense words: "ich war laufen", "Yoga gemacht"
const DONE = new Set(["war", "waren", "habe", "hab", "hatte", "gemacht", "erledigt", "geschafft", "fertig", "abgehakt", "gegangen", "gewesen"]);
// a no, or something still to come
const NOT_DONE = new Set(["nicht", "kein", "keine", "keinen", "nie", "ohne", "verpasst", "ausgelassen", "will", "möchte", "werde", "muss", "sollte", "morgen", "später", "nachher", "wenig"]);

/** The active habits a message says were done, e.g. "Ich war heute laufen" for "Laufen" (whole words). */
export function recogniseDemoHabits<H extends Pick<Habit, "title" | "active">>(text: string, habits: H[]): H[] {
  const w = words(text);
  if (!w.some((x) => DONE.has(x)) || w.some((x) => NOT_DONE.has(x))) return [];
  return habits.filter((h) => {
    const t = words(h.title);
    if (!h.active || !t.length) return false;
    for (let i = 0; i + t.length <= w.length; i++) if (t.every((x, j) => w[i + j] === x)) return true;
    return false;
  });
}

// Reported time: "heute 1,5 Stunden trainiert", "45 Minuten gelaufen", "2 Std gelernt".
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(stunden?|std\.?|h|minuten?|min\.?)(?![a-zäöü])/gi;
const AMOUNT_WORDS = /\b(eine?r?|zwei|drei|vier|fünf|halbe|anderthalb|eineinhalb|zweieinhalb)\s+(stunden?|std\.?|minuten?)(?![a-zäöü])/gi;
const NUMBER_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, halbe: 0.5, anderthalb: 1.5, eineinhalb: 1.5, zweieinhalb: 2.5,
};
// past participles ("gelernt", "gelaufen", "trainiert") besides the words in DONE;
// "habe" alone is no hint here ("ich habe 1 Stunde Training" is a plan)
const PAST = /^(?:ge[a-zäöü]{2,}(?:t|en)|[a-zäöü]+iert(?:e|en)?)$/;
const spentHint = (x: string) => (DONE.has(x) && x !== "habe" && x !== "hab") || PAST.test(x);
// "in 2 Stunden", "vor einer Stunde", "um 18h": a moment, not time spent
const NOT_AMOUNT = /\b(?:in|vor|nach|alle|ab|bis|um)\s*$/i;
// time that's planned, needed or available, not done
const NOT_SPENT = new Set([...NOT_DONE, "zeit", "pro", "woche", "wochen", "geplant", "eingeplant", "brauche", "braucht", "frei", "dauert", "nötig"]);
const TITLE_STOP = new Set(["eine", "einen", "einem", "mehr", "sein", "werden", "jeden", "jede", "viel", "machen", "schaffen", "bitte"]);

/** Minutes a message reports as spent (e.g. "1,5 Stunden trainiert" → 90), or null. */
export function parseDemoMinutes(text: string): { minutes: number; daysAgo: 0 | 1 } | null {
  const t = text.replace(/\bheute\s+morgen\b/gi, "heute"); // "this morning", not tomorrow
  const w = words(t);
  if (!w.some(spentHint) || w.some((x) => NOT_SPENT.has(x))) return null;
  const toMin = (unit: string) => (unit.toLowerCase().startsWith("m") ? 1 : 60);
  const counts = (m: RegExpExecArray) => !NOT_AMOUNT.test(t.slice(0, m.index));
  let minutes = 0;
  for (const m of t.matchAll(AMOUNT)) if (counts(m)) minutes += Number(m[1].replace(",", ".")) * toMin(m[2]);
  for (const m of t.matchAll(AMOUNT_WORDS)) if (counts(m)) minutes += NUMBER_WORDS[m[1].toLowerCase()] * toMin(m[2]);
  minutes = Math.round(minutes);
  if (minutes < 1 || minutes > 1440) return null;
  return { minutes, daysAgo: /\bgestern\b/i.test(t) ? 1 : 0 };
}

/**
 * Time a message reports for a goal: to the active goal whose title words appear in it,
 * else to the only active goal. Null when nothing fits.
 */
export function recogniseDemoTime<G extends Pick<Goal, "title" | "status">>(text: string, goals: G[]): { goal: G; minutes: number; daysAgo: 0 | 1 } | null {
  const spent = parseDemoMinutes(text);
  if (!spent) return null;
  const w = new Set(words(text));
  const active = goals.filter((g) => g.status === "active");
  const score = (g: G) => words(g.title).filter((x) => x.length >= 4 && !TITLE_STOP.has(x) && w.has(x)).length;
  let best: G | null = null;
  for (const g of active) if (score(g) > (best ? score(best) : 0)) best = g;
  const goal = best ?? (active.length === 1 ? active[0] : null);
  return goal ? { goal, ...spent } : null;
}

/** Hours or minutes as the coach says them: "45 Min", "1.5 Std". */
export function minutesLabel(min: number): string {
  return min < 60 ? `${min} Min` : `${hoursLabel(min / 60)} Std`;
}

/**
 * The goal_time entry that answers a planned block (shared with the Supabase backend):
 * done = its planned length (or `minutes`), not done = 0 minutes, on the block's local start day.
 */
export function blockTimeEntry(
  ev: Pick<CalendarEvent, "kind" | "goal_id" | "starts_at" | "ends_at" | "all_day"> | null,
  done: boolean,
  minutes?: number,
): { goal_id: string; day: string; minutes: number } {
  if (!ev) throw new Error("Diesen Eintrag gibt es nicht mehr.");
  if (ev.kind !== "block" || !ev.goal_id) throw new Error("Das ist kein geplanter Block für ein Ziel.");
  const planned = ev.all_day || !ev.ends_at ? null : (Date.parse(ev.ends_at) - Date.parse(ev.starts_at)) / 60000;
  const m = done ? (minutes ?? planned) : 0;
  if (m === null || !Number.isFinite(m)) throw new Error("Wie lange hat es gedauert? Gib bitte die Minuten an.");
  return { goal_id: ev.goal_id, day: dayOf(new Date(ev.starts_at)), minutes: Math.min(1440, Math.max(0, Math.round(m))) };
}

const KEY = "ich.demo.users";
const SESSION = "ich.demo.session";

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Leaves out undefined values, as the JSON sent to Supabase does. */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Start of the habit history the app shows: the current week and the 15 before it. */
const habitsSince = () => addDays(weekStart(dayOf()), -15 * 7);

const byGoalOrder = (a: Pick<Goal, "target_date" | "created_at">, b: Pick<Goal, "target_date" | "created_at">) =>
  a.target_date === b.target_date
    ? a.created_at.localeCompare(b.created_at)
    : a.target_date === null
      ? 1
      : b.target_date === null
        ? -1
        : a.target_date.localeCompare(b.target_date);
// Like the view goal_minutes: logged time, plus past blocks of the goal nobody answered yet.
function presenter(u: DemoUser, at = Date.now()): (g: StoredGoal) => Goal {
  const answered = new Set(u.goal_time.flatMap((t) => (t.event_id ? [t.event_id] : [])));
  return (g) => {
    const logged = u.goal_time.reduce((sum, t) => (t.goal_id === g.id ? sum + t.minutes : sum), 0);
    const blocks = u.events.reduce(
      (sum, e) =>
        e.goal_id === g.id && e.kind === "block" && !e.all_day && e.ends_at && Date.parse(e.ends_at) <= at && !answered.has(e.id)
          ? sum + Math.min(1440, (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60000)
          : sum,
      0,
    );
    return {
      ...g,
      milestones: [...g.milestones].sort((a, b) => a.position - b.position),
      time: { logged_minutes: logged, block_minutes: Math.round(blocks) },
    };
  };
}
const withRecentDays = (h: Habit, since = habitsSince()): Habit => ({ ...h, done_days: h.done_days.filter((d) => d >= since).sort() });

// Like the check constraint on events.reminder_minutes: from a day after the start to a week before.
function checkReminder(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return;
  if (!Number.isInteger(minutes) || minutes < -1440 || minutes > 10080)
    throw new Error("Die Erinnerung muss zwischen einer Woche vorher und einem Tag danach liegen.");
}

// Like the checks on goals: hours from 0 up to a limit, one decimal (numeric(…, 1)).
const EFFORT_LIMITS = { effort_hours: 100000, weekly_hours: 168, prior_hours: 100000 } as const;
type EffortFields = Partial<Pick<Goal, "effort_hours" | "weekly_hours" | "prior_hours">>;
function effortFields(p: Partial<GoalInput>): EffortFields {
  const out: Record<string, number | null> = {};
  for (const [key, max] of Object.entries(EFFORT_LIMITS) as [keyof typeof EFFORT_LIMITS, number][]) {
    const v = p[key] as number | null | undefined;
    if (v === undefined) continue;
    if (v === null) out[key] = key === "prior_hours" ? 0 : null; // prior_hours is "not null default 0"
    else if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max)
      throw new Error(`Bitte eine Zahl zwischen 0 und ${hoursLabel(max)} Stunden.`);
    else out[key] = Math.round(v * 10) / 10;
  }
  return out as EffortFields;
}

// Like the owner-check triggers in the database: links only to one's own goals.
function checkGoal(u: DemoUser, goalId: string | null | undefined) {
  if (goalId && !u.goals.some((g) => g.id === goalId)) throw new Error("Dieses Ziel gibt es nicht mehr.");
}

const ONBOARDING: { q: (name: string) => string; category: MemoryCategory }[] = [
  { q: () => "Hoi, schön, dass du da bist. Ich möchte dich gern ein bisschen kennenlernen, damit ich dich gut begleiten kann. Wie darf ich dich nennen?", category: "person" },
  { q: (n) => `Freut mich, ${n}. Was machst du so im Alltag – Arbeit, Studium, oder etwas ganz anderes?`, category: "arbeit" },
  { q: () => "Danke dir. Was ist dir im Leben gerade besonders wichtig?", category: "werte" },
  { q: () => "Wie sieht dein Rhythmus aus? Bist du eher ein Morgen- oder ein Abendmensch, und wann hast du am meisten Energie?", category: "rhythmus" },
  { q: () => "Gibt es etwas, auf das du gerade hinarbeitest – ein Ziel, ein Rennen, ein Projekt?", category: "ziel" },
  { q: () => "Und jetzt etwas Schönes: Welcher Ort in der Natur tut dir gut? Ein Bergsee, das Meer, ein Wald im Herbst …?", category: "natur" },
  { q: () => "Wo wohnst du ungefähr? Wenn du magst, kannst du unten auch deinen Standort freigeben, dann passe ich die Farben an dein Wetter und deinen Sonnenuntergang an.", category: "person" },
];

const NATURE: { words: string[]; palette: NaturePalette }[] = [
  { words: ["see", "berg", "alp", "gletscher"], palette: { name: "Bergsee", colors: ["#4fa3b8", "#9fd3c7", "#e7f0e9", "#6f8fb5", "#2f6f73"] } },
  { words: ["meer", "strand", "küste", "ozean"], palette: { name: "Meer", colors: ["#3fa7c9", "#a8e0e8", "#f3dfc1", "#6ec6b8", "#1f6f99"] } },
  { words: ["wald", "baum", "moos"], palette: { name: "Wald", colors: ["#4f8a5b", "#a7c97d", "#d9c48a", "#2f5d46", "#c98f5a"] } },
  { words: ["herbst", "laub"], palette: { name: "Herbstwald", colors: ["#d9823b", "#e8b04f", "#a8452f", "#7d5a3c", "#f0d08a"] } },
  { words: ["blume", "wiese", "garten", "frühling"], palette: { name: "Blumenwiese", colors: ["#f2a2c0", "#f7d35c", "#a4d17a", "#b79be0", "#ffffff"] } },
  { words: ["wüste", "sand", "düne"], palette: { name: "Wüste", colors: ["#e3a96b", "#f2cf9b", "#c4704a", "#f6e3c4", "#9a5a3c"] } },
  { words: ["schnee", "winter"], palette: { name: "Winterlandschaft", colors: ["#dbe8f5", "#a9c4e3", "#ffffff", "#8aa6c8", "#c7d6ea"] } },
];

function moodFrom(text: string) {
  const t = text.toLowerCase();
  if (/(super|mega|toll|sehr gut|happy|glücklich|wunderbar)/.test(t)) return { valence: 0.8, energy: 0.8, word: "froh" };
  if (/(gut|ok|okay|ganz gut|passt)/.test(t)) return { valence: 0.4, energy: 0.6, word: "gut" };
  if (/(müde|erschöpft|kaputt|schlapp)/.test(t)) return { valence: -0.1, energy: 0.15, word: "müde" };
  if (/(schlecht|traurig|gestresst|stress|mies|schwer)/.test(t)) return { valence: -0.6, energy: 0.35, word: "schwer" };
  return { valence: 0.1, energy: 0.5, word: "gemischt" };
}

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  private listeners = new Set<(id: string | null) => void>();

  private load(): Record<string, DemoUser> {
    let users: Record<string, DemoUser>;
    try {
      users = JSON.parse(localStorage.getItem(KEY) || "{}") ?? {};
    } catch {
      return {};
    }
    // Demo users stored before the calendar or the plan existed lack these fields.
    for (const u of Object.values(users)) {
      u.events = (u.events ?? []).map((e) => ({ ...e, kind: e.kind ?? "termin", goal_id: e.goal_id ?? null }));
      u.goals = (u.goals ?? []).map((g) => ({ ...g, effort_hours: g.effort_hours ?? null, weekly_hours: g.weekly_hours ?? null, prior_hours: g.prior_hours ?? 0 }));
      u.goal_time ??= [];
      u.habits ??= [];
    }
    return users;
  }
  private save(users: Record<string, DemoUser>) {
    localStorage.setItem(KEY, JSON.stringify(users));
  }
  private session(): string | null {
    try {
      return localStorage.getItem(SESSION);
    } catch {
      return null;
    }
  }
  private user(): DemoUser {
    const u = this.session();
    const users = this.load();
    if (!u || !users[u]) throw new Error("Nicht eingeloggt.");
    return users[u];
  }
  private mutate(fn: (u: DemoUser) => void) {
    const name = this.session();
    const users = this.load();
    if (!name || !users[name]) throw new Error("Nicht eingeloggt.");
    fn(users[name]);
    this.save(users);
  }
  private emit() {
    const id = this.session();
    const uid = id ? this.load()[id]?.profile.id ?? null : null;
    this.listeners.forEach((l) => l(uid));
  }

  async currentUserId() {
    const name = this.session();
    return name ? this.load()[name]?.profile.id ?? null : null;
  }
  onAuthChange(cb: (id: string | null) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async signUp(username: string, password: string) {
    const u = normaliseUsername(username);
    if (!USERNAME_RE.test(u)) throw new Error("Benutzername: 3–30 Zeichen, nur a–z, 0–9, Punkt, Strich, Unterstrich.");
    if (password.length < 8) throw new Error("Das Passwort braucht mindestens 8 Zeichen.");
    const users = this.load();
    if (users[u]) throw new Error("Diesen Benutzernamen gibt es schon.");
    users[u] = {
      passwordHash: await sha256(u + ":" + password),
      profile: { id: uuid(), username: u, display_name: null, onboarded: false, summary: null, nature_palette: null, location_name: null, lat: null, lon: null },
      memories: [],
      messages: {},
      days: {},
      events: [],
      goals: [],
      goal_time: [],
      habits: [],
    };
    this.save(users);
    localStorage.setItem(SESSION, u);
    this.emit();
  }

  async signIn(username: string, password: string) {
    const u = normaliseUsername(username);
    const user = this.load()[u];
    if (!user || user.passwordHash !== (await sha256(u + ":" + password))) throw new Error("Benutzername oder Passwort stimmt nicht.");
    localStorage.setItem(SESSION, u);
    this.emit();
  }

  async signOut() {
    localStorage.removeItem(SESSION);
    this.emit();
  }

  async getProfile() {
    return this.user().profile;
  }
  async updateProfile(patch: Partial<Profile>) {
    this.mutate((u) => Object.assign(u.profile, patch));
  }
  async listMemories() {
    return this.user().memories;
  }
  async addMemory(m: Pick<Memory, "content" | "category" | "event_date"> & { source?: Memory["source"] }) {
    const mem: Memory = { source: "person", ...m, id: uuid(), created_at: now(), updated_at: now() };
    this.mutate((u) => u.memories.push(mem));
    return mem;
  }
  async updateMemory(id: string, patch: Partial<Memory>) {
    this.mutate((u) => {
      const m = u.memories.find((x) => x.id === id);
      if (m) Object.assign(m, patch, { updated_at: now() });
    });
  }
  async deleteMemory(id: string) {
    this.mutate((u) => (u.memories = u.memories.filter((m) => m.id !== id)));
  }
  async listEvents(from?: string, to?: string) {
    const since = from ? new Date(from).getTime() : Date.now() - 24 * 3600 * 1000;
    const until = to ? new Date(to).getTime() : Infinity;
    return this.user()
      .events.filter((e) => {
        const t = new Date(e.starts_at).getTime();
        return t >= since && t < until;
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  async addEvent(e: EventInput, source: CalendarEvent["source"] = "person") {
    const ev: CalendarEvent = { ...e, kind: e.kind ?? "termin", goal_id: e.goal_id ?? null, id: uuid(), source, sequence: 0, updated_at: now() };
    checkReminder(ev.reminder_minutes);
    this.mutate((u) => {
      checkGoal(u, ev.goal_id);
      u.events.push(ev);
    });
    return ev;
  }
  async updateEvent(id: string, patch: Partial<EventInput>) {
    let out!: CalendarEvent;
    this.mutate((u) => {
      const ev = u.events.find((e) => e.id === id);
      if (!ev) throw new Error("Diesen Eintrag gibt es nicht mehr.");
      checkGoal(u, patch.goal_id);
      checkReminder(patch.reminder_minutes);
      const before = { ...ev };
      // like the events_bump trigger, so a calendar file picks up the change
      Object.assign(ev, defined(patch), { sequence: (ev.sequence ?? 0) + 1, updated_at: now() });
      // like the events_block_answer trigger: a block's answer follows the block
      const notPastBlock = ev.kind !== "block" || ev.all_day || !ev.ends_at || new Date(ev.ends_at).getTime() > Date.now() || !ev.goal_id;
      if (notPastBlock || ev.starts_at !== before.starts_at || ev.ends_at !== before.ends_at) {
        u.goal_time = u.goal_time.filter((t) => t.event_id !== id);
      } else if (ev.goal_id !== before.goal_id) {
        for (const t of u.goal_time) if (t.event_id === id) t.goal_id = ev.goal_id!;
      }
      out = { ...ev };
    });
    return out;
  }
  async deleteEvent(id: string) {
    this.mutate((u) => {
      u.events = u.events.filter((e) => e.id !== id);
      // like "on delete set null": the time stays, without the block
      for (const t of u.goal_time) if (t.event_id === id) t.event_id = null;
    });
  }

  async listGoals(all = false): Promise<Goal[]> {
    const u = this.user();
    return u.goals
      .filter((g) => all || g.status === "active" || g.status === "paused")
      .sort(byGoalOrder)
      .map(presenter(u));
  }
  async addGoal(g: GoalInput, milestones: Pick<Milestone, "title" | "due_date">[] = [], source: Goal["source"] = "person"): Promise<Goal> {
    const id = uuid();
    const t = now();
    const goal: StoredGoal = {
      id,
      title: g.title,
      why: g.why ?? null,
      target_date: g.target_date ?? null,
      status: g.status ?? "active",
      source,
      created_at: t,
      updated_at: t,
      effort_hours: null,
      weekly_hours: null,
      prior_hours: 0,
      ...effortFields(g),
      milestones: milestones.map((m, i) => ({ id: uuid(), goal_id: id, title: m.title, due_date: m.due_date ?? null, done_at: null, position: i })),
    };
    let out!: Goal;
    this.mutate((u) => {
      u.goals.push(goal);
      out = presenter(u)(goal);
    });
    return out;
  }
  async updateGoal(id: string, patch: Partial<GoalInput>): Promise<Goal> {
    let out!: Goal;
    this.mutate((u) => {
      const g = u.goals.find((x) => x.id === id);
      if (!g) throw new Error("Dieses Ziel gibt es nicht mehr.");
      // only the goal's own fields (a whole Goal passed as patch must not store its time)
      const { title, why, target_date, status } = patch;
      Object.assign(g, defined({ title, why, target_date, status }), effortFields(patch), { updated_at: now() });
      out = presenter(u)(g);
    });
    return out;
  }
  async deleteGoal(id: string) {
    this.mutate((u) => {
      u.goals = u.goals.filter((g) => g.id !== id);
      u.goal_time = u.goal_time.filter((t) => t.goal_id !== id); // cascade
      // like "on delete set null": habits and calendar entries stay, without the link
      for (const h of u.habits) if (h.goal_id === id) h.goal_id = null;
      for (const e of u.events)
        if (e.goal_id === id) Object.assign(e, { goal_id: null, sequence: (e.sequence ?? 0) + 1, updated_at: now() });
    });
  }
  async addMilestone(goalId: string, m: Pick<Milestone, "title" | "due_date">) {
    let out!: Milestone;
    this.mutate((u) => {
      const g = u.goals.find((x) => x.id === goalId);
      if (!g) throw new Error("Dieses Ziel gibt es nicht mehr.");
      const position = g.milestones.reduce((max, x) => Math.max(max, x.position), -1) + 1;
      out = { id: uuid(), goal_id: goalId, title: m.title, due_date: m.due_date ?? null, done_at: null, position };
      g.milestones.push(out);
    });
    return out;
  }
  async updateMilestone(id: string, patch: Partial<Pick<Milestone, "title" | "due_date" | "position">> & { done?: boolean }) {
    const { done, ...rest } = patch;
    let out!: Milestone;
    this.mutate((u) => {
      const m = u.goals.flatMap((g) => g.milestones).find((x) => x.id === id);
      if (!m) throw new Error("Diese Etappe gibt es nicht mehr.");
      Object.assign(m, defined(rest));
      // done keeps the moment it was first done (a second tap, another device)
      if (done === true) m.done_at ??= now();
      else if (done === false) m.done_at = null;
      out = { ...m };
    });
    return out;
  }
  async deleteMilestone(id: string) {
    this.mutate((u) => {
      for (const g of u.goals) g.milestones = g.milestones.filter((m) => m.id !== id);
    });
  }

  async setBlockDone(eventId: string, done: boolean | null, minutes?: number) {
    this.mutate((u) => {
      if (done === null) {
        u.goal_time = u.goal_time.filter((t) => t.event_id !== eventId);
        return;
      }
      const entry = blockTimeEntry(u.events.find((e) => e.id === eventId) ?? null, done, minutes);
      checkGoal(u, entry.goal_id);
      const row = u.goal_time.find((t) => t.event_id === eventId);
      if (row) Object.assign(row, entry, { source: "block" });
      else u.goal_time.push({ id: uuid(), ...entry, source: "block", event_id: eventId, external_id: null, note: null });
    });
  }
  async blockAnswers(eventIds: string[]) {
    const ids = new Set(eventIds);
    const out: Record<string, number> = {};
    for (const t of this.user().goal_time) if (t.event_id && ids.has(t.event_id)) out[t.event_id] = t.minutes;
    return out;
  }
  async listGoalTime(from: string, to: string) {
    return this.user()
      .goal_time.filter((t) => t.day >= from && t.day <= to)
      .map((t) => ({ ...t }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  /** Time the coach logs for a goal ("heute 1,5 Stunden trainiert"). */
  private logTime(goalId: string, day: string, minutes: number) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error("Bitte zwischen 0 und 1440 Minuten.");
    this.mutate((u) => {
      checkGoal(u, goalId);
      u.goal_time.push({ id: uuid(), goal_id: goalId, day, minutes, source: "coach", event_id: null, external_id: null, note: null });
    });
  }

  async listHabits() {
    const since = habitsSince();
    return this.user()
      .habits.filter((h) => h.active)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((h) => withRecentDays(h, since));
  }
  async addHabit(h: HabitInput, source: Habit["source"] = "person") {
    const habit: Habit = {
      id: uuid(),
      title: h.title,
      per_week: h.per_week,
      goal_id: h.goal_id ?? null,
      active: h.active ?? true,
      source,
      created_at: now(),
      done_days: [],
    };
    this.mutate((u) => {
      checkGoal(u, habit.goal_id);
      u.habits.push(habit);
    });
    return habit;
  }
  async updateHabit(id: string, patch: Partial<HabitInput>) {
    let out!: Habit;
    this.mutate((u) => {
      const h = u.habits.find((x) => x.id === id);
      if (!h) throw new Error("Diese Gewohnheit gibt es nicht mehr.");
      checkGoal(u, patch.goal_id);
      Object.assign(h, defined(patch));
      out = withRecentDays(h);
    });
    return out;
  }
  async deleteHabit(id: string) {
    this.mutate((u) => (u.habits = u.habits.filter((h) => h.id !== id)));
  }
  async setHabitDone(habitId: string, day: string, done: boolean) {
    this.mutate((u) => {
      const h = u.habits.find((x) => x.id === habitId);
      if (!h) {
        if (done) throw new Error("Diese Gewohnheit gibt es nicht mehr.");
        return;
      }
      const days = new Set(h.done_days);
      if (done) days.add(day);
      else days.delete(day);
      h.done_days = [...days].sort();
    });
  }

  async calendarLink() {
    return null; // a subscription needs the server; the demo offers a file download instead
  }
  async renewCalendarLink() {}

  async pushPublicKey() {
    return null; // notifications need the server
  }
  async savePushSubscription() {}
  async deletePushSubscription() {}
  async sendTestPush() {
    return 0;
  }

  async voiceReady() {
    return false; // demo: the phone's own voice and speech recognition
  }
  async speak(): Promise<ArrayBuffer> {
    throw new Error("no server voice in demo");
  }
  async transcribe(): Promise<string> {
    throw new Error("no server voice in demo");
  }

  async exportData() {
    const u = this.user();
    // the same tables as the real export
    return {
      exported_at: new Date().toISOString(),
      profile: u.profile,
      memories: u.memories,
      events: u.events,
      goals: u.goals.map(({ milestones: _, ...g }) => g),
      milestones: u.goals.flatMap((g) => g.milestones),
      goal_time: u.goal_time,
      habits: u.habits.map(({ done_days: _, ...h }) => h),
      habit_logs: u.habits.flatMap((h) => h.done_days.map((day) => ({ habit_id: h.id, day }))),
      days: u.days,
      messages: u.messages,
    };
  }

  async deleteAccount() {
    const name = this.session();
    const users = this.load();
    if (name) delete users[name];
    this.save(users);
    localStorage.removeItem(SESSION);
    this.emit();
  }

  async getMessages(thread: string) {
    return this.user().messages[thread] ?? [];
  }
  async getDay(day: string) {
    return this.user().days[day] ?? null;
  }

  async tidy() {
    // The scripted demo coach doesn't judge relevance; the real one does.
  }

  private push(thread: string, role: "user" | "assistant", content: string, hidden = false) {
    this.mutate((u) => {
      (u.messages[thread] ??= []).push({ id: uuid(), role, content, hidden, created_at: now() });
    });
  }

  private async say(text: string, onEvent: (e: CoachEvent) => void) {
    const words = text.split(/(\s+)/);
    for (const w of words) {
      onEvent({ type: "text", text: w });
      await sleep(28);
    }
  }

  async coach(req: CoachRequest, onEvent: (e: CoachEvent) => void) {
    await sleep(500);
    const thread = req.thread;
    const history = (this.user().messages[thread] ?? []).filter((m) => !m.hidden);
    if (req.message) this.push(thread, "user", req.message);
    else this.push(thread, "user", "(App geöffnet)", true);

    let reply = "";
    let goalNote = "";
    let calendarNote = "";
    let habitNote = "";
    let timeNote = "";
    // the demo makes no effort estimate; the real coach does
    const goalFound = req.message ? parseDemoGoal(req.message) : null;
    const goal = goalFound ? await this.addGoal(goalFound, [], "coach") : null;
    if (goal) {
      onEvent({ type: "goal_saved", goal, created: true });
      goalNote = `Schön, „${goal.title}“ ist jetzt dein Ziel. Du findest es unter Plan. `;
    }
    // "heute 1,5 Stunden trainiert": time for a goal (a report, so no appointment from it)
    const spent = req.message && !goal ? recogniseDemoTime(req.message, await this.listGoals()) : null;
    const parsed = req.message && !spent ? parseDemoEvent(req.message) : null;
    if (parsed) {
      const ev = await this.addEvent(
        {
          title: parsed.title,
          starts_at: parsed.start.toISOString(),
          ends_at: null,
          all_day: parsed.allDay,
          location: null,
          notes: null,
          reminder_minutes: parsed.allDay ? -480 : 30,
          kind: "termin",
          goal_id: goal?.id ?? null, // "Mein Ziel ist das Rennen am …": the day itself belongs to the goal
        },
        "coach",
      );
      onEvent({ type: "event_created", event: ev });
      calendarNote = `Ich habe „${ev.title}“ in deinen Kalender „I am“ eingetragen. `;
    }
    const habitsDone = req.message && !goal ? recogniseDemoHabits(req.message, this.user().habits) : [];
    for (const h of habitsDone) {
      await this.setHabitDone(h.id, req.context.day, true);
      onEvent({ type: "habit_logged", habit_id: h.id, title: h.title, day: req.context.day, done: true });
    }
    if (habitsDone.length) {
      const names = habitsDone.map((h) => `„${h.title}“`).join(" und ");
      habitNote = `Stark, ${names} ${habitsDone.length > 1 ? "sind" : "ist"} für heute abgehakt. `;
    }
    if (spent) {
      this.logTime(spent.goal.id, addDays(req.context.day, -spent.daysAgo), spent.minutes);
      onEvent({ type: "time_logged", goal_id: spent.goal.id, title: spent.goal.title, minutes: spent.minutes });
      const amount = `${minutesLabel(spent.minutes)} für „${spent.goal.title}“`;
      timeNote = habitNote ? `Und ${amount} sind notiert. ` : `Stark, ${amount}. `;
      const fresh = (await this.listGoals()).find((g) => g.id === spent.goal.id);
      const effort = fresh ? goalEffort(fresh, req.context.day) : null;
      if (effort?.effort) timeNote += `Damit hast du ${hoursLabel(effort.done)} von ≈ ${hoursLabel(effort.effort)} Std geschafft. `;
    }
    if (req.mode === "onboarding") {
      const step = history.filter((m) => m.role === "user").length + (req.message ? 1 : 0);
      if (req.message && step >= 1) {
        const cat = ONBOARDING[step - 1]?.category ?? "anderes";
        const mem = await this.addMemory({ content: req.message, category: cat, event_date: null, source: "coach" });
        onEvent({ type: "memory", memory: mem });
        if (step === 1) {
          const name = req.message.replace(/^(ich bin|ich heisse|ich heiße|nenn mich)\s+/i, "").split(/[ ,.!]/)[0];
          await this.updateProfile({ display_name: name });
          onEvent({ type: "profile", profile: { display_name: name } });
        }
        if (cat === "natur") {
          const t = req.message.toLowerCase();
          const hit = NATURE.find((n) => n.words.some((w) => t.includes(w)))?.palette ?? NATURE[0].palette;
          await this.updateProfile({ nature_palette: hit });
          onEvent({ type: "palette", nature: hit });
        }
      }
      const name = this.user().profile.display_name ?? "";
      if (step < ONBOARDING.length) {
        reply = ONBOARDING[step].q(name);
        if (step === ONBOARDING.length - 1) onEvent({ type: "request_location" });
      } else {
        reply = `Danke, ${name}. Ich habe mir das Wichtigste gemerkt – du kannst es jederzeit unter „Was ich über dich weiss“ ansehen und ändern. Ab jetzt begrüsse ich dich jeden Tag hier im Kreis.`;
        await this.updateProfile({ onboarded: true });
        onEvent({ type: "onboarding_done" });
      }
    } else {
      const name = this.user().profile.display_name ?? "";
      const userTurns = history.filter((m) => m.role === "user").length + (req.message ? 1 : 0);
      if (!req.message) {
        const h = new Date().getHours();
        const greet = h < 11 ? "Guten Morgen" : h < 17 ? "Hoi" : "Guten Abend";
        reply = `${greet}, ${name}. Wie geht es dir heute?`;
      } else if (goal) {
        reply = "Was wäre ein erster kleiner Schritt dahin?";
      } else if (/\btag\b.*\bplanen\b/i.test(req.message)) {
        // "Lass uns meinen Tag planen." (from Plan): no mood, no focus from it
        reply = "Gern. Was ist heute das Wichtigste, und wann hast du Zeit dafür?";
        const next = (await this.listGoals()).find((g) => g.status === "active");
        if (next) reply += ` Für „${next.title}“ schlage ich einen Block ${new Date().getHours() < 17 ? "heute" : "morgen"} um 18 Uhr vor, eine Stunde.`;
      } else if (habitsDone.length || spent) {
        reply = "Was steht heute sonst noch an?";
      } else if (parseDemoMinutes(req.message) && (await this.listGoals()).filter((g) => g.status === "active").length > 1) {
        // time reported, but which goal? ask instead of guessing (and no mood or focus from it)
        reply = "Stark. Für welches Ziel zählt das?";
      } else if (userTurns === 1) {
        const mood = moodFrom(req.message);
        this.mutate((u) => (u.days[req.context.day] = { day: req.context.day, mood, focus: u.days[req.context.day]?.focus ?? null }));
        onEvent({ type: "mood", mood });
        reply =
          mood.valence < 0
            ? "Danke, dass du das teilst. Dann machen wir es heute ruhig. Was wäre eine kleine Sache, die dir heute guttun würde?"
            : "Schön zu hören. Was ist heute das Wichtigste für dich?";
      } else {
        const focus = req.message.slice(0, 80);
        this.mutate((u) => (u.days[req.context.day] = { ...(u.days[req.context.day] ?? { day: req.context.day, mood: null }), focus }));
        onEvent({ type: "focus", focus });
        reply = "Gut, das ist dein Fokus für heute. (Im Demo-Modus antworte ich nur einfach – mit der echten KI wird das ein richtiges Gespräch.)";
      }
    }
    reply = goalNote + calendarNote + habitNote + timeNote + reply;
    await this.say(reply, onEvent);
    this.push(thread, "assistant", reply);
    onEvent({ type: "done" });
  }
}
