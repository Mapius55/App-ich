// Under a past block for a goal: it counts as planned unless she says it didn't happen.
// „Halbmarathon Zürich · Hat’s geklappt? Ja · Nein“; once answered the line says what
// counts, and tapping the chosen answer again takes it back.
import { hoursMinutes } from "../lib/dates";

export interface BlockAnswerProps {
  /** the entry's title, for the group's name */
  title: string;
  goal: string;
  /** planned minutes of the block */
  planned: number;
  /** undefined = not answered, 0 = didn't happen, > 0 = minutes that counted */
  value: number | undefined;
  onAnswer(done: boolean | null): void;
}

export function BlockAnswer({ title, goal, planned, value, onAnswer }: BlockAnswerProps) {
  const state = value === undefined ? null : value > 0 ? "done" : "missed";
  const text = state === "done" ? `Zählt für ${goal} · ${hoursMinutes(value || planned)}` : state === "missed" ? `Zählt nicht für ${goal}` : `${goal} · Hat’s geklappt?`;
  return (
    <div className={`ba${state ? ` ${state}` : ""}`} role="group" aria-label={`Hat es geklappt? ${title}`}>
      <span className="ba-text">{text}</span>
      {state !== "missed" && (
        <button type="button" className="ba-btn" aria-pressed={state === "done"} onClick={() => onAnswer(state === "done" ? null : true)}>
          Ja
        </button>
      )}
      {state === null && (
        <span className="ba-dot" aria-hidden="true">
          ·
        </span>
      )}
      {state !== "done" && (
        <button type="button" className="ba-btn" aria-pressed={state === "missed"} onClick={() => onAnswer(state === "missed" ? null : false)}>
          Nein
        </button>
      )}
    </div>
  );
}
