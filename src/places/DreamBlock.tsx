// Dreams on the Bucket List (§2). An open dream is typography like a goal: its title
// (→ the detail), when it should happen ("Februar 2027") and, with a plan, one quiet
// progress line. A fulfilled dream glows in the colour flow (the circle's palette,
// --orb-*) with its month; tapped, it unfolds in place to its memory.
import { useRef, useState } from "react";
import type { Goal } from "../lib/types";
import { useFresh, useSeenWhenVisible } from "../space/fresh";
import { useSpace } from "../space/state";
import { dreamPlanLine, dreamWhen, fulfilledLabel, tellText } from "./bucket";
import { useWash } from "./fulfilled";
import { useRevealWhenFresh } from "./reveal";

export function DreamBlock({ goal, today, flash, active }: { goal: Goal; today: string; flash: boolean; active: boolean }) {
  const { open, reduced } = useSpace();
  const ref = useRef<HTMLElement>(null);
  const fresh = useFresh(goal.id);
  useSeenWhenVisible(ref, goal.id);
  useRevealWhenFresh(ref, fresh, active, reduced);
  const when = dreamWhen(goal.target_date);
  const paused = goal.status === "paused";
  const plan = dreamPlanLine(goal, today);

  return (
    <article ref={ref} data-id={goal.id} className={`gb bl-dream${paused ? " paused" : ""}${fresh ? " is-fresh" : ""}${flash ? " is-flash" : ""}`}>
      <button type="button" className="gb-title" onClick={() => open({ kind: "goal", goal }, ref.current)} aria-label={`Traum ansehen: ${goal.title}${fresh ? ", neu vom Coach" : ""}`}>
        {goal.title}
        {fresh && (
          <span className="fresh-tag" aria-hidden="true">
            neu
          </span>
        )}
      </button>
      {(when || paused) && (
        <p className="gb-meta">
          {when}
          {when && paused ? " · " : ""}
          {paused ? "pausiert" : ""}
        </p>
      )}
      {plan && <p className="bl-plan">{plan}</p>}
    </article>
  );
}

export function FulfilledDream({ goal, flash, active }: { goal: Goal; flash: boolean; active: boolean }) {
  const { open, reduced, detail, ask } = useSpace();
  const ref = useRef<HTMLLIElement>(null);
  const [unfolded, setUnfolded] = useState(false);
  // a change by the coach (e.g. it just came true) is brought into view; its glow is the wash, not the halo
  const fresh = useFresh(goal.id);
  useSeenWhenVisible(ref, goal.id);
  useRevealWhenFresh(ref, fresh, active, reduced);
  // a dream that just came true washes once in the colour flow, as soon as it is seen
  const washing = useWash(goal, active && !detail, reduced);
  const regionId = `bl-more-${goal.id}`;
  const label = fulfilledLabel(goal);

  return (
    <li ref={ref} data-id={goal.id} className={`bl-done${washing ? " bl-wash" : ""}${flash && !washing ? " is-flash" : ""}`}>
      <button type="button" className="bl-done-head" aria-expanded={unfolded} aria-controls={regionId} onClick={() => setUnfolded((u) => !u)}>
        <span className="bl-done-title">
          <span className="bl-flow">{goal.title}</span>
        </span>
        <span className="bl-done-date">{label}</span>
      </button>
      <div id={regionId} className="pl-unfold" data-open={unfolded || undefined} inert={!unfolded}>
        <div className="pl-unfold-inner bl-done-more">
          {goal.memory ? (
            <p className="bl-memory">{goal.memory}</p>
          ) : (
            <button type="button" className="pl-quiet bl-tell" onClick={() => ask(tellText(goal.title))}>
              Wie war es? Erzähl es mir.
            </button>
          )}
          <button type="button" className="pl-quiet bl-edit" onClick={() => open({ kind: "goal", goal }, ref.current)} aria-label={`Traum bearbeiten: ${goal.title}`}>
            Bearbeiten
          </button>
        </div>
      </div>
    </li>
  );
}
