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

/** After a dream came true or a goal was reached: the one question, and where the answer goes. */
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
 * A fulfilled dream or a reached goal without a memory gets the question «Wie war es?».
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
  if (g.status === "done") return g.memory?.trim() ? out : { naechster_schritt: DREAM_ASK_HOW };
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

// ---------- drafts: only what it says reaches her ----------

/**
 * A sentence about the reply itself instead of to her, at the start of a sentence: «Das sind zwei Fragen, also nur
 * eine:», «Kürzer:», «Neuer Versuch:», «Entwurf:». After one comes the version meant for her.
 */
const META =
  /^(?:Das (?:sind|waren|wären) (?:zwei|drei|vier|\d+) Fragen\b|Also nur eine(?: Frage)?\s*:|(?:Zu viele|Zu lang)\s*[:.]|Kürzer\s*:|(?:Kürzere|Neue|Zweite|Bessere|Endgültige|Korrigierte|Überarbeitete|Finale) (?:Version|Fassung)\s*:|(?:Neuer|Zweiter) Versuch\s*:|(?:Korrektur|Entwurf|Endfassung|Draft|Revised|Final)\s*:)/i;
/** A greeting that opens a reply; «Gute Nacht» closes one and doesn't count. */
const GREETING = /^(?:Guten (?:Morgen|Mittag|Tag|Nachmittag|Abend)|Grüezi|Grüss dich|Hallo|Hoi|Salü)(?![a-zäöü])/i;
/** Where a sentence or a line begins: after a sentence end and a space, or after a line break. */
const SEGMENT = /(?:[.!?:…][ \t]+|\n\s*)(?=\S)/g;

function segmentStarts(t: string): number[] {
  const out = [0];
  for (const m of t.matchAll(SEGMENT)) out.push(m.index! + m[0].length);
  return out;
}

/**
 * The reply as it is meant for her, when a draft slipped in before it (once in a live check: a greeting with two
 * questions, «Das sind zwei Fragen, also nur eine:», then the greeting again with one). After a sentence about the
 * reply itself only what follows it is kept (without anything after it, only that sentence goes); a greeting that
 * starts the reply again later keeps only the last start. Anything else stays as it is.
 */
export function finalVersion(text: string): string {
  let t = text.trim();
  let starts = segmentStarts(t);
  const metas = starts.map((s, i) => [s, starts[i + 1] ?? t.length] as const).filter(([s]) => META.test(t.slice(s)));
  if (metas.length) {
    const after = t.slice(metas[metas.length - 1][1]).trim();
    if (after) t = after;
    else {
      let kept = t;
      for (const [s, e] of [...metas].reverse()) kept = kept.slice(0, s) + kept.slice(e);
      t = kept.trim();
    }
    starts = segmentStarts(t);
  }
  const first = GREETING.exec(t)?.[0].toLowerCase();
  if (first) {
    const again = starts.filter((s) => s > 0 && GREETING.exec(t.slice(s))?.[0].toLowerCase() === first);
    if (again.length) t = t.slice(again[again.length - 1]).trim();
  }
  return t || text.trim();
}

/**
 * The same guard on the stream she hears: every sentence waits until it is complete (the app speaks whole
 * sentences anyway), and one about the reply itself is never sent. push() returns what can be sent now,
 * flush() the rest at the end. A sentence that runs past 200 characters goes out unchecked.
 */
export function draftStream(): { push(delta: string): string; flush(): string } {
  let held = "";
  let open = false; // the current sentence went out unchecked (too long): the rest of it follows as it comes
  const pass = (seg: string) => (META.test(seg.trimStart()) ? "" : seg);
  return {
    push(delta: string) {
      held += delta;
      let out = "";
      for (;;) {
        SEGMENT.lastIndex = 0;
        const m = SEGMENT.exec(held);
        if (!m) break;
        const end = m.index + m[0].length;
        out += open ? held.slice(0, end) : pass(held.slice(0, end));
        open = false;
        held = held.slice(end);
      }
      if (held.length > 200) {
        out += open ? held : pass(held);
        open = true;
        held = "";
      }
      return out;
    },
    flush() {
      const rest = open ? held : pass(held);
      held = "";
      open = false;
      return rest;
    },
  };
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

/** After a step was marked done: the next open one to propose in the same reply, or what to do when none is left. */
export function nextStepHint(
  milestones: { id: string; title: string; due_date: string | null; done_at: string | null; position: number }[],
): { naechste_etappe?: { id: string; title: string; due_date: string | null }; naechster_schritt: string } {
  const next = [...milestones].sort((a, b) => a.position - b.position).find((m) => !m.done_at);
  if (next)
    return {
      naechste_etappe: { id: next.id, title: next.title, due_date: next.due_date },
      naechster_schritt: "In derselben Antwort die nächste Etappe vorschlagen, mit einem Tag und einer Uhrzeit für den ersten Schritt dazu.",
    };
  return { naechster_schritt: "Keine Etappe mehr offen: eine nächste vorschlagen oder fragen, ob das Ziel erreicht ist." };
}

/** The answers the tool «wochenblick» records. */
export const REVIEW_RESULTS = ["gemacht", "abgelehnt", "will", "will_nicht"] as const;
export type ReviewResult = (typeof REVIEW_RESULTS)[number];

/**
 * What the tool «wochenblick» writes to the profile. `week`: the Monday of the week it is about (reviewWeek),
 * `declines`: the declines in a row so far. Done: this week settled, the count back to 0. Declined: this week
 * settled, one more decline. «will»: she wants it (asked after two declines), the count back to 0, this week
 * still open. «will_nicht»: never offered again.
 */
export function reviewPatch(result: ReviewResult, week: string, declines: number): { review_week?: string; review_declines?: number; review_wanted?: boolean } {
  switch (result) {
    case "gemacht":
      return { review_week: week, review_declines: 0 };
    case "abgelehnt":
      return { review_week: week, review_declines: Math.min(20, Math.max(0, declines) + 1) };
    case "will":
      return { review_wanted: true, review_declines: 0 };
    case "will_nicht":
      return { review_wanted: false, review_week: week };
  }
}

/** What the coach hears back from «wochenblick». */
export const REVIEW_NOTES: Record<ReviewResult, string> = {
  gemacht: "Notiert. Diese Woche kommt kein Wochenblick mehr.",
  abgelehnt: "Notiert. Diese Woche nicht mehr; sprecht über den Tag.",
  will: "Notiert: Sie möchte ihn. Biete ihn an, wenn es jetzt passt.",
  will_nicht: "Notiert: kein Wochenblick mehr, ausser sie fragt selbst danach.",
};
