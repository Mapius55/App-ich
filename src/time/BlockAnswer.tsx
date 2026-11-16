// Under a past block for a goal: without an answer it counts provisionally for a week, then no more.
// „Halbmarathon Zürich · Hat’s geklappt? Ja · Teilweise · Nein“; once answered the line says what
// counts («Teilweise» counts half of it), and tapping the chosen answer again takes it back.
// Where the line is too narrow for all of it, the three answers move under «… · Hat’s geklappt?» as one group.
import { hoursMinutes } from "../lib/dates";
import { blockAnswerState, partialMinutes } from "../lib/plan";

export interface BlockAnswerProps {
  /** the entry's title, for the group's name */
  title: string;
  goal: string;
  /** planned minutes of the block */
  planned: number;
  /** undefined = not answered, 0 = didn't happen, > 0 = minutes that counted (fewer than planned: «Teilweise») */
  value: number | undefined;
  /** done=true with `minutes` for «Teilweise»; null takes the answer back */
  onAnswer(done: boolean | null, minutes?: number): void;
}

export function BlockAnswer({ title, goal, planned, value, onAnswer }: BlockAnswerProps) {
  const state = blockAnswerState(value, planned);
  const lead = state === "nein" ? `Zählt nicht für ${goal}` : state ? `Zählt für ${goal}` : goal;
  // what follows the name never gives way: the question, or the time that counts
  const tail = state === null ? " · Hat’s geklappt?" : state === "nein" ? null : ` · ${hoursMinutes(value || planned)}`;
  const choice = (s: "ja" | "teilweise" | "nein", label: string, answer: () => void) =>
    (state === null || state === s) && (
      <button type="button" className="ba-btn" aria-pressed={state === s} onClick={() => (state === s ? onAnswer(null) : answer())}>
        {label}
      </button>
    );
  const dot = state === null && (
    <span className="ba-dot" aria-hidden="true">
      ·
    </span>
  );
  // only the goal's name gives way (ellipsis); without an answer the three answers move under it as one group
  // when the line is too narrow for both
  return (
    <div className={`ba${state ? ` ${state === "nein" ? "missed" : "done"}` : " ask"}`} role="group" aria-label={`Hat es geklappt? ${title}`}>
      <span className="ba-lead">
        <span className="ba-text">{lead}</span>
        {tail && <span className="ba-ask">{tail}</span>}
      </span>
      <span className="ba-q">
        {choice("ja", "Ja", () => onAnswer(true))}
        {dot}
        {choice("teilweise", "Teilweise", () => onAnswer(true, partialMinutes(planned)))}
        {dot}
        {choice("nein", "Nein", () => onAnswer(false))}
      </span>
    </div>
  );
}
