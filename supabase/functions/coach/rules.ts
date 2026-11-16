// Small, pure rules for the coach's tools (goals, Nolio entries). No Deno-only imports: the tests
// import this file with vitest, index.ts uses it.

import { daysBetween } from "../_shared/plan.ts";

/** Prior hours above this share of the estimate need prior_bestaetigt: true (the person named or confirmed them). */
export const PRIOR_MAX_SHARE = 0.3;

/**
 * Why prior_hours can't be saved like this, or null when they can. Experience from earlier years must
 * never turn into hours (persona p06: 1000 h "from five years of running" made a new goal 81 % done).
 */
export function priorProblem(prior: number | null | undefined, effort: number | null | undefined, confirmed: boolean): string | null {
  if (!prior || prior <= 0 || confirmed) return null;
  if (!effort || effort <= 0) return null;
  if (prior <= PRIOR_MAX_SHARE * effort) return null;
  return (
    "prior_hours ist mehr als 30 % der Schätzung. Zähle nur Stunden, die sie schon für genau dieses Ziel gearbeitet hat, " +
    "und nur eine Zahl, die sie genannt oder bestätigt hat (dann mit prior_bestaetigt: true). Erfahrung macht höchstens die Schätzung kleiner."
  );
}

/** Days ahead from which a goal without milestones should get some (six weeks). */
export const MILESTONE_HINT_DAYS = 42;

/** After a dream came true: the one question, and where the answer goes. */
export const DREAM_ASK_HOW =
  "Frag ein einziges Mal „Wie war es?“ und speichere ihre Antwort mit update_goal memory, kurz und in ihren Worten, in der Ich-Form, so wie sie es sagt (nicht in der dritten Person).";

/** The next step for a goal (or a dream being planned) more than six weeks away without milestones. */
export const MILESTONES_STEP = "Etappen vorschlagen (zwei bis vier, mit Monat), nach ihrem Ja mit due_date speichern";

/**
 * Hints for the coach in the answer of create_goal / update_goal: a missing target date, and
 * milestones for a goal more than six weeks away (or without a date) that has none yet. A dream needs
 * no date (it may simply wait on the Bucket List, never nagged), and a date alone doesn't mean she is
 * planning it: she may only have said when («2030 einmal nach Japan»). It gets the milestones like a
 * goal only when the call itself plans it (`planned`: update_goal with planen: true, after her yes).
 * A fulfilled one without a memory gets the question.
 */
export function goalHints(
  g: { kind?: string | null; status?: string | null; target_date: string | null; milestones?: unknown[] | null; memory?: string | null },
  today: string,
  planned = false,
): { hinweis?: string; naechster_schritt?: string } {
  const out: { hinweis?: string; naechster_schritt?: string } = {};
  const active = !g.status || g.status === "active";
  const none = !(g.milestones?.length ?? 0);
  if (g.kind === "dream") {
    if (g.status === "done" && !g.memory?.trim()) out.naechster_schritt = DREAM_ASK_HOW;
    else if (planned && active && none && g.target_date && daysBetween(today, g.target_date) > MILESTONE_HINT_DAYS) out.naechster_schritt = MILESTONES_STEP;
    return out;
  }
  if (!g.target_date && active) out.hinweis = "Zieldatum fehlt: Näherungsdatum setzen oder fragen";
  const far = !g.target_date || daysBetween(today, g.target_date) > MILESTONE_HINT_DAYS;
  if (active && far && none) out.naechster_schritt = MILESTONES_STEP;
  return out;
}

/** The coach may not change entries the trainer planned in Nolio; only their reminder. */
export const NOLIO_EDIT_REFUSAL =
  "Dieser Eintrag kommt aus Nolio (vom Trainer geplant) und lässt sich nur dort ändern oder löschen. Hier geht nur die Erinnerung (reminder_minutes). Sag ihr das freundlich.";
export const NOLIO_TIME_REFUSAL =
  "Dieses Training kommt aus Nolio: Es zählt von selbst für das Ziel, sobald es in Nolio erledigt ist. Kein log_time dafür, sonst zählt es doppelt.";

/** update_event on a Nolio entry: allowed only when nothing but the reminder changes. */
export function nolioEditAllowed(input: Record<string, unknown>): boolean {
  return Object.keys(input).every((k) => k === "id" || k === "reminder_minutes");
}

/** A short count of what the reply looks like, for the logs (no content): words and question marks. */
export function replyShape(text: string): { words: number; questions: number } {
  const t = text.trim();
  return { words: t ? t.split(/\s+/).length : 0, questions: (t.match(/\?/g) ?? []).length };
}

/**
 * A memory that carries WHOOP values (or what the coach read from them), e.g. „Erholung meist um 60 %“
 * or „HRV sinkt nach langen Arbeitstagen“. Checked only on turns where WHOOP values were in the
 * context: WHOOP data is kept 14 days at most and never becomes a memory.
 */
export function whoopInMemory(text: string): boolean {
  return /\bWHOOP\b|\bHRV\b|Herzfrequenzvariabilit|Ruhepuls|Schlafleistung|\bStrain\b|(Erholung|Belastung|Schlaf)\w*(\s+(von|bei|um|unter|über|meist|oft|etwa|rund|im Schnitt))*\s*(\d|Ø)/i.test(text);
}
export const WHOOP_MEMORY_REFUSAL =
  "Werte von WHOOP (und Muster daraus) werden nie als Erinnerung gespeichert: Sie stehen jeden Tag neu im Kontext und werden nach 14 Tagen gelöscht. Nichts speichern, nichts dazu sagen.";

/** What the coach gets instead of an earlier reply of its own that used WHOOP values, while it may not see them. */
export const WHOOP_HIDDEN_REPLY = "(Diese frühere Antwort enthielt Werte von WHOOP. Du darfst sie gerade nicht sehen.)";

/** The birth year the coach may save (update_profile): a whole year from 1900 up to this year. Null when fine. */
export function birthYearProblem(v: unknown, today: string): string | null {
  const year = Number(today.slice(0, 4));
  if (typeof v !== "number" || !Number.isInteger(v)) return "birth_year muss ein Jahr sein, z.B. 1994";
  if (v < 1900 || v > year) return `birth_year: ein Jahr von 1900 bis ${year}`;
  return null;
}

/** When a dream came true (done_date): a day up to today. Null when fine. */
export function doneDateProblem(day: string, today: string): string | null {
  if (day > today) return "done_date liegt in der Zukunft";
  if (day < "1900-01-01") return "done_date: kein Tag vor 1900";
  return null;
}
