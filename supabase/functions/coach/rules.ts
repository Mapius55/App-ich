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

/**
 * Hints for the coach in the answer of create_goal / update_goal: a missing target date, and
 * milestones for a goal more than six weeks away (or without a date) that has none yet.
 */
export function goalHints(
  g: { status?: string | null; target_date: string | null; milestones?: unknown[] | null },
  today: string,
): { hinweis?: string; naechster_schritt?: string } {
  const out: { hinweis?: string; naechster_schritt?: string } = {};
  const active = !g.status || g.status === "active";
  if (!g.target_date && active) out.hinweis = "Zieldatum fehlt: Näherungsdatum setzen oder fragen";
  const far = !g.target_date || daysBetween(today, g.target_date) > MILESTONE_HINT_DAYS;
  if (active && far && !(g.milestones?.length ?? 0)) out.naechster_schritt = "Etappen vorschlagen (zwei bis vier, mit Monat), nach ihrem Ja mit due_date speichern";
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
