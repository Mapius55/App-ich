// Notifications from the coach (Edge Function "push"): when one is due, when it stays out and what it
// says. Pure and without imports, so the app (the settings text) and the tests use it too.
// Days are her local calendar days ("YYYY-MM-DD") in her time zone (profiles.timezone).
//
// The rules (BUILD-SPEC, owner decision 1 «Morgens und abends, schlauer»):
// - The bodies are statements from her data, never questions. Morning: what is on today (her entries, a
//   step due today), else a gentle neutral line: never a claim about her whole day, the app doesn't see
//   every calendar. Evening: one small win of the day, else a gentle neutral line. No identical body
//   within 7 days.
// - Morning: none once she has opened the app today. Evening: none when she talked in the last 3 hours
//   or the app already greeted her this evening.
// - Saturday and Sunday 90 minutes later, only at the default times.
// - After 14 days without opening the app: none at all, silently, until she opens it again. Her own
//   switches stay as they are.
// - Lock-screen safe: short, no health words (also not the title of something that serves a goal with
//   one), no WHOOP values, never a dream. Goals unknown (the query failed): times and counts only.

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

/** when the slot is due on this weekday (minutes since midnight): the weekend shift only at the default time */
export function slotMinutes(slot: Slot, time: string, weekday: number): number {
  return toMinutes(time) + (weekday >= 5 && isDefaultTime(slot, time) ? WEEKEND_SHIFT_MIN : 0);
}

/** the weekend time ("HH:MM") when it differs from the chosen one (for the settings text), else null */
export function weekendTime(slot: Slot, time: string): string | null {
  return isDefaultTime(slot, time) ? hhmm(slotMinutes(slot, time, 5)) : null;
}

// ---------- when ----------

export interface PushProfile {
  notify_morning: string | null;
  notify_evening: string | null;
  /** the last day a slot was decided (sent or left out) */
  last_morning_push: string | null;
  last_evening_push: string | null;
}

/** the slot whose time has come and that is not decided yet today (the morning first), or null */
export function dueSlot(p: PushProfile, now: LocalNow): Slot | null {
  const due = (slot: Slot, time: string | null, last: string | null) => {
    if (!time || last === now.date) return false;
    const m = slotMinutes(slot, time, now.weekday);
    return now.minutes >= m && now.minutes < m + DUE_WINDOW_MIN;
  };
  if (due("morning", p.notify_morning, p.last_morning_push)) return "morning";
  if (due("evening", p.notify_evening, p.last_evening_push)) return "evening";
  return null;
}

/** why a due slot stays out; "repeat" = nothing left that wasn't sent within 7 days (should not happen) */
export type SkipReason = "opened_today" | "talked_recently" | "this_evening" | "paused" | "repeat";

export interface Activity {
  /** created_at of her newest message row, any thread: every first open of a day writes the hidden «app opened» turn */
  lastOpen: string | null;
  /** created_at of the newest thing she said herself (a user message that is not hidden) */
  lastTalk: string | null;
  /** when her profile was made: where the pause counts from while she has no message yet */
  since?: string | null;
}

/** why the due slot stays out, or null when it goes out */
export function skipReason(slot: Slot, at: Date, tz: string, slotMin: number, a: Activity): SkipReason | null {
  const ref = Date.parse(a.lastOpen ?? a.since ?? "");
  if (Number.isFinite(ref) && at.getTime() - ref >= PAUSE_AFTER_DAYS * DAY_MS) return "paused";
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

/** true when a text names one of her dreams (its title, or a telling word of it): dreams are never pushed */
export function mentionsDream(text: string, goals: PushGoal[] | null): boolean {
  const t = norm(text);
  const w = new Set(words(t));
  for (const g of goals ?? []) {
    if (g.kind !== "dream") continue;
    const title = norm(g.title).trim();
    if (title && t.includes(title)) return true;
    if (words(title).some((x) => x.length >= 4 && !DREAM_STOP.has(x) && w.has(x))) return true;
  }
  return false;
}

/**
 * Her title, tidied and shortened for the lock screen; null when it must not be shown: a sensitive
 * word, a dream named in it, the goal it serves (`goalId`) has a sensitive title, or her goals could
 * not be read (`goals` null: then no title at all, only times and counts, so no dream slips through).
 */
export function safeLabel(text: string | null | undefined, goals: PushGoal[] | null, goalId?: string | null): string | null {
  if (!text || !goals) return null;
  if (goalId && isSensitive(goals.find((g) => g.id === goalId)?.title ?? "")) return null;
  let t = text.replace(/\s+/g, " ").trim().replace(/[\s.,;:!?…]+$/u, "");
  if (!t || !LETTER.test(t) || isSensitive(t) || mentionsDream(t, goals)) return null;
  if (t.length > TITLE_MAX) {
    // at the last word boundary within the limit (a word ending right at the limit stays whole)
    const space = t.slice(0, TITLE_MAX + 1).lastIndexOf(" ");
    t = `${t.slice(0, space > TITLE_MAX / 2 ? space : TITLE_MAX).replace(/[\s.,;:!?-]+$/u, "")}…`;
  }
  return t;
}

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
  title: string;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean | null;
  /** 'termin' or 'block' */
  kind?: string | null;
  goal_id?: string | null;
}

export interface MorningFacts {
  /** her entries around today (the function filters today's) */
  events: PushEvent[];
  /** open steps (milestones) due today */
  dueSteps: { title: string; goal_id: string }[];
  /** her goals and dreams; null when they could not be read (then nothing linked to a goal and no title is shown) */
  goals: PushGoal[] | null;
}

export interface EveningFacts {
  goals: PushGoal[] | null;
  /** today's goal_time rows (confirmed time only: a «Ja» on a block, said in conversation, Nolio) */
  goalTime: { goal_id: string; minutes: number; source?: string | null }[];
  /** milestones done lately (the function keeps today's) */
  milestones: { title: string; goal_id: string; done_at: string | null }[];
  /** habits ticked today */
  habits: { title: string; goal_id?: string | null }[];
}

/** one possible body; `template` is what the log keeps (never the text) */
export interface Candidate {
  template: string;
  body: string;
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

/**
 * The morning bodies, best first: today's entries, a step due today, all-day entries, a plain line.
 * Nothing claims a free day: the app knows only her own entries, not every calendar of hers.
 */
export function morningCandidates(f: MorningFacts, at: Date, tz: string): Candidate[][] {
  const now = localParts(at, tz);
  const wd = WEEKDAYS[now.weekday];
  const timed: { ms: number; time: string; label: string }[] = [];
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
    const end = e.ends_at ? Date.parse(e.ends_at) : ms + 3600e3;
    if (end <= at.getTime()) continue; // already over
    timed.push({ ms, time: hhmm(start.minutes), label: label ?? (e.kind === "block" ? "Zeitblock" : "Termin") });
  }
  timed.sort((a, b) => a.ms - b.ms);

  const groups: Candidate[][] = [];
  if (timed.length) {
    const [a, b] = timed.map((e) => `${e.time} ${e.label}`);
    const more = timed.length - 2;
    const two = b ? `${a}, ${b}${more > 0 ? `, dazu ${more === 1 ? "1 weiterer Eintrag" : `${more} weitere Einträge`}` : ""}` : a;
    const first = timed[0];
    groups.push([
      { template: "m.day.1", body: `Heute: ${two}.` },
      { template: "m.day.2", body: `Als Erstes heute: ${a}.${b ? ` Danach ${b}.` : ""}` },
      { template: "m.day.3", body: `Um ${first.time} geht es los: ${first.label}.${b ? ` Später ${b}.` : ""}` },
      { template: "m.day.4", body: `${wd}: ${two}.` },
      {
        template: "m.day.5",
        body: timed.length === 1 ? `Heute ein Eintrag, um ${first.time}.` : `Heute ${count(timed.length)} Einträge, der erste um ${first.time}.`,
      },
    ]);
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
    const l = and(allDay.slice(0, 2));
    groups.push([
      { template: "m.allday.1", body: `Heute: ${l}.` },
      { template: "m.allday.2", body: `Heute steht an: ${l}.` },
      { template: "m.allday.3", body: `${wd}: ${l}.` },
    ]);
  }
  groups.push([
    { template: "m.plain.1", body: `Einen guten ${wd}.` },
    { template: "m.plain.2", body: "Ein neuer Tag beginnt." },
    { template: "m.plain.3", body: `Schönen ${wd}.` },
    { template: "m.plain.4", body: "Hab einen guten Tag." },
    { template: "m.plain.5", body: "Ein ruhiger Start in den Tag." },
    { template: "m.plain.6", body: "Der Tag beginnt." },
    { template: "m.plain.7", body: "Alles Gute für heute." },
    { template: "m.plain.8", body: "Ein neuer Morgen." },
  ]);
  return groups;
}

/**
 * The evening bodies, best first: one win of today (a goal reached, a step, time for a goal, a habit), a
 * plain line. Each win group has a line with the weekday, which is new every day of the 7-day window, so
 * a win she has every day (a daily habit, her daily minutes) is still named every evening.
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

  groups.push([
    { template: "e.plain.1", body: "Schönen Abend." },
    { template: "e.plain.2", body: "Der Abend gehört dir." },
    { template: "e.plain.3", body: "Lass den Tag ruhig ausklingen." },
    { template: "e.plain.4", body: `Schönen ${wd}abend.` },
    { template: "e.plain.5", body: "Der Tag ist bald vorbei. Schönen Abend." },
    { template: "e.plain.6", body: "Zeit für dich heute Abend." },
    { template: "e.plain.7", body: "Hab einen ruhigen Abend." },
    { template: "e.plain.8", body: "Mach es dir gemütlich heute Abend." },
  ]);
  return groups;
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
}

/**
 * The body to send: from the best group that still has one not sent within the last 7 days (no
 * identical body), the template not used in these days first, else the one used longest ago. Null
 * only when nothing is left (the plain groups have more lines than there are days in the window).
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
