// Ziele (§3.5): the right side of Jetzt. Goals as typography (no cards), habits with
// their week, reached and dropped goals folded in place. The dock "+" adds a goal.
import { useEffect, useRef, useState } from "react";
import { shortDay } from "../lib/dates";
import { usePlanData } from "../space/data";
import { useSpace } from "../space/state";
import { GoalBlock } from "./GoalBlock";
import { HabitWeekRow } from "./HabitWeekRow";

export interface GoalsPlaceProps {
  titleId: string;
  active: boolean; // Ziele is the settled place
}

/** scroll an item to the middle of its side layer (never the document: that would change the level) */
export function revealInSide(el: Element | null, reduced: boolean): void {
  const side = el?.closest<HTMLElement>(".side");
  if (!el || !side) return;
  const r = el.getBoundingClientRect();
  const s = side.getBoundingClientRect();
  const top = side.scrollTop + (r.top - s.top) - Math.max(0, (side.clientHeight - r.height) / 2);
  side.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
}

export function GoalsPlace({ titleId, active }: GoalsPlaceProps) {
  const { today, highlight, reduced, open, registerAdd } = useSpace();
  const { goals, habits, error, goalTitle } = usePlanData();
  const [showFinished, setShowFinished] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // the dock "+" here: a new goal
  useEffect(() => {
    registerAdd("ziele", () => open({ kind: "goal", goal: null }));
    return () => registerAdd("ziele", null);
  }, [registerAdd, open]);

  const all = goals ?? [];
  // active first, paused after; within each the backend's order (by target date)
  const shown = [...all.filter((g) => g.status === "active"), ...all.filter((g) => g.status === "paused")];
  // reached and dropped goals, folded away but still there to look at, restore or delete
  const finished = [...all.filter((g) => g.status === "done"), ...all.filter((g) => g.status === "dropped")];

  // space.highlight: unfold what hides it, bring it into view (it glows via .is-flash)
  const finishedHit = !!highlight && finished.some((g) => g.id === highlight);
  useEffect(() => {
    if (!highlight) return;
    if (finishedHit) setShowFinished(true);
    const t = requestAnimationFrame(() => revealInSide(rootRef.current?.querySelector(`[data-id="${CSS.escape(highlight)}"]`) ?? null, reduced));
    return () => cancelAnimationFrame(t);
  }, [highlight, finishedHit, reduced, active]);

  return (
    <div ref={rootRef} className="pl" data-active={active || undefined}>
      <h2 id={titleId} className="pl-title" tabIndex={-1}>
        Ziele
      </h2>

      {error && (
        <p className="form-error pl-error" role="alert">
          {error}
        </p>
      )}

      {goals && shown.length === 0 && <p className="pl-empty">Erzähl mir, worauf du hinarbeitest, oder trag dein erstes Ziel selbst ein.</p>}

      <div className="pl-goals">
        {shown.map((g) => (
          <GoalBlock key={g.id} goal={g} today={today} flash={highlight === g.id} />
        ))}
      </div>

      <button type="button" className="pl-quiet pl-add" onClick={(e) => open({ kind: "goal", goal: null }, e.currentTarget)}>
        Ziel hinzufügen
      </button>

      <section className="pl-section" aria-labelledby="pl-habits-label">
        <h3 id="pl-habits-label" className="pl-label">
          Gewohnheiten
        </h3>
        {habits && habits.length === 0 && <p className="pl-hint">Kleine Dinge, die du regelmässig tun möchtest, z.B. dreimal pro Woche laufen.</p>}
        {habits && habits.length > 0 && (
          <ul className="pl-habits">
            {habits.map((h) => (
              <HabitWeekRow key={h.id} habit={h} today={today} goalTitle={goalTitle(h.goal_id)} flash={highlight === h.id} />
            ))}
          </ul>
        )}
        <button type="button" className="pl-quiet pl-add" onClick={(e) => open({ kind: "habit", habit: null }, e.currentTarget)}>
          Gewohnheit hinzufügen
        </button>
      </section>

      {finished.length > 0 && (
        <section className="pl-section pl-finished">
          <button type="button" className="pl-quiet pl-fold" aria-expanded={showFinished} aria-controls="pl-finished-list" onClick={() => setShowFinished((s) => !s)}>
            Abgeschlossen · {finished.length}
            <span className="pl-fold-chev" aria-hidden="true">
              ⌄
            </span>
          </button>
          <div id="pl-finished-list" className="pl-unfold" data-open={showFinished || undefined} inert={!showFinished}>
            <ul className="pl-unfold-inner pl-finished-list">
              {finished.map((g) => (
                <li key={g.id} data-id={g.id} className={`${g.status}${highlight === g.id ? " is-flash" : ""}`}>
                  <button
                    type="button"
                    onClick={(e) => open({ kind: "goal", goal: g }, e.currentTarget)}
                    aria-label={`Ziel ansehen: ${g.title}, ${g.status === "done" ? "erreicht" : "aufgegeben"}`}
                  >
                    <span className="pl-finished-title">{g.title}</span>
                    <span className="pl-finished-meta">
                      <span className="pl-finished-status">{g.status === "done" ? "Erreicht" : "Aufgegeben"}</span>
                      {g.target_date && <span>{shortDay(g.target_date)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
