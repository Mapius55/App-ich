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
  EventScope,
  Goal,
  GoalInput,
  GoalKind,
  GoalTime,
  Habit,
  HabitInput,
  Memory,
  MemoryCategory,
  Milestone,
  NolioStatus,
  NolioSyncResult,
  Profile,
  WhoopConfirmResult,
  WhoopDay,
  WhoopStatus,
  WhoopSyncResult,
} from "./types";
import { normaliseUsername, USERNAME_RE } from "./types";
import type { NaturePalette } from "./palette";
import {
  addDays,
  dailyNudge,
  dayOf,
  dreamNudge,
  experimentDue,
  goalEffort,
  goalSetback,
  heavyLately,
  hoursLabel,
  NUDGE_NOT_NOW_DAYS,
  OBSTACLE_MAX,
  planBDue,
  rhythmOfferDue,
  openBlocksOn,
  parseClock,
  parseWeekdays,
  PLAN_B_MAX,
  sameTimeLogged,
  seriesDayFollows,
  seriesDays,
  seriesKeepsDay,
  seriesPatchFromDay,
  seriesTimes,
  unansweredCredit,
  weekStart,
  type DailyNudge,
  type SeriesRule,
} from "./plan";
import { mapToGoal, sportKeys, type GoalForMapping, type NolioSport } from "../../supabase/functions/_shared/nolio.ts";

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
  /** like the connections row for WHOOP (null = never connected) */
  whoop?: DemoWhoop | null;
  /** like whoop_days (newest first) */
  whoop_days?: WhoopDay[];
  /** like nolio_sync */
  nolio?: { last_sync_at: string | null };
  /** created or brought up to date since the Bucket List: the demo dreams are in, or never were needed */
  bucket?: boolean;
  /** like public.honest_count_from(): when honest counting began for this account (set once, on the first
   *  load after it came, or at sign-up); unanswered blocks that ended and were entered before it count as before */
  honest_from?: string;
  /** like public.series: the weekly rhythms; their days are in events (series_id, series_day) */
  series?: SeriesRule[];
  /**
   * like profiles.nudge_day, nudge_kind, nudge_no, experiment_at and goals.hours_asked_at, steps_asked_at: the coach's
   * one Anstoss a day (dailyNudge); `since`: the day the demo began counting (like profiles.created_at)
   */
  nudge?: DemoNudge;
}
interface DemoNudge {
  since: string;
  day: string | null;
  kind: string | null;
  no: Record<string, string>;
  hours: Record<string, string>;
  steps: Record<string, string>;
  experiment_at: string | null;
  /** like goals.nudge_after: a dream rests after her «nicht jetzt» until this day */
  rest?: Record<string, string>;
}
/** The way out every Anstoss ends with (and how the demo knows its last reply was one). */
const NUDGE_WAY_OUT = "Sonst schauen wir ein andermal.";
const DEMO_NO = /^\s*(?:nein|nö|lieber nicht|nicht jetzt|lass(?: es| mal)?|jetzt nicht)\b/i;
interface DemoWhoop {
  status: "connected" | "pending";
  consent_ai: boolean;
  connected_at: string | null;
  last_sync_at: string | null;
  /** the single-use confirmation code while pending (the real server keeps it hashed) */
  code?: string | null;
  code_at?: string | null;
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

// A life wish goes on the Bucket List: "Ich möchte einmal Polarlichter sehen", "Ich will irgendwann
// nach Japan", "Mein Traum ist es, …", "Ich möchte mit 40 einen Marathon laufen". "ich möchte/will"
// alone is everyday speech: only with a word for "some day in my life" is it a dream.
const DREAM_LEAD =
  /^\s*(?:(ich\s+(?:möchte|moechte|will|würde\s+(?:so\s+)?gerne?|wuerde\s+(?:so\s+)?gerne?))|(mein\s+(?:grosser\s+|großer\s+|grösster\s+)?(?:lebens)?traum\s+(?:ist|wäre|waere)(?:\s+es)?|ich\s+träume\s+davon|ich\s+traeume\s+davon|auf\s+(?:meine|die)\s+bucket\s*list(?:\s+(?:kommt|gehört|gehoert))?))[\s,:]+/i;
const DREAM_SOMEDAY = /\b(?:einmal|irgendwann|eines\s+tages|im\s+leben|mit\s+\d{2})(?![a-zäöü\d])/i;
// "ich möchte heute einmal früh schlafen" is no dream
const DREAM_EVERYDAY = /\b(?:heute|morgen|übermorgen|gleich|jetzt|kurz|nachher|später|diese[nrs]?\s+woche|dieses\s+wochenende|am\s+wochenende)\b/i;
const DREAM_FILL = /^(?:(?:einmal|irgendwann|eines\s+tages|im\s+leben|unbedingt|so\s+gerne?|gerne?|noch|mal|auch|es)\b[\s,]*)+/i;

/** A life wish in a message (a dream for the Bucket List), or null. Title without the lead-in; a month or day as target_date. */
export function parseDemoDream(text: string, now = new Date()): { title: string; target_date: string | null } | null {
  const lead = DREAM_LEAD.exec(text);
  if (!lead || /\?\s*$/.test(text)) return null;
  let rest = text.slice(lead[0].length);
  if (/^(?:nicht|kein|nie)\b/i.test(rest) || DREAM_EVERYDAY.test(rest)) return null;
  if (lead[1] && !DREAM_SOMEDAY.test(rest)) return null;
  if (parseDemoEvent(text, now)) return null; // a dated appointment belongs in the calendar
  const found = parseDemoDate(rest, now, ["day", "month"]);
  if (found) rest = `${rest.slice(0, found.index).replace(DATE_WORDS, "")} ${rest.slice(found.index + found.length)}`;
  let title = rest.split(/[.!;](?:\s|$)/)[0].replace(/\s+/g, " ").replace(/^[\s,:–-]+|[\s,:–-]+$/g, "");
  // "Mein Traum ist es, einmal Polarlichter zu sehen" → "Polarlichter sehen"
  title = title.replace(DREAM_FILL, "").replace(/\s+(?:einmal|irgendwann)\b/gi, "").replace(/\s+zu\s+([a-zäöü]+)$/i, " $1").slice(0, 120).trim();
  if (title.length < 3 || /^(?:das|dies|es|so)$/i.test(title)) return null;
  return { title: title[0].toUpperCase() + title.slice(1), target_date: found ? dayOf(found.date) : null };
}

// words that say a dream came true ("Ich habe die Polarlichter gesehen", "Mein Traum hat sich erfüllt")
const FULFILLED = new Set(["erfüllt", "erfuellt", "geklappt", "geschafft", "gesehen", "erlebt", "gemacht", "war", "waren", "endlich", "übernachtet", "gefahren", "gereist"]);
// title words that don't tell dreams apart
const DREAM_STOP = new Set([...TITLE_STOP, "sehen", "erleben", "einmal", "über", "nach", "reise", "reisen", "fahren", "machen", "dem", "den", "der", "die", "das", "mit"]);

/**
 * The dream a message says came true: an open (or just fulfilled) dream whose title words are in it,
 * with a word like "erfüllt", "gesehen" or "war". "Mein Traum hat sich erfüllt" means the only open one.
 */
export function recogniseDemoFulfilled<G extends Pick<Goal, "title" | "status" | "kind">>(text: string, dreams: G[]): G | null {
  const w = words(text);
  if (/\?\s*$/.test(text) || !w.some((x) => FULFILLED.has(x) || PAST.test(x)) || w.some((x) => NOT_DONE.has(x))) return null;
  const set = new Set(w);
  const candidates = dreams.filter((d) => d.kind === "dream" && d.status !== "dropped");
  // the names and nouns of a title (capitalised: "Polarlichter", "Velo", "Gotthard"), so "Ich war heute
  // laufen" never fulfils "Mit 40 einen Marathon laufen"
  const keys = (title: string) => title.split(/\s+/).filter((t) => /^[A-ZÄÖÜ]/.test(t)).flatMap(words).filter((x) => x.length >= 4 && !DREAM_STOP.has(x));
  const score = (d: G) => keys(d.title).filter((x) => set.has(x)).length;
  let best: G | null = null;
  for (const d of candidates) if (score(d) > (best ? score(best) : 0)) best = d;
  if (best) return best;
  const open = candidates.filter((d) => d.status === "active" || d.status === "paused");
  return set.has("traum") && (set.has("erfüllt") || set.has("erfuellt")) && open.length === 1 ? open[0] : null;
}

/** How it was, kept short and in her words: the first sentences up to about 300 characters. */
export function demoMemory(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 300) return flat;
  const cut = flat.slice(0, 300);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  return end > 60 ? cut.slice(0, end + 1) : `${cut.slice(0, 299).trimEnd()}…`;
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
// UI tests: localStorage "ich.demo.latency" (ms) delays the reads, so data, the greeting and the
// door arrive the way they do over a real network (e.g. during the first swipe)
const LATENCY = "ich.demo.latency";
async function latency(): Promise<void> {
  let ms = 0;
  try {
    ms = Number(localStorage.getItem(LATENCY)) || 0;
  } catch {
    /* no storage */
  }
  if (ms > 0) await sleep(ms);
}

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
// Like the view goal_minutes: logged time, plus past blocks of the goal nobody answered yet that still count
// (unansweredCredit: from before honest counting as before, else for a week after they ended), of those the provisional ones.
function presenter(u: DemoUser, at = Date.now()): (g: StoredGoal) => Goal {
  const answered = new Set(u.goal_time.flatMap((t) => (t.event_id ? [t.event_id] : [])));
  return (g) => {
    const logged = u.goal_time.reduce((sum, t) => (t.goal_id === g.id ? sum + t.minutes : sum), 0);
    let blocks = 0;
    let provisional = 0;
    for (const e of u.events) {
      // like the view: a planned Nolio training is a plan; the completed one counts (source 'nolio' time)
      if (e.goal_id !== g.id || e.kind !== "block" || e.source === "nolio" || e.all_day || !e.ends_at || answered.has(e.id)) continue;
      const credit = unansweredCredit(e, at, u.honest_from ?? null);
      if (!credit) continue;
      const min = Math.min(1440, (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60000);
      blocks += min;
      if (credit === "provisional") provisional += min;
    }
    return {
      ...g,
      milestones: [...g.milestones].sort((a, b) => a.position - b.position),
      time: { logged_minutes: logged, block_minutes: Math.round(blocks), provisional_minutes: Math.round(provisional) },
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

// Like the check on goals.sports: at most 30 entries; empty = not chosen.
function cleanSports(v: string[] | null | undefined): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 100));
  if (out.length > 30) throw new Error("Höchstens 30 Sportarten.");
  return out.length ? out : null;
}

// Like the checks on goals.kind and goals.memory (at most 1000 characters; empty means none).
function goalKind(v: GoalKind | null | undefined): GoalKind {
  if (v === undefined || v === null) return "goal";
  if (v !== "dream" && v !== "goal") throw new Error("Ein Eintrag ist ein Traum oder ein Ziel.");
  return v;
}
function goalMemory(v: string | null | undefined): string | null {
  if (v === undefined || v === null || !String(v).trim()) return null;
  if (String(v).length > 1000) throw new Error("Die Erinnerung ist zu lang (höchstens 1000 Zeichen).");
  return String(v);
}
/** Like the checks on goals.plan_b and goals.obstacle: empty means none, at most this many characters (trimmed). */
function planBField(v: string | null | undefined, max: number, what: string): string | null {
  if (v === undefined || v === null || !String(v).trim()) return null;
  if (String(v).trim().length > max) throw new Error(`${what} ist zu lang (höchstens ${max} Zeichen).`);
  return String(v);
}
/** Like the trigger goals_plan_b_asked: a Plan B or an obstacle on the goal means the coach asked (never again). */
function followPlanB(g: Pick<StoredGoal, "obstacle" | "plan_b" | "plan_b_asked_at">): void {
  if (!g.plan_b_asked_at && (g.plan_b || g.obstacle)) g.plan_b_asked_at = now();
}
/** Like the trigger goals_done_at: a done goal keeps (or gets) its date, never later than now; any other has none. */
function followDone(status: Goal["status"], doneAt: string | null | undefined): string | null {
  if (status !== "done") return null;
  const at = now();
  return doneAt && Date.parse(doneAt) <= Date.parse(at) ? doneAt : at;
}

// Like the check on profiles.birth_year and its trigger profiles_birth_year (no year after this one).
function checkBirthYear(v: unknown) {
  if (v === undefined || v === null) return;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1900 || v > 2100) throw new Error("Bitte ein Geburtsjahr zwischen 1900 und 2100.");
  if (v > new Date().getFullYear()) throw new Error("Das Geburtsjahr kann nicht in der Zukunft liegen.");
}

// ---------- the Bucket List in the demo ----------

/** Demo users stored before the Bucket List get this birth year and these dreams, once (DemoOptions.bucket). */
export const DEMO_BIRTH_YEAR = 1994;
const demoDream = (id: string, title: string, o: Partial<StoredGoal> & { created_at: string }): StoredGoal => ({
  id,
  title,
  kind: "dream",
  why: null,
  target_date: null,
  status: "active",
  source: "person",
  updated_at: o.done_at ?? o.created_at,
  effort_hours: null,
  weekly_hours: null,
  prior_hours: 0,
  sports: null,
  done_at: null,
  memory: null,
  reminded_at: null,
  milestones: [],
  ...o,
});
export const DEMO_DREAMS: readonly StoredGoal[] = [
  demoDream("5d0c2a8e-1f1b-4c7a-9a51-0d3b7e2f6a01", "Polarlichter sehen", { target_date: "2027-02-28", source: "coach", created_at: "2026-06-10T19:20:00.000Z" }),
  demoDream("5d0c2a8e-1f1b-4c7a-9a51-0d3b7e2f6a02", "Kirschblüte in Japan erleben", { created_at: "2026-03-02T20:05:00.000Z" }),
  demoDream("5d0c2a8e-1f1b-4c7a-9a51-0d3b7e2f6a03", "Einmal in der Hörnlihütte am Matterhorn übernachten", {
    status: "done",
    created_at: "2025-05-20T18:40:00.000Z",
    done_at: "2025-08-16T04:40:00.000Z",
    memory: "Sonnenaufgang über den Wolken, kalt und still.",
  }),
  demoDream("5d0c2a8e-1f1b-4c7a-9a51-0d3b7e2f6a04", "Mit dem Velo über den Gotthard", { status: "done", created_at: "2025-11-02T09:15:00.000Z", done_at: "2026-06-21T14:10:00.000Z" }),
];

// ---------- the weekly rhythm, like the database (20261124000000_series.sql) ----------

const goalState = (u: Pick<DemoUser, "goals">, id: string | null) => {
  const g = id ? u.goals.find((x) => x.id === id) : null;
  return g ? { status: g.status, target_date: g.target_date } : null;
};

/**
 * Like series_sync (and series_fill, which the coach and the daily job run): a rhythm's coming days nobody answered
 * that no longer belong go, the others follow it (not the ones she changed on their own), then the missing days up
 * to 8 weeks ahead are entered (not twice, not a day she let fall away, not over a single block of hers for the same
 * goal). `only`: one rhythm, else all. Returns whether anything changed.
 */
export function syncDemoSeries(u: Pick<DemoUser, "events" | "goals" | "goal_time" | "series">, at = Date.now(), only?: string): boolean {
  let changed = false;
  const answered = new Set(u.goal_time.flatMap((t) => (t.event_id ? [t.event_id] : [])));
  const stamp = new Date(at).toISOString();
  for (const s of u.series ?? []) {
    if (only && s.id !== only) continue;
    const goal = goalState(u, s.goal_id);
    const coming = (e: CalendarEvent) => e.series_id === s.id && Date.parse(e.starts_at) > at && !answered.has(e.id);
    const before = u.events.length;
    u.events = u.events.filter((e) => !coming(e) || seriesKeepsDay(s, e.series_day!, !!e.series_exception, goal));
    if (u.events.length !== before) changed = true;
    const live = s.active && (!s.goal_id || goal?.status === "active");
    if (!live) continue;
    for (const e of u.events) {
      if (!coming(e) || e.series_exception) continue;
      const t = seriesTimes(s, e.series_day!);
      if (Date.parse(t.starts_at) <= at) continue;
      const next = { title: s.title, location: s.location, reminder_minutes: s.reminder_minutes, goal_id: s.goal_id, kind: "block" as const, all_day: false, ...t };
      const differs = (Object.keys(next) as (keyof typeof next)[]).some((k) =>
        k === "starts_at" || k === "ends_at" ? Date.parse(String(e[k])) !== Date.parse(next[k]) : (e[k] ?? null) !== (next[k] ?? null),
      );
      if (!differs) continue;
      Object.assign(e, next, { sequence: (e.sequence ?? 0) + 1, updated_at: stamp });
      changed = true;
    }
    for (const d of seriesDays(s, { now: at, goal })) {
      if (u.events.some((e) => e.series_id === s.id && e.series_day === d.day)) continue;
      const end = Date.parse(d.ends_at);
      const start = Date.parse(d.starts_at);
      const single = u.events.some(
        (o) => !o.series_id && o.kind === "block" && (o.goal_id ?? null) === s.goal_id && Date.parse(o.starts_at) < end && Date.parse(o.ends_at ?? o.starts_at) > start,
      );
      if (single) continue;
      u.events.push({
        id: uuid(),
        title: s.title,
        starts_at: d.starts_at,
        ends_at: d.ends_at,
        all_day: false,
        location: s.location,
        notes: null,
        reminder_minutes: s.reminder_minutes,
        source: "coach",
        kind: "block",
        goal_id: s.goal_id,
        series_id: s.id,
        series_day: d.day,
        series_exception: false,
        sequence: 0,
        created_at: stamp,
        updated_at: stamp,
      });
      changed = true;
    }
  }
  return changed;
}

/** Like the trigger events_series_exception: the fields whose change makes a rhythm's day her exception. */
function seriesFieldsDiffer(a: CalendarEvent, b: CalendarEvent): boolean {
  const at = (iso: string | null) => (iso ? Date.parse(iso) : null);
  return (
    a.title !== b.title ||
    at(a.starts_at) !== at(b.starts_at) ||
    at(a.ends_at) !== at(b.ends_at) ||
    a.all_day !== b.all_day ||
    (a.location ?? null) !== (b.location ?? null) ||
    (a.reminder_minutes ?? null) !== (b.reminder_minutes ?? null) ||
    a.kind !== b.kind ||
    (a.goal_id ?? null) !== (b.goal_id ?? null)
  );
}

/** Like the series_removed trigger: a rhythm that goes takes its coming days nobody answered along; past ones stay plain. */
function removeDemoSeries(u: DemoUser, ids: Set<string>, at = Date.now()) {
  const answered = new Set(u.goal_time.flatMap((t) => (t.event_id ? [t.event_id] : [])));
  u.series = (u.series ?? []).filter((s) => !ids.has(s.id));
  u.events = u.events.filter((e) => !(e.series_id && ids.has(e.series_id) && Date.parse(e.starts_at) > at && !answered.has(e.id)));
  for (const e of u.events) if (e.series_id && ids.has(e.series_id)) e.series_id = null; // on delete set null
}

// "jeden Dienstag und Donnerstag um 18 Uhr laufen": a weekly rhythm she asks for (the real coach offers one too)
const RHYTHM = /\bjede[nrs]?\s+((?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?:\s*(?:,|und)\s*(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))*)\s+um\s+(\d{1,2}(?:[:.]\d{2})?)/i;
const RHYTHM_WHAT: [RegExp, string][] = [
  [/lauf|jogg/i, "Laufen"],
  [/schwimm/i, "Schwimmen"],
  [/velo|rad\b/i, "Velo"],
  [/lern|üb(?:en|e)\b/i, "Lernen"],
  [/yoga|dehn/i, "Yoga"],
  [/train/i, "Training"],
];

/** A weekly rhythm in a message: its weekdays, time and title (null = none). */
export function parseDemoRhythm(text: string): { weekdays: number[]; time: string; title: string | null } | null {
  const m = RHYTHM.exec(text);
  if (!m) return null;
  const weekdays = parseWeekdays(m[1].split(/\s*(?:,|und)\s*/));
  const time = parseClock(m[2]);
  if (!weekdays || !time) return null;
  return { weekdays, time, title: RHYTHM_WHAT.find(([re]) => re.test(text))?.[1] ?? null };
}

// Like the owner-check triggers in the database: links only to one's own goals.
function checkGoal(u: DemoUser, goalId: string | null | undefined) {
  if (goalId && !u.goals.some((g) => g.id === goalId)) throw new Error("Dieses Ziel gibt es nicht mehr.");
}

// The answer to step i is stored with ONBOARDING[i].category; `asks` is emitted with the question.
const ONBOARDING: { q: (name: string) => string; category: MemoryCategory; asks?: "request_location" | "request_connections" }[] = [
  { q: () => "Hoi, schön, dass du da bist. Ich möchte dich gern ein bisschen kennenlernen, damit ich dich gut begleiten kann. Wie darf ich dich nennen?", category: "person" },
  { q: (n) => `Freut mich, ${n}. Was machst du so im Alltag – Arbeit, Studium, oder etwas ganz anderes?`, category: "arbeit" },
  { q: () => "Danke dir. Was ist dir im Leben gerade besonders wichtig?", category: "werte" },
  { q: () => "Wie sieht dein Rhythmus aus? Bist du eher ein Morgen- oder ein Abendmensch, und wann hast du am meisten Energie?", category: "rhythmus" },
  { q: () => "Gibt es etwas, auf das du gerade hinarbeitest – ein Ziel, ein Rennen, ein Projekt?", category: "ziel" },
  {
    q: () =>
      "Nutzt du Apps oder Geräte für Training, Schlaf oder Gesundheit, zum Beispiel WHOOP, eine Polar- oder Garmin-Uhr, Strava oder Nolio? Wenn du magst, verbindest du sie gleich unten. Dann sehe ich deine Daten, und du musst wenig selber eintragen.",
    category: "anderes",
    asks: "request_connections",
  },
  { q: () => "Und jetzt etwas Schönes: Welcher Ort in der Natur tut dir gut? Ein Bergsee, das Meer, ein Wald im Herbst …?", category: "natur" },
  {
    q: () => "Wo wohnst du ungefähr? Wenn du magst, kannst du unten auch deinen Standort freigeben, dann passe ich die Farben an dein Wetter und deinen Sonnenuntergang an.",
    category: "person",
    asks: "request_location",
  },
];

/** The checkin greeting asks once (space only, nothing connected): which apps and devices may I read? */
const ASK_CONNECTIONS = " Magst du WHOOP oder Nolio verbinden? Dann trägst du kaum etwas selber ein.";
const ASK_WHOOP = " Magst du WHOOP verbinden? Dann weiss ich, wie du geschlafen hast, und du trägst weniger selber ein.";

// ---------- connections in the demo (WHOOP, Nolio) ----------

export const DEMO_WHOOP_ATTRIBUTION = "Daten von WHOOP";
const WHOOP_CODE_TTL_MS = 10 * 60_000;

/** a stable pseudo-random number in [0, 1) for a day and a slot */
function dayNoise(day: string, slot: number): number {
  let h = 2166136261;
  for (const c of `${day}:${slot}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** one plausible WHOOP day (the same values for the same day) */
export function demoWhoopDay(day: string): WhoopDay {
  const n = (slot: number, min: number, max: number, digits = 0) => {
    const f = 10 ** digits;
    return Math.round((min + dayNoise(day, slot) * (max - min)) * f) / f;
  };
  const sleep = n(2, 330, 500);
  const workouts = dayNoise(day, 9) < 0.55 ? 1 : 0;
  return {
    day,
    recovery_score: n(1, 34, 92),
    hrv_ms: n(3, 42, 82),
    resting_hr: n(4, 46, 56),
    sleep_minutes: sleep,
    sleep_performance: n(7, 68, 98),
    day_strain: n(11, 5.5, 16.5, 1),
    workout_count: workouts,
    workout_minutes: workouts ? n(13, 35, 95) : 0,
  };
}

/** the last 14 days up to today, newest first */
export function demoWhoopDays(today: string): WhoopDay[] {
  return Array.from({ length: 14 }, (_, i) => demoWhoopDay(addDays(today, -i)));
}

function demoCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The trainer's plan in Nolio, as the sync would mirror it: four sessions in the coming week and
// one from yesterday (done, so it counts as time for a goal).
const DEMO_SPORTS: NolioSport[] = [
  { id: "spt_demorun", name: "Course à pied", slug: "course-a-pied" },
  { id: "spt_demostr", name: "Musculation", slug: "musculation" },
];
const DEMO_SPORT_INDEX = new Map(DEMO_SPORTS.map((s) => [s.id, s]));
interface DemoPlanned {
  offset: number; // days from today
  at: string; // "HH:MM"
  minutes: number;
  title: string;
  sport: string;
  notes: string;
}
const DEMO_PLAN: DemoPlanned[] = [
  // tomorrow early, so the evening stays free (the day's largest gap)
  { offset: 1, at: "07:00", minutes: 45, title: "Lockerer Dauerlauf", sport: "spt_demorun", notes: "Geplant: 45 Min · 8 km\n\nGanz locker, du solltest dich unterhalten können." },
  { offset: 2, at: "18:00", minutes: 60, title: "Intervalle 6 × 800 m", sport: "spt_demorun", notes: "Geplant: 1 Std · 10 km\n\nEinlaufen 15 Min, 6 × 800 m im 10-km-Tempo mit 2 Min Trabpause, Auslaufen 10 Min." },
  { offset: 4, at: "17:30", minutes: 45, title: "Kraft und Stabi", sport: "spt_demostr", notes: "Geplant: 45 Min\n\nRumpf, Hüfte, Waden. Drei Runden." },
  { offset: 6, at: "09:00", minutes: 105, title: "Langer Lauf", sport: "spt_demorun", notes: "Geplant: 1 Std 45 · 20 km\n\nGleichmässig, die letzten 3 km etwas zügiger." },
];
const DEMO_DONE: DemoPlanned = { offset: -1, at: "18:00", minutes: 55, title: "Tempodauerlauf", sport: "spt_demorun", notes: "Geplant: 55 Min · 10 km\n\n3 km locker, 5 km im Halbmarathon-Tempo, 2 km aus." };
const NOLIO_SYNC_MS = 3 * 3600_000; // like the cron job

const plannedId = (day: string, p: DemoPlanned) => `ptrn_demo${day.replace(/-/g, "")}${p.at.replace(":", "")}`;
const sportOf = (externalId: string | null | undefined) =>
  [...DEMO_PLAN, DEMO_DONE].find((p) => externalId?.startsWith("ptrn_demo") && externalId.endsWith(p.at.replace(":", "")))?.sport ?? "spt_demorun";


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

export interface DemoOptions {
  /**
   * Simulate the connections: WHOOP (connect with a confirm, 14 days), Nolio (the trainer's plan in
   * the calendar). The browser preview turns it on; tests opt in.
   */
  connections?: boolean;
  /** with connections: this account is the owner of the app's Nolio (default). False: Nolio is "Bald verfügbar", as for every other member. */
  nolioOwner?: boolean;
  /**
   * Demo users stored before the Bucket List get its demo data once: DEMO_DREAMS and the birth year
   * DEMO_BIRTH_YEAR (the browser preview and the UI tests turn it on; new accounts start empty).
   */
  bucket?: boolean;
}

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  private listeners = new Set<(id: string | null) => void>();
  private watchingVisibility = false;
  private readonly connections: boolean;
  private readonly nolioOwner: boolean;
  private readonly bucket: boolean;

  constructor(opts: DemoOptions = {}) {
    this.connections = opts.connections ?? false;
    this.nolioOwner = this.connections && opts.nolioOwner !== false;
    this.bucket = opts.bucket ?? false;
  }

  private load(): Record<string, DemoUser> {
    let users: Record<string, DemoUser>;
    try {
      users = JSON.parse(localStorage.getItem(KEY) || "{}") ?? {};
    } catch {
      return {};
    }
    let stamped = false;
    // Demo users stored before the calendar or the plan existed lack these fields.
    for (const u of Object.values(users)) {
      u.events = (u.events ?? []).map((e) => ({ ...e, kind: e.kind ?? "termin", goal_id: e.goal_id ?? null }));
      u.goals = (u.goals ?? []).map((g) => ({
        ...g,
        effort_hours: g.effort_hours ?? null,
        weekly_hours: g.weekly_hours ?? null,
        prior_hours: g.prior_hours ?? 0,
        // like the Bucket List migration: everything so far is a goal; reached ones get their last change as the date
        kind: g.kind ?? "goal",
        done_at: g.done_at === undefined ? (g.status === "done" ? g.updated_at : null) : g.done_at,
        memory: g.memory ?? null,
        reminded_at: g.reminded_at ?? null,
      }));
      u.goal_time ??= [];
      u.habits ??= [];
      if (!u.honest_from) {
        // like the honest-counting migration's first run: what ended before now keeps counting as before
        u.honest_from = now();
        stamped = true;
      }
      if (this.bucket && !u.bucket) {
        // fixed ids and dates, so reading again before anything is saved gives the same dreams
        const have = new Set(u.goals.map((g) => g.id));
        for (const d of DEMO_DREAMS) if (!have.has(d.id)) u.goals.push({ ...d, milestones: [] });
        if (u.profile.birth_year === undefined) u.profile.birth_year = DEMO_BIRTH_YEAR;
        u.bucket = true;
      }
    }
    if (stamped) {
      try {
        this.save(users); // the moment stays, like the function the migration writes once
      } catch {
        /* storage full: stamped again next time */
      }
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
    // like supabase-js: the current session once after subscribing (INITIAL_SESSION) and again on
    // every return to the app (SIGNED_IN from its visibility handler), the same id each time
    void this.currentUserId().then((id) => this.listeners.has(cb) && cb(id));
    if (!this.watchingVisibility && typeof document !== "undefined") {
      this.watchingVisibility = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.emit();
      });
    }
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
      bucket: true, // a new account starts with an empty Bucket List
      honest_from: now(), // and counts honestly from the start
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
    checkBirthYear(patch.birth_year);
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
    await latency();
    this.syncDemoNolio();
    this.fillSeries();
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
    const ev: CalendarEvent = { ...e, kind: e.kind ?? "termin", goal_id: e.goal_id ?? null, id: uuid(), source, sequence: 0, created_at: now(), updated_at: now() };
    checkReminder(ev.reminder_minutes);
    this.mutate((u) => {
      checkGoal(u, ev.goal_id);
      u.events.push(ev);
    });
    return ev;
  }
  async updateEvent(id: string, patch: Partial<EventInput>, scope: EventScope = "this") {
    let out!: CalendarEvent;
    this.mutate((u) => {
      const ev = u.events.find((e) => e.id === id);
      if (!ev) throw new Error("Diesen Eintrag gibt es nicht mehr.");
      // «Alle kommenden»: like the backend, the rhythm takes the change and its coming days follow (series_sync)
      const rhythm = scope === "following" && ev.series_id ? (u.series ?? []).find((x) => x.id === ev.series_id) : undefined;
      if (rhythm) {
        checkGoal(u, patch.goal_id);
        checkReminder(patch.reminder_minutes);
        // only what she changed now goes to the rhythm (never what the day had on its own before)
        const rule = seriesPatchFromDay(ev, { ...ev, ...defined(patch) }, rhythm.time_zone);
        Object.assign(rhythm, rule);
        if (seriesDayFollows(ev.series_exception, rule)) {
          // the day follows the rhythm again; notes stay with the day
          ev.series_exception = false;
          if (patch.notes !== undefined) ev.notes = patch.notes;
        } else {
          // her exception keeps its own start and takes the change directly (like a direct update: still hers)
          Object.assign(ev, defined(patch), { sequence: (ev.sequence ?? 0) + 1, updated_at: now() });
        }
        syncDemoSeries(u, Date.now(), rhythm.id);
        out = { ...(u.events.find((e) => e.id === id) ?? ev) };
        return;
      }
      // like the guard trigger: a Nolio entry is the trainer's; only its reminder may change
      if (ev.source === "nolio") {
        const changes = Object.entries(defined(patch)).filter(([k, v]) => k !== "reminder_minutes" && (ev as unknown as Record<string, unknown>)[k] !== v);
        if (changes.length) throw new Error("Dieser Eintrag kommt aus Nolio (vom Trainer geplant) und lässt sich nur dort ändern.");
      }
      checkGoal(u, patch.goal_id);
      checkReminder(patch.reminder_minutes);
      const before = { ...ev };
      // like the events_bump trigger, so a calendar file picks up the change
      Object.assign(ev, defined(patch), { sequence: (ev.sequence ?? 0) + 1, updated_at: now() });
      // like the trigger events_series_exception: a day of a rhythm changed on its own is her exception
      if (ev.series_id && seriesFieldsDiffer(before, ev)) ev.series_exception = true;
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
  async deleteEvent(id: string, scope: EventScope = "this") {
    this.mutate((u) => {
      if (u.events.some((e) => e.id === id && e.source === "nolio"))
        throw new Error("Dieser Eintrag kommt aus Nolio (vom Trainer geplant) und lässt sich nur dort ändern.");
      const ev = u.events.find((e) => e.id === id);
      const rhythm = ev?.series_id ? (u.series ?? []).find((x) => x.id === ev.series_id) : undefined;
      if (rhythm && ev?.series_day) {
        if (scope === "following") {
          // «Alle kommenden»: the rhythm ends the day before, or goes when nothing of it is left
          const last = addDays(ev.series_day, -1);
          if (last >= rhythm.start_date) {
            rhythm.until_date = last;
            syncDemoSeries(u, Date.now(), rhythm.id);
          } else removeDemoSeries(u, new Set([rhythm.id]));
          return;
        }
        // like the trigger events_series_skip: a coming day that falls away never comes back
        if (Date.parse(ev.starts_at) > Date.now() && !rhythm.skip_days.includes(ev.series_day)) rhythm.skip_days.push(ev.series_day);
      }
      u.events = u.events.filter((e) => e.id !== id);
      // like "on delete set null": the time stays, without the block
      for (const t of u.goal_time) if (t.event_id === id) t.event_id = null;
    });
  }

  /** Like the coach's create_series: a weekly rhythm; its days are entered at once (the database's trigger). */
  async addSeries(r: Omit<SeriesRule, "id" | "skip_days" | "active" | "created_at"> & { active?: boolean }): Promise<{ series: SeriesRule; first: CalendarEvent | null }> {
    let out!: { series: SeriesRule; first: CalendarEvent | null };
    this.mutate((u) => {
      checkGoal(u, r.goal_id);
      const series: SeriesRule = { active: true, ...r, id: uuid(), skip_days: [], created_at: now() };
      u.series = [...(u.series ?? []), series];
      // like the trigger: a rhythm for a goal counts as the coach's one offer for it
      const goal = series.goal_id ? u.goals.find((g) => g.id === series.goal_id) : undefined;
      if (goal && !goal.rhythm_asked_at) goal.rhythm_asked_at = now();
      syncDemoSeries(u, Date.now(), series.id);
      const first = u.events.filter((e) => e.series_id === series.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
      out = { series: { ...series }, first: first ? { ...first } : null };
    });
    return out;
  }

  /** Like the daily job and the coach: the rhythms fill their coming days (stored only when something changed). */
  private fillSeries() {
    const name = this.session();
    const users = this.load();
    const u = name ? users[name] : undefined;
    if (!u?.series?.length) return;
    if (syncDemoSeries(u)) {
      try {
        this.save(users);
      } catch {
        /* storage full: filled again next time */
      }
    }
  }

  async listGoals(all = false): Promise<Goal[]> {
    await latency();
    const u = this.user();
    return u.goals
      .filter((g) => all || g.status === "active" || g.status === "paused")
      .sort(byGoalOrder)
      .map(presenter(u));
  }
  async addGoal(g: GoalInput, milestones: Pick<Milestone, "title" | "due_date">[] = [], source: Goal["source"] = "person"): Promise<Goal> {
    const id = uuid();
    const t = now();
    const status = g.status ?? "active";
    const goal: StoredGoal = {
      id,
      title: g.title,
      kind: goalKind(g.kind),
      why: g.why ?? null,
      target_date: g.target_date ?? null,
      status,
      source,
      created_at: t,
      updated_at: t,
      effort_hours: null,
      weekly_hours: null,
      prior_hours: 0,
      sports: cleanSports(g.sports),
      ...effortFields(g),
      done_at: followDone(status, g.done_at),
      memory: goalMemory(g.memory),
      reminded_at: null,
      obstacle: planBField(g.obstacle, OBSTACLE_MAX, "Das Hindernis"),
      plan_b: planBField(g.plan_b, PLAN_B_MAX, "Der Plan B"),
      plan_b_asked_at: null,
      milestones: milestones.map((m, i) => ({ id: uuid(), goal_id: id, title: m.title, due_date: m.due_date ?? null, done_at: null, position: i })),
    };
    followPlanB(goal);
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
      const { title, why, target_date, status, done_at } = patch;
      const kind = patch.kind === undefined ? undefined : goalKind(patch.kind);
      const memory = patch.memory === undefined ? undefined : goalMemory(patch.memory);
      const obstacle = patch.obstacle === undefined ? undefined : planBField(patch.obstacle, OBSTACLE_MAX, "Das Hindernis");
      const planB = patch.plan_b === undefined ? undefined : planBField(patch.plan_b, PLAN_B_MAX, "Der Plan B");
      Object.assign(g, defined({ title, why, target_date, status, kind }), effortFields(patch), { updated_at: now() });
      if (memory !== undefined) g.memory = memory;
      if (patch.sports !== undefined) g.sports = cleanSports(patch.sports);
      if (obstacle !== undefined) g.obstacle = obstacle;
      if (planB !== undefined) g.plan_b = planB;
      followPlanB(g);
      // like the trigger goals_done_at: set when it becomes done (unless given), kept while done, else cleared
      g.done_at = followDone(g.status, done_at !== undefined ? done_at : g.done_at);
      // like the trigger goals_series: no longer active → its rhythm rests; a new target date → its days follow
      if (u.series?.some((x) => x.goal_id === id)) {
        if (g.status !== "active") for (const x of u.series) if (x.goal_id === id) x.active = false;
        syncDemoSeries(u);
      }
      out = presenter(u)(g);
    });
    return out;
  }
  async deleteGoal(id: string) {
    this.mutate((u) => {
      // like "on delete cascade" on series.goal_id: its rhythm goes, with its coming days
      removeDemoSeries(u, new Set((u.series ?? []).filter((x) => x.goal_id === id).map((x) => x.id)));
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
      const ev = u.events.find((e) => e.id === eventId) ?? null;
      if (ev?.source === "nolio") throw new Error("Nolio-Trainings zählen automatisch, sobald sie in Nolio erledigt sind.");
      const entry = blockTimeEntry(ev, done, minutes);
      checkGoal(u, entry.goal_id);
      const row = u.goal_time.find((t) => t.event_id === eventId);
      if (row) Object.assign(row, entry, { source: "block" });
      else u.goal_time.push({ id: uuid(), ...entry, source: "block", event_id: eventId, external_id: null, note: null });
    });
  }
  async countingFrom() {
    return this.user().honest_from ?? null;
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
  /**
   * Time the coach logs for a goal ("heute 1,5 Stunden trainiert"). Like the coach's log_time (D1): the same minutes
   * for this goal on this day already there (the same sentence again) are not counted twice; false then. A block of
   * this goal on that day without an answer (also one later today) is answered with it, as the coach does after its
   * tool's hint, so the block doesn't count as well.
   */
  private logTime(goalId: string, day: string, minutes: number): boolean {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error("Bitte zwischen 0 und 1440 Minuten.");
    let saved = false;
    this.mutate((u) => {
      checkGoal(u, goalId);
      if (sameTimeLogged(u.goal_time, goalId, day, minutes)) return;
      const answered = new Set(u.goal_time.map((t) => t.event_id).filter(Boolean));
      const mine = u.events
        .filter((e) => e.kind === "block" && e.goal_id === goalId)
        .map((e) => ({ ...e, goal_time: answered.has(e.id) ? [e.id] : [] }))
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      const block = openBlocksOn(mine, day, (iso) => dayOf(new Date(iso)))[0];
      u.goal_time.push({ id: uuid(), goal_id: goalId, day, minutes, source: block ? "block" : "coach", event_id: block?.id ?? null, external_id: null, note: null });
      saved = true;
    });
    return saved;
  }

  async listHabits() {
    await latency();
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

  // ---------- connections (simulated; see DemoOptions) ----------

  private whoopStatusOf(u: DemoUser): WhoopStatus | null {
    if (!this.connections) return null; // like a function that isn't deployed: "Bald verfügbar"
    const w = u.whoop ?? null;
    return {
      available: true,
      connected: w?.status === "connected",
      status: w?.status ?? null,
      consent_ai: w?.consent_ai ?? false,
      connected_at: w?.connected_at ?? null,
      last_sync_at: w?.last_sync_at ?? null,
      last_error: null,
      attribution: DEMO_WHOOP_ATTRIBUTION,
      days: w?.status === "connected" ? (u.whoop_days ?? []).filter((d) => d.day >= addDays(dayOf(), -13)).slice(0, 14) : [],
    };
  }

  async whoopStatus() {
    await latency();
    return this.whoopStatusOf(this.user());
  }

  /** No trip to WHOOP: the "return" (#du/verbindungen?whoop=confirm&code=…) comes back at once. */
  async whoopStart() {
    if (!this.connections) throw new Error("WHOOP ist noch nicht eingerichtet.");
    const code = demoCode();
    this.mutate((u) => {
      // like the callback: tokens stored, link pending until the app confirms it
      u.whoop = { status: u.whoop?.status === "connected" ? "connected" : "pending", consent_ai: u.whoop?.consent_ai ?? false, connected_at: u.whoop?.connected_at ?? null, last_sync_at: u.whoop?.last_sync_at ?? null, code, code_at: now() };
    });
    return { url: `#du/verbindungen?whoop=confirm&code=${code}` };
  }

  async whoopConfirm(code: string): Promise<WhoopConfirmResult> {
    await sleep(400);
    let out: WhoopConfirmResult = { ok: false, reason: "mismatch" };
    let connected = false;
    this.mutate((u) => {
      const w = u.whoop;
      if (!w?.code || !w.code_at) return;
      const fresh = Date.now() - Date.parse(w.code_at) <= WHOOP_CODE_TTL_MS;
      if (w.code !== code || !fresh) {
        // a wrong or expired code removes the pending link
        if (w.status === "pending") u.whoop = null;
        else Object.assign(w, { code: null, code_at: null });
        out = { ok: false, reason: w.code !== code ? "mismatch" : "expired" };
        return;
      }
      const t = now();
      u.whoop = { status: "connected", consent_ai: w.consent_ai, connected_at: w.connected_at ?? t, last_sync_at: t, code: null, code_at: null };
      u.whoop_days = demoWhoopDays(dayOf());
      connected = true;
    });
    if (!connected) return out;
    return { ...this.whoopStatusOf(this.user())!, ok: true };
  }

  async whoopSync(): Promise<WhoopSyncResult> {
    await sleep(500);
    const w = this.user().whoop;
    if (!this.connections || w?.status !== "connected") return { ok: false, connected: false, status: w?.status ?? null };
    if (w.last_sync_at && Date.now() - Date.parse(w.last_sync_at) < 60_000) return { ok: true, connected: true, skipped: "recent", last_sync_at: w.last_sync_at };
    const t = now();
    this.mutate((u) => {
      u.whoop!.last_sync_at = t;
      u.whoop_days = demoWhoopDays(dayOf());
    });
    return { ok: true, connected: true, days: 14, last_sync_at: t };
  }

  async whoopDisconnect() {
    this.mutate((u) => {
      u.whoop = null;
      u.whoop_days = [];
    });
  }

  async setWhoopConsent(on: boolean) {
    let ok = false;
    this.mutate((u) => {
      if (u.whoop?.status !== "connected") return;
      u.whoop.consent_ai = on;
      ok = true;
    });
    return ok;
  }

  /**
   * The trainer's plan (like the sync every 3 hours): entries from today on are rewritten (the
   * reminder the person set stays), yesterday's session counts as done for the goal it maps to.
   */
  private syncDemoNolio(force = false) {
    if (!this.nolioOwner || !this.session()) return;
    const u0 = this.load()[this.session()!];
    if (!u0) return;
    const last = u0.nolio?.last_sync_at ? Date.parse(u0.nolio.last_sync_at) : 0;
    if (!force && Date.now() - last < NOLIO_SYNC_MS && last > Date.parse(`${dayOf()}T00:00`)) return;
    this.mutate((u) => {
      const today = dayOf();
      const startToday = new Date(`${today}T00:00`).getTime();
      const goals: GoalForMapping[] = u.goals.map((g) => ({
        id: g.id,
        status: g.status,
        sports: g.sports ?? null,
        effort_hours: g.effort_hours,
        target_date: g.target_date,
        created_day: dayOf(new Date(g.created_at)),
      }));
      const goalFor = (sport: string, day: string) => mapToGoal(sportKeys(sport, DEMO_SPORT_INDEX), day, goals);
      const make = (p: DemoPlanned): CalendarEvent => {
        const day = addDays(today, p.offset);
        const start = new Date(`${day}T${p.at}`);
        return {
          id: uuid(),
          title: p.title,
          starts_at: start.toISOString(),
          ends_at: new Date(start.getTime() + p.minutes * 60_000).toISOString(),
          all_day: false,
          location: null,
          notes: p.notes,
          reminder_minutes: 30,
          source: "nolio",
          external_id: plannedId(day, p),
          kind: "block",
          goal_id: goalFor(p.sport, day),
          sequence: 0,
          updated_at: now(),
        };
      };
      const old = new Map(u.events.filter((e) => e.source === "nolio").map((e) => [e.external_id, e]));
      // from today on: the current plan (an entry that stays keeps its id and reminder)
      const keep = u.events.filter((e) => e.source !== "nolio" || Date.parse(e.starts_at) < startToday);
      const plan = DEMO_PLAN.map((p) => {
        const fresh = make(p);
        const prev = old.get(fresh.external_id);
        return prev ? { ...fresh, id: prev.id, reminder_minutes: prev.reminder_minutes, sequence: prev.sequence ?? 0 } : fresh;
      });
      // a session from yesterday, done (only once; later it simply stays in the past)
      if (!keep.some((e) => e.source === "nolio")) keep.push(make(DEMO_DONE));
      u.events = [...keep, ...plan];
      // done sessions → time for goals (recomputed, so changed goal sports apply to the past too)
      u.goal_time = u.goal_time.filter((t) => t.source !== "nolio");
      for (const e of u.events) {
        if (e.source !== "nolio" || !e.ends_at || Date.parse(e.ends_at) > startToday) continue;
        const day = dayOf(new Date(e.starts_at));
        e.goal_id = goalFor(sportOf(e.external_id), day);
        if (!e.goal_id) continue;
        const minutes = Math.round((Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60_000);
        u.goal_time.push({ id: uuid(), goal_id: e.goal_id, day, minutes, source: "nolio", event_id: null, external_id: `trn_${e.external_id}`, note: null });
      }
      u.nolio = { last_sync_at: now() };
    });
  }

  async nolioStatus(): Promise<NolioStatus | null> {
    await latency();
    if (!this.connections) return null;
    if (!this.nolioOwner) return { available: false, connected: false, last_sync_at: null, last_error: null, running: false, counts: null, garmin: null };
    this.syncDemoNolio();
    const u = this.user();
    const today = new Date(`${dayOf()}T00:00`).getTime();
    const nolio = u.events.filter((e) => e.source === "nolio");
    return {
      available: true,
      connected: !!u.nolio?.last_sync_at,
      last_sync_at: u.nolio?.last_sync_at ?? null,
      last_error: null,
      running: false,
      counts: {
        trainings: nolio.filter((e) => Date.parse(e.starts_at) < today).length,
        assigned: u.goal_time.filter((t) => t.source === "nolio").length,
        planned: nolio.filter((e) => Date.parse(e.starts_at) >= today).length,
      },
      garmin: "Garmin Forerunner 965",
    };
  }

  async nolioSync(): Promise<NolioSyncResult> {
    if (!this.nolioOwner) return { connected: false, reason: "not_owner" };
    await sleep(600);
    this.syncDemoNolio(true);
    const st = (await this.nolioStatus())!;
    return { connected: true, ok: true, last_sync_at: st.last_sync_at ?? undefined, counts: st.counts ?? undefined };
  }

  async pushPublicKey() {
    return null; // notifications need the server
  }
  async savePushSubscription() {}
  async deletePushSubscription() {}
  async ownsPushSubscription() {
    return false;
  }
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
      connections: u.whoop ? [{ provider: "whoop", status: u.whoop.status, consent_ai: u.whoop.consent_ai, connected_at: u.whoop.connected_at, last_sync_at: u.whoop.last_sync_at }] : [],
      whoop_days: u.whoop_days ?? [],
      // the weekly rhythms (their days are in events)
      series: u.series ?? [],
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
    await latency();
    return this.user().messages[thread] ?? [];
  }
  async getDay(day: string) {
    await latency();
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
    // word by word, but in at most ~24 steps: a long reply doesn't keep the demo waiting
    const step = Math.max(1, Math.ceil(words.length / 24));
    for (let i = 0; i < words.length; i += step) {
      onEvent({ type: "text", text: words.slice(i, i + step).join("") });
      await sleep(28);
    }
  }

  /**
   * The demo coach and the Bucket List, like the real coach's rules: the answer to «Wie war es?» is kept
   * as the dream's memory (update_goal memory), a dream that came true is ticked off (status done) and
   * asked about once, a life wish goes on the list without asking (create_goal kind dream). Null when the
   * message is about none of these.
   */
  private async demoDreamTurn(req: CoachRequest, history: ChatMessage[], onEvent: (e: CoachEvent) => void): Promise<{ note: string; reply: string } | null> {
    const text = req.message!;
    const dreams = this.user().goals.filter((g) => g.kind === "dream");
    // just fulfilled (the last two days), no memory yet: the one «Wie war es?» was about, or the one in view
    const recent = dreams
      .filter((d) => d.status === "done" && !d.memory && d.done_at && Date.now() - Date.parse(d.done_at) < 2 * 86400_000)
      .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
    const lastReply = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
    const inView = req.context.view ? recent.find((d) => req.context.view!.includes(d.title)) : undefined;
    const asked = /Wie war es\?\s*$/.test(lastReply) ? recent[0] : undefined;
    const target = inView ?? asked;
    if (target && !/\?\s*$/.test(text) && !recogniseDemoFulfilled(text, dreams.filter((d) => d.id !== target.id))) {
      const saved = await this.updateGoal(target.id, { memory: demoMemory(text) });
      onEvent({ type: "goal_saved", goal: saved });
      return { note: "", reply: `Danke, das bewahre ich bei „${saved.title}“ auf.` };
    }
    const fulfilled = recogniseDemoFulfilled(text, dreams);
    if (fulfilled) {
      if (fulfilled.status !== "done") {
        const saved = await this.updateGoal(fulfilled.id, { status: "done" });
        onEvent({ type: "goal_saved", goal: saved, fulfilled: true });
      }
      if (fulfilled.memory) return { note: "", reply: `Wie schön. „${fulfilled.title}“ bleibt eine schöne Erinnerung auf deiner Bucket List.` };
      return { note: `Wie schön, „${fulfilled.title}“ hat sich erfüllt. `, reply: "Wie war es?" };
    }
    const wish = parseDemoDream(text);
    if (!wish) return null;
    const known = dreams.find((d) => d.title.toLowerCase() === wish.title.toLowerCase() && d.status !== "dropped");
    if (known) return { note: `„${known.title}“ steht schon auf deiner Bucket List. `, reply: "Magst du einen ersten Schritt dazu planen?" };
    const dream = await this.addGoal({ ...wish, kind: "dream" }, [], "coach");
    onEvent({ type: "goal_saved", goal: dream, created: true });
    return { note: `„${dream.title}“ steht jetzt auf deiner Bucket List. `, reply: "Was reizt dich daran am meisten?" };
  }

  /**
   * Like the real coach's one Anstoss a day (dailyNudge, NEXT #1): the item for today from the demo's data, or null.
   * The demo has no Wochenblick; the rest follows the same priorities, «once» marks and the 14 days after a «Nein».
   */
  private demoNudge(day: string): DailyNudge | null {
    const u = this.user();
    const state = u.nudge ?? { since: day, day: null, kind: null, no: {}, hours: {}, steps: {}, experiment_at: null };
    const now = Date.now();
    const goals = u.goals.filter((g) => g.kind !== "dream" && g.status === "active");
    const blocks = u.events.filter((e) => e.kind === "block" && e.goal_id);
    const answered = new Map(u.goal_time.filter((t) => t.event_id).map((t) => [t.event_id!, t.minutes]));
    const days = Object.values(u.days).map((d) => ({ day: d.day, mood: d.mood, focus: d.focus }));
    const recent = days.filter((d) => d.day !== day);
    const live = (u.series ?? []).filter((r) => r.active && !(r.until_date && r.until_date < day));
    return dailyNudge({
      today: day,
      heavy: heavyLately(u.days[day]?.mood, recent, day),
      pause: false,
      review: null,
      lastDay: state.day,
      startDay: state.since,
      no: state.no,
      entriesToday: u.events.filter((e) => dayOf(new Date(e.starts_at)) === day).length,
      goals: goals.map((g) => ({
        id: g.id,
        target_date: g.target_date,
        weekly_hours: g.weekly_hours,
        steps: g.milestones.length,
        hours_asked_at: state.hours[g.id] ?? null,
        steps_asked_at: state.steps[g.id] ?? null,
        planB: planBDue(g, blocks.some((b) => b.goal_id === g.id), day),
        setback: goalSetback(
          g,
          blocks.map((b) => ({ goal_id: b.goal_id, ends_at: b.ends_at, minutes: answered.get(b.id) ?? null })),
          days,
          day,
          now,
        ),
        rhythm: rhythmOfferDue(g, { hasRhythm: live.some((r) => r.goal_id === g.id), activeRhythms: live.length, irregular: false, today: day }),
      })),
      dreams: u.goals
        .filter((g) => g.kind === "dream" && g.status === "active")
        .map((g) => ({ id: g.id, flag: dreamNudge({ ...g, nudge_after: state.rest?.[g.id] ?? null }, day, { startDay: state.since }) }))
        .filter((d): d is { id: string; flag: NonNullable<typeof d.flag> } => d.flag !== null),
      experiment: experimentDue(u.goals, state.experiment_at, day, (iso) => dayOf(new Date(iso))),
    });
  }

  /** The demo coach brings the Anstoss up: one sentence, one question, a way out; noted like the coach's tools. */
  private sayNudge(n: DailyNudge, day: string): string {
    const title = n.id ? (this.user().goals.find((g) => g.id === n.id)?.title ?? "") : "";
    const at = now();
    this.mutate((u) => {
      const st = (u.nudge ??= { since: day, day: null, kind: null, no: {}, hours: {}, steps: {}, experiment_at: null });
      st.day = day;
      st.kind = n.kind;
      const g = n.id ? u.goals.find((x) => x.id === n.id) : undefined;
      if (n.kind === "stunden" && n.id) st.hours[n.id] = at;
      if (n.kind === "etappen" && n.id) st.steps[n.id] = at;
      if (n.kind === "experiment") st.experiment_at = at;
      if (g && n.kind === "plan_b") g.plan_b_asked_at = at;
      if (g && n.kind === "rhythmus") g.rhythm_asked_at = at;
      if (g && n.kind === "traum") g.reminded_at = at;
    });
    const ask: Record<DailyNudge["kind"], string> = {
      wochenblick: "Magst du kurz auf die neue Woche schauen?",
      stunden: `Wie viele Stunden pro Woche hast du für „${title}“ realistisch?`,
      plan_b: `Was könnte dir bei „${title}“ dazwischenkommen?`,
      etappen: `Magst du für „${title}“ ein paar Etappen mit Monat festlegen?`,
      rhythmus: `Magst du für „${title}“ feste Zeiten in der Woche?`,
      traum: `Was reizt dich am meisten an „${title}“?`,
      experiment: "Magst du heute zehn Minuten hinaus, solange es noch hell ist?",
    };
    return `${ask[n.kind]} ${NUDGE_WAY_OUT}`;
  }

  /** Her «Nein» to today's Anstoss: that kind rests two weeks (a dream: three months), like note_offer with nein. */
  private demoNudgeNo(text: string, day: string, history: ChatMessage[]): boolean {
    const st = this.user().nudge;
    const last = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
    if (!st?.kind || st.day !== day || !last.endsWith(NUDGE_WAY_OUT) || !DEMO_NO.test(text)) return false;
    this.mutate((u) => {
      u.nudge!.no[st.kind!] = day;
      if (st.kind === "traum")
        for (const g of u.goals) if (g.kind === "dream" && g.reminded_at && dayOf(new Date(g.reminded_at)) === day) (u.nudge!.rest ??= {})[g.id] = addDays(day, NUDGE_NOT_NOW_DAYS);
    });
    return true;
  }

  async coach(req: CoachRequest, onEvent: (e: CoachEvent) => void) {
    await sleep(500);
    await latency();
    const thread = req.thread;
    const history = (this.user().messages[thread] ?? []).filter((m) => !m.hidden);
    if (req.message) this.push(thread, "user", req.message);
    else this.push(thread, "user", "(App geöffnet)", true);

    let reply = "";
    let goalNote = "";
    let calendarNote = "";
    let habitNote = "";
    let timeNote = "";
    // The Bucket List: the answer to "Wie war es?" becomes the dream's memory; a dream that came true
    // is ticked off; a life wish goes on the list. Each of these is the whole turn.
    const dreamTurn = req.message ? await this.demoDreamTurn(req, history, onEvent) : null;
    if (dreamTurn) goalNote = dreamTurn.note;
    // the demo makes no effort estimate; the real coach does
    const goalFound = req.message && !dreamTurn ? parseDemoGoal(req.message) : null;
    const goal = goalFound ? await this.addGoal(goalFound, [], "coach") : null;
    if (goal) {
      onEvent({ type: "goal_saved", goal, created: true });
      goalNote = `Schön, „${goal.title}“ ist jetzt dein Ziel. Du findest es bei deinen Zielen. `;
    }
    // "heute 1,5 Stunden trainiert": time for a goal (a report, so no appointment from it)
    const spent = req.message && !goal && !dreamTurn ? recogniseDemoTime(req.message, (await this.listGoals()).filter((g) => g.kind !== "dream")) : null;
    // "jeden Dienstag und Donnerstag um 18 Uhr laufen": a weekly rhythm for her goal (an hour each)
    const rhythm = req.message && !spent && !dreamTurn && !goal ? parseDemoRhythm(req.message) : null;
    if (rhythm) {
      const focus = (await this.listGoals()).find((g) => g.kind !== "dream" && g.status === "active") ?? null;
      const made = await this.addSeries({
        goal_id: focus?.id ?? null,
        title: rhythm.title ?? focus?.title ?? "Fokuszeit",
        weekdays: rhythm.weekdays,
        start_time: rhythm.time,
        duration_minutes: 60,
        location: null,
        reminder_minutes: 10,
        time_zone: req.context.timezone || "Europe/Zurich",
        start_date: req.context.day,
        until_date: null,
      });
      if (made.first) onEvent({ type: "event_created", event: made.first });
      calendarNote = made.first ? `„${made.series.title}“ steht jetzt jede Woche im Kalender. ` : "";
    }
    const parsed = req.message && !spent && !dreamTurn && !rhythm ? parseDemoEvent(req.message) : null;
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
      calendarNote = `Ich habe „${ev.title}“ in deinen Kalender „Bucket List“ eingetragen. `;
    }
    const habitsDone = req.message && !goal && !dreamTurn ? recogniseDemoHabits(req.message, this.user().habits) : [];
    for (const h of habitsDone) {
      await this.setHabitDone(h.id, req.context.day, true);
      onEvent({ type: "habit_logged", habit_id: h.id, title: h.title, day: req.context.day, done: true });
    }
    if (habitsDone.length) {
      const names = habitsDone.map((h) => `„${h.title}“`).join(" und ");
      habitNote = `Stark, ${names} ${habitsDone.length > 1 ? "sind" : "ist"} für heute abgehakt. `;
    }
    if (spent && !this.logTime(spent.goal.id, addDays(req.context.day, -spent.daysAgo), spent.minutes)) {
      timeNote = `Die ${minutesLabel(spent.minutes)} für „${spent.goal.title}“ stehen schon da. `;
    } else if (spent) {
      onEvent({ type: "time_logged", goal_id: spent.goal.id, title: spent.goal.title, minutes: spent.minutes });
      const amount = `${minutesLabel(spent.minutes)} für „${spent.goal.title}“`;
      timeNote = habitNote ? `Und ${amount} sind notiert. ` : `Stark, ${amount}. `;
      const fresh = (await this.listGoals()).find((g) => g.id === spent.goal.id);
      const effort = fresh ? goalEffort(fresh, req.context.day) : null;
      // like the coach: hours of blocks nobody answered yet are never said as done
      if (effort?.effort) timeNote += `Damit hast du ${hoursLabel(effort.done - effort.provisional)} von ≈ ${hoursLabel(effort.effort)} Std geschafft. `;
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
        const asks = ONBOARDING[step].asks;
        if (asks === "request_connections") {
          // asked now: the first check-in doesn't ask again
          await this.updateProfile({ connections_asked_at: now() });
          onEvent({ type: "request_connections" });
        } else if (asks) onEvent({ type: asks });
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
        // once, for an account with nothing connected (only in the space: the old screens have no
        // Verbindungen), by the server's rule (shouldAskConnections: no WHOOP link, no synced Nolio; the
        // demo has no calendar subscription), and as the greeting's only question
        const u = this.user();
        const whoopLinked = u.whoop?.status === "connected" || u.whoop?.status === "pending";
        const nolioLinked = this.nolioOwner && !!u.nolio?.last_sync_at;
        if (this.connections && req.context.view && !u.profile.connections_asked_at && !whoopLinked && !nolioLinked) {
          await this.updateProfile({ connections_asked_at: now() });
          reply = `${greet}, ${name}.${this.nolioOwner ? ASK_CONNECTIONS : ASK_WHOOP}`;
          onEvent({ type: "request_connections" });
        } else {
          // after three days without an Anstoss, the greeting carries it as its one question (like chooseOpener's «anstoss»)
          const n = this.demoNudge(req.context.day);
          if (n?.greeting) reply = `${greet}, ${name}. ${this.sayNudge(n, req.context.day)}`;
          else if (!u.nudge) this.mutate((x) => (x.nudge = { since: req.context.day, day: null, kind: null, no: {}, hours: {}, steps: {}, experiment_at: null }));
        }
      } else if (this.demoNudgeNo(req.message, req.context.day, history)) {
        reply = "Gut, dann lassen wir das.";
      } else if (dreamTurn) {
        reply = dreamTurn.reply;
      } else if (goal) {
        reply = "Was wäre ein erster kleiner Schritt dahin?";
      } else if (/\bwoche\b.*\bzurückschauen\b/i.test(req.message)) {
        // "Lass uns auf die letzte Woche zurückschauen." (a past week on Woche): the real coach's Wochenblick
        reply = "Gern. Was ist dir von der Woche geblieben?";
      } else if (/\b(tag|woche)\b.*\bplanen\b/i.test(req.message)) {
        // "Lass uns meinen Tag planen." / "… meine Woche planen." (Tag, Woche): no mood, no focus from it
        const when = /\bmeine woche\b/i.test(req.message) ? "diese Woche" : /\bnächste woche\b/i.test(req.message) ? "nächste Woche" : /\bwoche\b/i.test(req.message) ? "in der Woche" : /\bmorgen\b/i.test(req.message) ? "morgen" : /\btag am\b/i.test(req.message) ? "an dem Tag" : "heute";
        reply = `Gern. Was ist ${when} das Wichtigste, und wann hast du Zeit dafür?`;
        const next = (await this.listGoals()).find((g) => g.status === "active");
        // the block falls in what is being planned: next week or another week on its Monday, tomorrow, that day
        const blockDay =
          when === "nächste Woche" || when === "in der Woche" ? "am Montag" : when === "an dem Tag" ? "an dem Tag" : when === "morgen" || new Date().getHours() >= 17 ? "morgen" : "heute";
        if (next) reply += ` Für „${next.title}“ schlage ich einen Block ${blockDay} um 18 Uhr vor, eine Stunde.`;
      } else if (habitsDone.length || spent) {
        // right after a tick or something done: the day's one Anstoss, if there is one
        const n = this.demoNudge(req.context.day);
        reply = n ? this.sayNudge(n, req.context.day) : "Was steht heute sonst noch an?";
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
