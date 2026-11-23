// Notifications from the coach (Edge Function "push"): when one is due, when it stays out and what it
// says. Pure (it only uses the shared, equally pure plan.ts), so the app (the settings text) and the tests
// use it too. Days are her local calendar days ("YYYY-MM-DD") in her time zone (profiles.timezone).
//
// The rules (round 1 «Morgens und abends, schlauer», round 3 «Nichts, nach Pause eine Zeile» and «Blöcke und
// Wunsch»):
// - A body only with her own content (her entries, a step, a win, the day's own entry in the evening); else
//   nothing. Statements, never questions; never a claim about her whole day (the app doesn't see every
//   calendar); no identical body within 7 days.
// - Morning: none once she opened the app today; entries already running are left out; an evening entry is
//   «heute Abend um …»; an entry that repeats every day is named at most twice in 7 days. After an entry that
//   ended after 22:00 it comes two hours later, or not at all when that would be after 11:00.
// - Evening: none when she talked in the last 3 hours or the app already greeted her this evening; without a
//   win one of her own finished entries of the day (no work, nothing sensitive) as a plain statement.
// - None while one of her timed entries runs: it waits while the entry ends within the slot's hour, else stays out.
// - Saturday and Sunday the morning comes 90 minutes later, only at the default time (the evening never).
// - After 2 days without opening the app: one line from her own data (the next entry or step), then nothing
//   until she opens it again; never a word about the pause. After 14 days: nothing at all. Her switches stay.
// - Reminders (a third kind): at starts_at − reminder_minutes, for her blocks and the entries she asked a
//   reminder for, only when her iPhone calendar is not subscribed (no double alarm), never for Nolio entries,
//   at most 3 a day, never late, once per entry and day.
// - Lock-screen safe: short, no health words (also not the title of something that serves a goal with
//   one), no WHOOP values, never a dream (a reminder she asked for may show her own title). Goals unknown
//   (the query failed): times and counts only.

import { eveningEntries } from "./plan.ts";

export type Slot = "morning" | "evening";

/** the times the settings start with ("HH:MM") */
export const DEFAULT_TIME: Record<Slot, string> = { morning: "07:30", evening: "21:00" };
/** Saturday and Sunday this much later, when the time is the default one */
export const WEEKEND_SHIFT_MIN = 90;
/** scheduled runs can be late: a slot is due from its time on for this long */
export const DUE_WINDOW_MIN = 60;
/** evening: none when she talked within this time */
export const RECENT_TALK_MIN = 180;
/** evening: from this time on (or from the slot time, if earlier) an open counts as «already this evening» */
export const EVENING_FROM_MIN = 17 * 60;
/** none at all after this many days without opening the app */
export const PAUSE_AFTER_DAYS = 14;
/** after this many days without opening the app: one line from her own data, then nothing until she opens it */
export const PAUSE_LINE_AFTER_DAYS = 2;
/** that one line comes only this long after her last open; later, nothing */
export const PAUSE_LINE_UNTIL_DAYS = 4;
/** the scheduled runs come every this many minutes (pg_cron and the GitHub workflow) */
export const RUN_EVERY_MIN = 15;
/** an entry of hers that ended after this time the evening before moves the morning … */
export const LATE_END_MIN = 22 * 60;
/** … this much later … */
export const LATE_SHIFT_MIN = 120;
/** … or leaves it out when it would come after this time */
export const MORNING_LATEST_MIN = 11 * 60;
/** an entry from this time on is named «heute Abend um …» in the morning */
export const EVENING_ENTRY_MIN = 18 * 60;
/** an entry that repeats every day is named at most this often within 7 days */
export const DAILY_NAMED_MAX = 2;
/** a reminder goes out when its moment falls within the next run's span … */
export const REMINDER_WINDOW_MIN = RUN_EVERY_MIN;
/** … or lies at most this long behind (a run that starts a little late), and never once the entry began */
export const REMINDER_GRACE_MIN = 5;
/** at most this many reminders a day */
export const REMINDERS_PER_DAY = 3;
/** a reminder longer than this ahead stays in the calendar only */
export const REMINDER_MAX_LEAD_MIN = 1440;
/** the iPhone calendar counts as subscribed while it fetched the feed within this many days */
export const CALENDAR_FRESH_DAYS = 3;
/** no identical body within this many days (today included) */
export const NO_REPEAT_DAYS = 7;
/** longest title of hers that goes on the lock screen */
export const TITLE_MAX = 40;
export const FALLBACK_ZONE = "Europe/Zurich";

const DAY_MS = 86400000;
const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const COUNT_WORDS = ["null", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];

// ---------- time ----------

export interface LocalNow {
  /** "YYYY-MM-DD" */
  date: string;
  /** minutes since local midnight */
  minutes: number;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
}

/** her time zone, or Zurich when none is stored or the stored one is unknown */
export function zoneOr(tz: string | null | undefined): string {
  if (!tz) return FALLBACK_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_ZONE;
  }
}

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    formats.set(tz, f);
  }
  return f;
}

function weekdayOf(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** the local day, time of day and weekday of a moment in a time zone */
export function localParts(at: Date, tz: string): LocalNow {
  const p = Object.fromEntries(
    format(tz)
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, minutes: (+p.hour % 24) * 60 + +p.minute, weekday: weekdayOf(date) };
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** "07:30" or "07:30:00" → minutes since midnight */
export const toMinutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const isDefaultTime = (slot: Slot, time: string) => time.slice(0, 5) === DEFAULT_TIME[slot];

/**
 * When the slot is due on this weekday (minutes since midnight): the weekend shift only for the morning at the
 * default time (sleeping in; the evening at 22:30 would land after bedtime).
 */
export function slotMinutes(slot: Slot, time: string, weekday: number): number {
  return toMinutes(time) + (slot === "morning" && weekday >= 5 && isDefaultTime(slot, time) ? WEEKEND_SHIFT_MIN : 0);
}

/** the weekend time ("HH:MM") when it differs from the chosen one (for the settings text), else null */
export function weekendTime(slot: Slot, time: string): string | null {
  return slot === "morning" && isDefaultTime(slot, time) ? hhmm(slotMinutes(slot, time, 5)) : null;
}

/**
 * When the slot is due today: after a late entry (`late`, see endedLate) the morning comes two hours later, or not
 * at all (`skip`) when that would be after 11:00; then it is decided at its usual time.
 */
export function slotDueAt(slot: Slot, time: string, weekday: number, late = false): { minutes: number; skip: boolean } {
  const base = slotMinutes(slot, time, weekday);
  if (slot !== "morning" || !late) return { minutes: base, skip: false };
  const shifted = base + LATE_SHIFT_MIN;
  return shifted > MORNING_LATEST_MIN ? { minutes: base, skip: true } : { minutes: shifted, skip: false };
}

// ---------- when ----------

export interface PushProfile {
  notify_morning: string | null;
  notify_evening: string | null;
  /** the last day a slot was decided (sent or left out) */
  last_morning_push: string | null;
  last_evening_push: string | null;
}

/** the slot whose time has come and that is not decided yet today (the morning first), or null; `late`: see slotDueAt */
export function dueSlot(p: PushProfile, now: LocalNow, late = false): Slot | null {
  const due = (slot: Slot, time: string | null, last: string | null) => {
    if (!time || last === now.date) return false;
    const m = slotDueAt(slot, time, now.weekday, late).minutes;
    return now.minutes >= m && now.minutes < m + DUE_WINDOW_MIN;
  };
  if (due("morning", p.notify_morning, p.last_morning_push)) return "morning";
  if (due("evening", p.notify_evening, p.last_evening_push)) return "evening";
  return null;
}

/**
 * Whether one of her timed entries that began before today ended after 22:00 the evening before (a late shift, a
 * night shift that ended this morning): then the morning comes later (slotDueAt). Only entries with an end and
 * already over; one that began today (an early run) is no late night.
 */
export function endedLate(events: PushEvent[], at: Date, tz: string): boolean {
  const today = localParts(at, tz).date;
  const yesterday = addDays(today, -1);
  return events.some((e) => {
    if (e.all_day || !e.ends_at) return false;
    const end = Date.parse(e.ends_at);
    if (!Number.isFinite(end) || end > at.getTime() || localParts(new Date(e.starts_at), tz).date >= today) return false;
    const x = localParts(new Date(end), tz);
    return x.date > yesterday || (x.date === yesterday && x.minutes > LATE_END_MIN);
  });
}

/** the end (ms) of the last of her timed entries running at `at` (one without an end lasts an hour), or null */
export function runningUntil(events: PushEvent[], at: Date): number | null {
  let until: number | null = null;
  for (const e of events) {
    if (e.all_day) continue;
    const s = Date.parse(e.starts_at);
    const end = e.ends_at ? Date.parse(e.ends_at) : s + 3600e3;
    if (s <= at.getTime() && at.getTime() < end) until = Math.max(until ?? 0, end);
  }
  return until;
}

/**
 * No message while one of her timed entries runs: "wait" while it ends early enough in the slot's hour for a later
 * run to decide, "skip" otherwise; null when nothing runs. `dueMin` is the slot's time today (slotDueAt).
 */
export function busyDecision(events: PushEvent[], at: Date, now: LocalNow, dueMin: number): "wait" | "skip" | null {
  const until = runningUntil(events, at);
  if (until === null) return null;
  const windowEnd = at.getTime() + (dueMin + DUE_WINDOW_MIN - now.minutes) * 60000;
  return until + RUN_EVERY_MIN * 60000 <= windowEnd ? "wait" : "skip";
}

/**
 * Why a due slot stays out. "empty": nothing of her own to say (round 3: no filler); "repeat": nothing left that
 * wasn't sent within 7 days; "busy": one of her entries runs through the slot's hour; "late_night": after a late
 * entry the morning would come after 11:00.
 */
export type SkipReason = "opened_today" | "talked_recently" | "this_evening" | "paused" | "repeat" | "empty" | "busy" | "late_night";

/**
 * The pause, from her last open (or her sign-up): "line" = the one line from her own data is due (2 to 4 days away,
 * not sent since she was last there), "silent" = nothing (the line went out, or 4 days passed, or 14), null = no pause.
 */
export type PauseState = "line" | "silent" | null;
export function pauseState(at: Date, a: Activity, lineSent = false): PauseState {
  const ref = Date.parse(a.lastOpen ?? a.since ?? "");
  if (!Number.isFinite(ref)) return null;
  const away = at.getTime() - ref;
  if (away < PAUSE_LINE_AFTER_DAYS * DAY_MS) return null;
  if (away >= PAUSE_AFTER_DAYS * DAY_MS || lineSent || away >= PAUSE_LINE_UNTIL_DAYS * DAY_MS) return "silent";
  return "line";
}

/** whether the pause line went out since she was last there (log rows with a «p.» template) */
export function pauseLineSent(history: SentBefore[], a: Activity): boolean {
  const ref = Date.parse(a.lastOpen ?? a.since ?? "");
  return history.some((h) => (h.status ?? "sent") === "sent" && !!h.template?.startsWith("p.") && (!Number.isFinite(ref) || Date.parse(h.created_at ?? "") > ref));
}

export interface Activity {
  /** created_at of her newest message row, any thread: every first open of a day writes the hidden «app opened» turn */
  lastOpen: string | null;
  /** created_at of the newest thing she said herself (a user message that is not hidden) */
  lastTalk: string | null;
  /** when her profile was made: where the pause counts from while she has no message yet */
  since?: string | null;
}

/**
 * Why the due slot stays out, or null when it goes out (in a pause with the line due, null too: the dispatch then
 * sends the pause line instead of the slot's body). `lineSent`: the pause line went out since her last open.
 */
export function skipReason(slot: Slot, at: Date, tz: string, slotMin: number, a: Activity, lineSent = false): SkipReason | null {
  const pause = pauseState(at, a, lineSent);
  if (pause === "silent") return "paused";
  if (pause === "line") return null;
  const today = localParts(at, tz).date;
  const open = a.lastOpen ? localParts(new Date(a.lastOpen), tz) : null;
  if (slot === "morning") return open?.date === today ? "opened_today" : null;
  const talk = Date.parse(a.lastTalk ?? "");
  if (Number.isFinite(talk) && at.getTime() - talk < RECENT_TALK_MIN * 60000) return "talked_recently";
  if (open?.date === today && open.minutes >= Math.min(EVENING_FROM_MIN, slotMin)) return "this_evening";
  return null;
}

// ---------- lock-screen safety ----------

// Words that don't belong on a lock screen: health (body, mind, doctors, weight, sleep, WHOOP values),
// intimacy, money trouble and legal matters. A title with one of them is not shown, the time or a
// neutral word stands in for it («10:15 Termin»). Stems match inside compounds («Zahnarzttermin»);
// short or ambiguous ones only as a whole word («OP», «kg»; not «Kilometer», «besucht», «Kooperation»).
const SENSITIVE_STEMS = [
  // doctors and places of care
  "arzt", "ärzt", "aerzt", "doktortermin", "klinik", "spital", "krankenhaus", "notaufnahme", "notfall", "hospital", "clinic", "doctor", "dentist",
  "therap", "psych", "physio", "chiro", "osteopath", "akupunkt", "logopäd", "logopaed", "hebamme", "apothek", "dental", "kieferorthop",
  "zahnreinig", "zahnspange", "frauenarzt", "gynäk", "gynaek", "urolog", "onkolog", "neurolog", "kardio", "dermatolog", "radiolog",
  // examinations, treatment, illness
  "untersuchung", "vorsorge", "check-up", "checkup", "diagnos", "befund", "laborwert", "blutentnahme", "blutdruck", "blutzucker", "blutbild",
  "impf", "röntgen", "roentgen", "ultraschall", "narkose", "chemo", "bestrahl", "krebs", "tumor", "diabet", "insulin", "dialyse", "infusion",
  "medikament", "tablette", "krank", "schmerz", "migräne", "migraene", "allergi", "asthma", "nachkontrolle", "jahreskontrolle", "unfall",
  "spitex", "mammo", "spiegelung", "skopie", "biops", "bluttest", "blutwert", "spritze", "kontrolltermin", "zahnkontroll", "wundkontroll",
  "abklärung", "abklaerung", "invalid", "ernährungsberat", "ernaehrungsberat", "selbsthilfe",
  // mind
  "depress", "panik", "burnout", "burn-out", "trauma", "angststör", "angststoer", "angstattack", "prüfungsangst", "essstör", "essstoer", "bulimi", "magersucht", "suchtberatung", "spielsucht",
  "alkohol", "entzug", "rehab",
  // body, weight, sleep and recovery values
  "abnehm", "gewicht", "diät", "diaet", "kalorien", "schlaf", "whoop", "recovery", "erholungswert", "herzfrequenz", "schwanger",
  "kinderwunsch", "fruchtbar", "verhüt", "verhuet", "abtreib", "geburtsvorbereit", "pregnan", "weight",
  // intimacy and relationships
  "paarberat", "eheberat", "scheidung", "trennung", "tinder", "affäre", "affaere", "sexual",
  // money trouble and legal matters
  "schulden", "betreibung", "inkasso", "anwalt", "anwält", "anwaelt", "gerichtstermin", "polizei", "vorladung", "kündigung", "kuendigung",
  "arbeitslos", "sozialamt", "sozialhilfe", "sozialdienst", "lawyer",
];
const SENSITIVE_WORDS = ["op", "ct", "mrt", "mri", "kg", "kilo", "kilos", "bmi", "hrv", "puls", "kur", "reha", "praxis", "sucht", "sex", "date", "pille", "pillen", "gericht", "diet", "rav", "ivf", "hiv", "aa", "angst", "doktor", "dr", "gyn", "medis"];
// stems that need a guard: «Operation», «operiert», not «Kooperation»; «IV-Abklärung», not «Archiv-Tag»
const SENSITIVE_PATTERNS = [/(?<!ko)oper(?:ation|ier)/u, /(?<![\p{L}\p{N}])iv-/u];

const LETTER = /[\p{L}\p{N}]/u;
const norm = (s: string) => s.toLowerCase().normalize("NFC");
function words(s: string): string[] {
  return norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** true when a text of hers holds a word that doesn't belong on a lock screen */
export function isSensitive(text: string): boolean {
  const t = norm(text);
  if (SENSITIVE_STEMS.some((s) => t.includes(s)) || SENSITIVE_PATTERNS.some((r) => r.test(t))) return true;
  const w = new Set(words(t));
  return SENSITIVE_WORDS.some((s) => w.has(s));
}

// words of a dream title too common to point to the dream («einmal», «sehen», «eigenes»)
const DREAM_STOP = new Set(
  "eine einen einem einer eines mein meine meinen meinem meiner nach über ueber unter oder sein seine mehr ganz einmal wieder eigene eigenen eigenes eigener machen sehen gehen fahren lernen laufen besuchen erleben schreiben spielen haben werden bauen kaufen finden selbst endlich richtig wirklich neue neuen neues neuer alle allen jahr jahre heute zusammen auch noch dann beim mich dich uns".split(
    " ",
  ),
);

/**
 * True when a text names one of her dreams: its title, or (with `words`) a telling word of it. Dreams are never
 * pushed. For an item of a goal that is not a dream, only the full title counts (P2: «Italienisch im Bus» for the
 * goal «Italienisch lernen» is no hint at the dream «In Italien Italienisch sprechen»).
 */
export function mentionsDream(text: string, goals: PushGoal[] | null, anyWord = true): boolean {
  const t = norm(text);
  const w = new Set(words(t));
  for (const g of goals ?? []) {
    if (g.kind !== "dream") continue;
    const title = norm(g.title).trim();
    if (title && t.includes(title)) return true;
    if (anyWord && words(title).some((x) => x.length >= 4 && !DREAM_STOP.has(x) && w.has(x))) return true;
  }
  return false;
}

/**
 * Her title, tidied and shortened for the lock screen; null when it must not be shown: a sensitive
 * word, a dream named in it, the goal it serves (`goalId`) has a sensitive title, or her goals could
 * not be read (`goals` null: then no title at all, only times and counts, so no dream slips through).
 * `ownAlarm`: a reminder she asked for herself, which may name a dream (owner decision 2 (b)); the sensitive
 * words still stay off the lock screen.
 */
export function safeLabel(text: string | null | undefined, goals: PushGoal[] | null, goalId?: string | null, ownAlarm = false): string | null {
  if (!text || !goals) return null;
  const goal = goalId ? goals.find((g) => g.id === goalId) : undefined;
  if (goal && isSensitive(goal.title)) return null;
  let t = text.replace(/\s+/g, " ").trim().replace(/[\s.,;:!?…]+$/u, "");
  if (!t || !LETTER.test(t) || isSensitive(t)) return null;
  if (!ownAlarm && mentionsDream(t, goals, !(goal && goal.kind !== "dream"))) return null;
  if (t.length > TITLE_MAX) {
    // at the last word boundary within the limit (a word ending right at the limit stays whole)
    const space = t.slice(0, TITLE_MAX + 1).lastIndexOf(" ");
    t = `${t.slice(0, space > TITLE_MAX / 2 ? space : TITLE_MAX).replace(/[\s.,;:!?-]+$/u, "")}…`;
  }
  return t;
}

/**
 * The word for one of her blocks whose title can't be shown (P2: never «Zeitblock»): from its length, «deine
 * Viertelstunde», «deine halbe Stunde», «deine Stunde», else «dein Eintrag».
 */
export function lengthLabel(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "dein Eintrag";
  if (minutes >= 13 && minutes <= 17) return "deine Viertelstunde";
  if (minutes >= 25 && minutes <= 35) return "deine halbe Stunde";
  if (minutes >= 50 && minutes <= 70) return "deine Stunde";
  return "dein Eintrag";
}

const lengthOf = (e: Pick<PushEvent, "starts_at" | "ends_at">) => (e.ends_at ? Math.round((Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60000) : null);

/** true when the thing belongs to a dream (or its goal is unknown): it is left out of every push */
export function servesDream(goalId: string | null | undefined, goals: PushGoal[] | null): boolean {
  if (!goalId) return false;
  const g = goals?.find((x) => x.id === goalId);
  return !g || g.kind === "dream";
}

// ---------- what ----------

export interface PushGoal {
  id: string;
  title: string;
  /** 'dream' or 'goal' */
  kind?: string | null;
  status?: string | null;
  done_at?: string | null;
}

export interface PushEvent {
  id?: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean | null;
  /** 'termin' or 'block' */
  kind?: string | null;
  goal_id?: string | null;
  /** 'nolio': planned by her trainer */
  source?: string | null;
  location?: string | null;
}

export interface MorningFacts {
  /** her entries around today (the function filters today's; the three days before tell an entry of every day) */
  events: PushEvent[];
  /** open steps (milestones) due today */
  dueSteps: { title: string; goal_id: string }[];
  /** her goals and dreams; null when they could not be read (then nothing linked to a goal and no title is shown) */
  goals: PushGoal[] | null;
  /** how often each label was named in a message of the last 7 days (fingerprint → count; see namedCounts) */
  named?: Record<string, number>;
}

export interface EveningFacts {
  goals: PushGoal[] | null;
  /** today's goal_time rows (confirmed time only: a «Ja» on a block, said in conversation, a tick, Nolio) */
  goalTime: { goal_id: string; minutes: number; source?: string | null; event_id?: string | null }[];
  /** milestones done lately (the function keeps today's) */
  milestones: { title: string; goal_id: string; done_at: string | null }[];
  /** habits ticked today */
  habits: { title: string; goal_id?: string | null }[];
  /** her entries around today, for the day's own entry when there is no win (the three days before as in the morning) */
  events?: PushEvent[];
  named?: Record<string, number>;
}

/** one possible body; `template` is what the log keeps (never the text), `named` the labels of her entries in it */
export interface Candidate {
  template: string;
  body: string;
  named?: string[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const count = (n: number) => (n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n));
const and = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}`);

function duration(min: number): string {
  if (min < 60) return min === 1 ? "1 Minute" : `${min} Minuten`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!m) return h === 1 ? "1 Stunde" : `${h} Stunden`;
  return `${h} Std ${m} Min`;
}

const titleKey = (t: string) => norm(t).replace(/\s+/g, " ").trim();

/**
 * Her timed entries that come every day: the same title on at least two of the three days before today (a daily
 * series, «10 Minuten dehnen» each evening). Such an entry is named at most twice within 7 days (DAILY_NAMED_MAX).
 */
export function dailyTitles(events: PushEvent[], today: string, tz: string): Set<string> {
  const from = addDays(today, -3);
  const days = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.all_day) continue;
    const d = localParts(new Date(e.starts_at), tz).date;
    if (d < from || d >= today) continue;
    const k = titleKey(e.title);
    if (!days.has(k)) days.set(k, new Set());
    days.get(k)!.add(d);
  }
  return new Set([...days].filter(([, d]) => d.size >= 2).map(([k]) => k));
}

/** how often each label was named in a message sent within the 7 days up to today (fingerprints of the labels) */
export function namedCounts(history: SentBefore[], today: string): Record<string, number> {
  const from = addDays(today, -(NO_REPEAT_DAYS - 1));
  const out: Record<string, number> = {};
  for (const h of history) {
    if ((h.status ?? "sent") !== "sent" || h.day < from || h.day > today) continue;
    for (const fp of new Set(h.named ?? [])) out[fp] = (out[fp] ?? 0) + 1;
  }
  return out;
}

/** an entry of every day that was named often enough lately: left out */
const namedEnough = (named: Record<string, number> | undefined, label: string) => (named?.[fingerprint(label)] ?? 0) >= DAILY_NAMED_MAX;

/**
 * The morning bodies, best first: today's entries still to come, a step due today, all-day entries. Nothing else:
 * without her own content there is no message. Nothing claims a free day (the app knows only her own entries).
 */
export function morningCandidates(f: MorningFacts, at: Date, tz: string): Candidate[][] {
  const now = localParts(at, tz);
  const wd = WEEKDAYS[now.weekday];
  const daily = dailyTitles(f.events, now.date, tz);
  const timed: { ms: number; time: string; label: string; evening: boolean }[] = [];
  const allDay: string[] = [];
  for (const e of f.events) {
    const start = localParts(new Date(e.starts_at), tz);
    let today: boolean;
    if (e.all_day) today = start.date <= now.date && now.date <= (e.ends_at ? localParts(new Date(e.ends_at), tz).date : start.date);
    else today = start.date === now.date;
    if (!today || servesDream(e.goal_id, f.goals)) continue;
    const label = safeLabel(e.title, f.goals, e.goal_id);
    if (e.all_day) {
      if (label && !allDay.includes(label)) allDay.push(label);
      continue;
    }
    const ms = Date.parse(e.starts_at);
    // already running or over (P1: «Um 06:45 geht es los: Frühdienst.» at 07:30)
    if (ms <= at.getTime()) continue;
    const shown = label ?? (e.kind === "block" ? lengthLabel(lengthOf(e)) : "Termin");
    if (daily.has(titleKey(e.title)) && namedEnough(f.named, shown)) continue;
    timed.push({ ms, time: hhmm(start.minutes), label: shown, evening: start.minutes >= EVENING_ENTRY_MIN });
  }
  timed.sort((a, b) => a.ms - b.ms);

  const groups: Candidate[][] = [];
  if (timed.length) {
    const [a, b] = timed;
    const more = timed.length - 2;
    const moreText = more > 0 ? `, dazu ${more === 1 ? "1 weiterer Eintrag" : `${more} weitere Einträge`}` : "";
    const named = [a.label, ...(b ? [b.label] : [])];
    // an evening entry is «heute Abend um 21:30 …», never a bare «21:30» at 07:30
    const item = (x: typeof a) => (x.evening ? `heute Abend um ${x.time} ${x.label}` : `${x.time} ${x.label}`);
    if (!a.evening) {
      const list = `${item(a)}${b ? `, ${item(b)}` : ""}${moreText}`;
      const then = (word: string) => (b ? (b.evening ? ` ${cap(item(b))}.` : ` ${word} ${item(b)}.`) : "");
      groups.push([
        { template: "m.day.1", body: `Heute: ${list}.`, named },
        { template: "m.day.2", body: `Als Erstes heute: ${item(a)}.${then("Danach")}`, named },
        { template: "m.day.3", body: `Um ${a.time} geht es los: ${a.label}.${then("Später")}`, named },
        { template: "m.day.4", body: `${wd}: ${list}.`, named },
        {
          template: "m.day.5",
          body: timed.length === 1 ? `Heute ein Eintrag, um ${a.time}.` : `Heute ${count(timed.length)} Einträge, der erste um ${a.time}.`,
        },
      ]);
    } else {
      const rest = b ? ` Danach um ${b.time} ${b.label}${moreText}.` : "";
      groups.push([
        { template: "m.eve.1", body: `Heute Abend um ${a.time}: ${a.label}.${rest}`, named },
        { template: "m.eve.2", body: `${wd}: heute Abend um ${a.time} ${a.label}.${rest}`, named },
        { template: "m.eve.3", body: `Heute Abend um ${a.time} steht an: ${a.label}.${rest}`, named },
        {
          template: "m.eve.4",
          body: timed.length === 1 ? `Heute ein Eintrag, am Abend um ${a.time}.` : `Heute ${count(timed.length)} Einträge am Abend, der erste um ${a.time}.`,
        },
      ]);
    }
  }
  const steps = f.dueSteps.filter((m) => !servesDream(m.goal_id, f.goals));
  if (steps.length) {
    const l = steps.length === 1 ? safeLabel(steps[0].title, f.goals, steps[0].goal_id) : null;
    groups.push(
      l
        ? [
            { template: "m.step.1", body: `Heute an der Reihe: ${l}.` },
            { template: "m.step.2", body: `Für heute vorgesehen: ${l}.` },
            { template: "m.step.3", body: `${wd}: ${l} steht an.` },
          ]
        : steps.length === 1
          ? [
              { template: "m.step.4", body: "Heute ist eine Etappe an der Reihe." },
              { template: "m.step.5", body: `${wd}: eine Etappe steht an.` },
            ]
          : [
              { template: "m.step.6", body: `Heute sind ${count(steps.length)} Etappen an der Reihe.` },
              { template: "m.step.7", body: `${wd}: ${count(steps.length)} Etappen stehen an.` },
            ],
    );
  }
  if (allDay.length) {
    const named = allDay.slice(0, 2);
    const l = and(named);
    groups.push([
      { template: "m.allday.1", body: `Heute: ${l}.`, named },
      { template: "m.allday.2", body: `Heute steht an: ${l}.`, named },
      { template: "m.allday.3", body: `${wd}: ${l}.`, named },
    ]);
  }
  return groups;
}

/**
 * The evening bodies, best first: one win of today (a goal reached, a step, time for a goal, a habit), else one of
 * her own entries of the day that is over, as a plain statement («Heute war: 15:30 Malen mit Lina.»), never a word
 * on whether it happened. Nothing else: without her own content there is no message. Each win group has a line with
 * the weekday, which is new every day of the 7-day window, so a win she has every day is still named every evening.
 */
export function eveningCandidates(f: EveningFacts, at: Date, tz: string): Candidate[][] {
  const now = localParts(at, tz);
  const wd = WEEKDAYS[now.weekday];
  const doneToday = (iso: string | null | undefined) => !!iso && localParts(new Date(iso), tz).date === now.date;
  const groups: Candidate[][] = [];

  const reached = (f.goals ?? []).filter((g) => g.kind !== "dream" && g.status === "done" && doneToday(g.done_at));
  if (reached.length) {
    const l = safeLabel(reached[0].title, f.goals);
    groups.push(
      l
        ? [
            { template: "e.goal.1", body: `Heute erreicht: ${l}.` },
            { template: "e.goal.2", body: `${cap(l)}: heute geschafft.` },
            { template: "e.goal.3", body: `Heute ist es so weit: ${l}.` },
          ]
        : [
            { template: "e.goal.4", body: "Heute hast du ein Ziel erreicht." },
            { template: "e.goal.5", body: "Ein Ziel ist heute erreicht." },
          ],
    );
  }

  const steps = f.milestones.filter((m) => doneToday(m.done_at) && !servesDream(m.goal_id, f.goals));
  if (steps.length) {
    const l = steps.length === 1 ? safeLabel(steps[0].title, f.goals, steps[0].goal_id) : null;
    const oneStep = [
      { template: "e.step.4", body: "Heute eine Etappe erledigt." },
      { template: "e.step.5", body: "Eine Etappe ist heute geschafft." },
      { template: "e.step.8", body: `${wd}: eine Etappe erledigt.` },
    ];
    groups.push(
      l
        ? [
            { template: "e.step.1", body: `Heute erledigt: ${l}.` },
            { template: "e.step.2", body: `Etappe geschafft: ${l}.` },
            { template: "e.step.3", body: `${cap(l)}: heute erledigt.` },
            { template: "e.step.9", body: `${wd}: ${l} erledigt.` },
            ...oneStep,
          ]
        : steps.length === 1
          ? oneStep
          : [
              { template: "e.step.6", body: `Heute ${count(steps.length)} Etappen erledigt.` },
              { template: "e.step.7", body: `${cap(count(steps.length))} Etappen sind heute geschafft.` },
              { template: "e.step.10", body: `${wd}: ${count(steps.length)} Etappen erledigt.` },
            ],
    );
  }

  // time she confirmed today, per goal (never WHOOP values, never a dream)
  const perGoal = new Map<string, number>();
  for (const r of f.goalTime) {
    if (r.source === "whoop" || !(r.minutes > 0) || servesDream(r.goal_id, f.goals)) continue;
    perGoal.set(r.goal_id, (perGoal.get(r.goal_id) ?? 0) + r.minutes);
  }
  const top = [...perGoal.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const d = duration(Math.min(top[1], 1440));
    const l = safeLabel(f.goals?.find((g) => g.id === top[0])?.title, f.goals);
    const noLabel = [
      { template: "e.time.4", body: `Heute ${d} für dein Ziel.` },
      { template: "e.time.5", body: `${d} für dein Ziel heute. Das zählt.` },
      { template: "e.time.7", body: `${wd}: ${d} für dein Ziel.` },
    ];
    groups.push(
      l
        ? [
            { template: "e.time.1", body: `Heute ${d} für ${l}.` },
            { template: "e.time.2", body: `${d} für ${l} heute. Das zählt.` },
            { template: "e.time.3", body: `Heute geschafft: ${d} für ${l}.` },
            { template: "e.time.6", body: `${wd}: ${d} für ${l}.` },
            ...noLabel,
          ]
        : noLabel,
    );
  }

  const habits = f.habits.filter((h) => !servesDream(h.goal_id, f.goals));
  if (habits.length) {
    const labels = habits.map((h) => safeLabel(h.title, f.goals, h.goal_id));
    const l = habits.length <= 2 && labels.every(Boolean) ? and(labels as string[]) : null;
    const one = habits.length === 1;
    const noLabel = [
      { template: "e.habit.4", body: one ? "Heute eine Gewohnheit abgehakt." : `Heute ${count(habits.length)} Gewohnheiten abgehakt.` },
      { template: "e.habit.5", body: one ? "Eine Gewohnheit ist heute erledigt." : `${cap(count(habits.length))} Gewohnheiten sind heute erledigt.` },
      { template: "e.habit.7", body: one ? `${wd}: eine Gewohnheit abgehakt.` : `${wd}: ${count(habits.length)} Gewohnheiten abgehakt.` },
    ];
    groups.push(
      l
        ? [
            { template: "e.habit.1", body: `Heute abgehakt: ${l}.` },
            { template: "e.habit.2", body: `${cap(l)}: heute erledigt.` },
            { template: "e.habit.3", body: `Heute dabei: ${l}.` },
            { template: "e.habit.6", body: `${wd}: ${l} abgehakt.` },
            ...noLabel,
          ]
        : noLabel,
    );
  }

  // no win: one of her own entries of today that is over (no work, no shift, nothing sensitive, not from her
  // trainer, no block she said no to, never a dream; one of every day only twice a week)
  if (!groups.length && f.events?.length) {
    const declined = new Set(f.goalTime.flatMap((r) => (r.event_id && r.minutes === 0 ? [r.event_id] : [])));
    const daily = dailyTitles(f.events, now.date, tz);
    const own = eveningEntries(
      f.events.map((e) => ({ ...e, id: e.id ?? "", all_day: !!e.all_day, ends_at: e.ends_at ?? null, kind: e.kind ?? undefined })),
      { now: at.getTime(), today: now.date, dayOfIso: (iso) => localParts(new Date(iso), tz).date, declined },
      20,
    );
    for (const e of own) {
      const l = servesDream(e.goal_id, f.goals) ? null : safeLabel(e.title, f.goals, e.goal_id);
      if (!l || (daily.has(titleKey(e.title)) && namedEnough(f.named, l))) continue;
      const t = hhmm(localParts(new Date(e.starts_at), tz).minutes);
      groups.push([
        { template: "e.entry.1", body: `Heute war: ${t} ${l}.`, named: [l] },
        { template: "e.entry.2", body: `Heute um ${t}: ${l}.`, named: [l] },
        { template: "e.entry.3", body: `${wd} um ${t}: ${l}.`, named: [l] },
        { template: "e.entry.4", body: `Heute: ${l}, um ${t}.`, named: [l] },
      ]);
      break;
    }
  }
  return groups;
}

// ---------- the pause: one line, then nothing ----------

export interface PauseFacts {
  /** her coming entries (the next days) */
  events: PushEvent[];
  /** her open steps with a day */
  steps: { title: string; goal_id: string; due_date: string | null }[];
  goals: PushGoal[] | null;
}

/** how far ahead the pause line looks for her next entry or step */
export const PAUSE_LOOKAHEAD_DAYS = 6;

/**
 * The one line after a few days away: her next entry still to come, or her next step, from her own data and safe for
 * the lock screen; nothing about the pause itself. Empty when there is nothing of hers to name (then nothing comes).
 */
export function pauseCandidates(f: PauseFacts, at: Date, tz: string): Candidate[][] {
  const now = localParts(at, tz);
  const last = addDays(now.date, PAUSE_LOOKAHEAD_DAYS);
  const dayWord = (day: string) => (day === now.date ? "heute" : day === addDays(now.date, 1) ? "morgen" : `am ${WEEKDAYS[weekdayOf(day)]}`);
  let entry: { day: string; ms: number; time: string; label: string; evening: boolean } | null = null;
  for (const e of f.events) {
    const ms = Date.parse(e.starts_at);
    if (e.all_day || !(ms > at.getTime()) || servesDream(e.goal_id, f.goals) || (entry && entry.ms <= ms)) continue;
    const s = localParts(new Date(ms), tz);
    const label = safeLabel(e.title, f.goals, e.goal_id);
    if (!label || s.date > last) continue;
    entry = { day: s.date, ms, time: hhmm(s.minutes), label, evening: s.minutes >= EVENING_ENTRY_MIN };
  }
  let step: { day: string; label: string } | null = null;
  for (const m of f.steps) {
    if (!m.due_date || m.due_date < now.date || m.due_date > last || servesDream(m.goal_id, f.goals) || (step && step.day <= m.due_date)) continue;
    const label = safeLabel(m.title, f.goals, m.goal_id);
    if (label) step = { day: m.due_date, label };
  }
  if (entry && (!step || entry.day <= step.day)) {
    const w = dayWord(entry.day);
    const named = [entry.label];
    const head = entry.day === now.date && entry.evening ? `Heute Abend um ${entry.time}: ${entry.label}.` : `${cap(w)}: ${entry.time} ${entry.label}.`;
    return [
      [
        { template: "p.entry.1", body: head, named },
        { template: "p.entry.2", body: `Als Nächstes: ${w} um ${entry.time} ${entry.label}.`, named },
      ],
    ];
  }
  if (step) {
    const w = dayWord(step.day);
    return [
      [
        { template: "p.step.1", body: `${cap(w)} an der Reihe: ${step.label}.` },
        { template: "p.step.2", body: `Als Nächstes: ${step.label}.` },
      ],
    ];
  }
  return [];
}

// ---------- reminders: «Blöcke und Wunsch» ----------

export interface ReminderEvent extends PushEvent {
  id: string;
  reminder_minutes: number | null;
  /** she asked for this reminder herself (events.reminder_asked) */
  reminder_asked?: boolean | null;
}

/** her iPhone calendar reads the feed (it fetched within the last days): its own alarms remind her, no push */
export function calendarSubscribed(fetchedAt: string | null | undefined, at: Date): boolean {
  const t = Date.parse(fetchedAt ?? "");
  return Number.isFinite(t) && at.getTime() - t < CALENDAR_FRESH_DAYS * DAY_MS;
}

/**
 * The moment (ms) a reminder is due: starts_at − reminder_minutes, for her blocks and the entries she asked a
 * reminder for (owner decision 2 (b)); null for the rest: all-day entries, her trainer's (Nolio), none set, more
 * than a day ahead.
 */
export function reminderAt(e: ReminderEvent): number | null {
  if (e.all_day || e.source === "nolio" || e.reminder_minutes == null) return null;
  if (e.kind !== "block" && e.reminder_asked !== true) return null;
  if (e.reminder_minutes < 0 || e.reminder_minutes > REMINDER_MAX_LEAD_MIN) return null;
  const s = Date.parse(e.starts_at);
  return Number.isFinite(s) ? s - e.reminder_minutes * 60000 : null;
}

export interface ReminderFacts {
  events: ReminderEvent[];
  /** blocks with an answer already (done early, answered by a habit tick): nothing to remind of */
  answered: Set<string>;
  /** how many reminders went out today already */
  sentToday: number;
  /** her activity (null: unknown): in a pause only the reminders she asked for, after 14 days none */
  activity: Activity | null;
}

/**
 * The reminders this run sends, earliest first: their moment lies within the next run's span (or a few minutes
 * behind, never once the entry began), at most what is left of the day's three.
 */
export function dueReminders(f: ReminderFacts, at: Date): ReminderEvent[] {
  const now = at.getTime();
  const pause = f.activity ? pauseState(at, f.activity, true) : null;
  const ref = Date.parse(f.activity?.lastOpen ?? f.activity?.since ?? "");
  if (Number.isFinite(ref) && now - ref >= PAUSE_AFTER_DAYS * DAY_MS) return [];
  const seen = new Set<string>();
  return f.events
    .filter((e) => {
      const m = reminderAt(e);
      if (m === null || seen.has(e.id) || f.answered.has(e.id)) return false;
      if (!(now < Date.parse(e.starts_at) && m < now + REMINDER_WINDOW_MIN * 60000 && now - m <= REMINDER_GRACE_MIN * 60000)) return false;
      // away for a few days: her blocks rest (no pressure), what she asked for still comes
      if (pause && e.reminder_asked !== true) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => reminderAt(a)! - reminderAt(b)!)
    .slice(0, Math.max(0, REMINDERS_PER_DAY - f.sentToday));
}

/**
 * The reminder itself: «Um 10:00» and her title («Nachricht an die Stationsleitung.»). A reminder she asked for
 * shows her own title, also of a dream step (it is her own alarm); a block of a dream or with a sensitive title only
 * its length («Deine halbe Stunde.»), a termin «Dein Termin.».
 */
export function reminderMessage(e: ReminderEvent, goals: PushGoal[] | null, at: Date, tz: string): Candidate & { title: string } {
  const start = localParts(new Date(e.starts_at), tz);
  const today = localParts(at, tz).date;
  const time = hhmm(start.minutes);
  const title = start.date === today ? `Um ${time}` : start.date === addDays(today, 1) ? `Morgen um ${time}` : `${WEEKDAYS[start.weekday]} um ${time}`;
  const own = e.reminder_asked === true;
  const label = own ? safeLabel(e.title, goals, e.goal_id, true) : servesDream(e.goal_id, goals) ? null : safeLabel(e.title, goals, e.goal_id);
  const fallback = e.kind === "block" ? lengthLabel(lengthOf(e)) : "dein Termin";
  return { title, template: own ? "r.asked" : "r.block", body: `${cap(label ?? fallback)}.` };
}

// ---------- rotation ----------

/** a short fingerprint of a body (FNV-1a, 8 hex digits): the log keeps this, never the text */
export function fingerprint(body: string): string {
  let h = 0x811c9dc5;
  for (const ch of norm(body).replace(/\s+/g, " ").trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** a row of the push log as far as the rotation needs it */
export interface SentBefore {
  day: string;
  slot?: string | null;
  status?: string | null;
  template?: string | null;
  fingerprint?: string | null;
  /** fingerprints of the labels of her entries the body named (see namedCounts) */
  named?: string[] | null;
  created_at?: string | null;
}

/**
 * The body to send: from the best group that still has one not sent within the last 7 days (no
 * identical body), the template not used in these days first, else the one used longest ago. Null
 * when there is nothing (no group) or nothing left.
 */
export function chooseBody(groups: Candidate[][], history: SentBefore[], today: string, slot: Slot): Candidate | null {
  const from = addDays(today, -(NO_REPEAT_DAYS - 1));
  const recent = history.filter((h) => (h.status ?? "sent") === "sent" && h.day >= from && h.day <= today);
  const prints = new Set(recent.map((h) => h.fingerprint).filter(Boolean));
  const last = new Map<string, string>();
  for (const h of recent) if (h.slot === slot && h.template && (last.get(h.template) ?? "") < h.day) last.set(h.template, h.day);
  for (const group of groups) {
    const fresh = group.filter((c) => !prints.has(fingerprint(c.body)));
    if (fresh.length) return fresh.reduce((best, c) => ((last.get(c.template) ?? "") < (last.get(best.template) ?? "") ? c : best));
  }
  return null;
}

/** the notification title: the stable greeting with her name */
export function pushTitle(slot: Slot, name: string | null | undefined): string {
  const n = name?.trim() ? `, ${name.trim()}` : "";
  return slot === "morning" ? `Guten Morgen${n}` : `Guten Abend${n}`;
}
