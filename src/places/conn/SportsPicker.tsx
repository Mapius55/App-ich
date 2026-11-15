// "Welche Trainings zählen?" (a goal in Ziele): which Nolio sports count toward this goal. Saves
// goals.sports; the Nolio sync maps the trainer's sessions and the completed trainings with it.
// Shown only where Nolio is available: without it nothing would read the choice.
import { useEffect, useId, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { SPORT_GROUPS, sportGroupsOn, toggleSportGroup } from "../../lib/connections";
import type { Goal } from "../../lib/types";
import { planData } from "../../space/data";
import "./conn.css";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SportsPicker({ goal }: { goal: Pick<Goal, "id" | "title" | "sports"> }) {
  const [open, setOpen] = useState(false);
  const [sports, setSports] = useState<string[] | null>(goal.sports ?? null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const regionId = useId();

  // a change from elsewhere (the coach, another device) shows once nothing of ours is in flight
  const remote = JSON.stringify(goal.sports ?? null);
  useEffect(() => {
    if (pending.current === 0) setSports(goal.sports ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  const on = sportGroupsOn(sports);
  const chosen = SPORT_GROUPS.filter((g) => on.has(g.key)).map((g) => g.label);

  const toggle = (key: string) => {
    const next = toggleSportGroup(sports, key, !on.has(key));
    setSports(next); // at once; saves run one after the other
    setError(null);
    pending.current++;
    saving.current = saving.current
      .then(() => backend.updateGoal(goal.id, { sports: next }))
      .then(
        () => planData.bumpPlan(),
        (e) => {
          setError(message(e));
          setSports(goal.sports ?? null);
        },
      )
      .finally(() => pending.current--);
  };

  return (
    <div className="sp">
      <button type="button" className="pl-quiet sp-toggle" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((o) => !o)}>
        {chosen.length ? `Zählt: ${chosen.join(", ")}` : "Welche Trainings zählen?"}
      </button>
      <div id={regionId} className="pl-unfold" data-open={open || undefined} inert={!open}>
        <div className="pl-unfold-inner sp-pick">
          <p className="sp-hint">Trainings aus Nolio in diesen Sportarten zählen für „{goal.title}“.</p>
          <div className="sp-chips" role="group" aria-label="Sportarten">
            {SPORT_GROUPS.map((g) => (
              <button key={g.key} type="button" className="sp-chip" aria-pressed={on.has(g.key)} onClick={() => toggle(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
          {error && (
            <p className="form-error pl-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
