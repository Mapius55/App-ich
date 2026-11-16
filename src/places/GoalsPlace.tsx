// The Bucket List (§2 Bucket List round; was "Ziele", §3.5): the right side of Jetzt.
// On top the life dreams: open ones, then the fulfilled ones glowing in the colour
// flow (a memory, never struck through). Below the concrete goals (as GoalBlock),
// the habits, and the fold «Abgeschlossen» (reached and dropped goals, dropped
// dreams). The dock "+" here adds a dream.
import { useEffect, useRef, useState } from "react";
import { shortDay } from "../lib/dates";
import { usePlanData } from "../space/data";
import { useSpace } from "../space/state";
import { bucketParts, isDream } from "./bucket";
import { DreamBlock, FulfilledDream } from "./DreamBlock";
import { GoalBlock } from "./GoalBlock";
import { revealInSide } from "./reveal";
import { HabitWeekRow } from "./HabitWeekRow";

export interface GoalsPlaceProps {
  titleId: string;
  active: boolean; // the Bucket List is the settled place
}

export function GoalsPlace({ titleId, active }: GoalsPlaceProps) {
  const { today, highlight, reduced, open, registerAdd } = useSpace();
  const { goals, habits, error, goalTitle } = usePlanData();
  const [showFinished, setShowFinished] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // the dock "+" here: a new dream
  useEffect(() => {
    registerAdd("ziele", () => open({ kind: "goal", goal: null, dream: true }));
    return () => registerAdd("ziele", null);
  }, [registerAdd, open]);

  const parts = bucketParts(goals ?? []);
  const { finished } = parts;
  const noDreams = parts.open.length === 0 && parts.fulfilled.length === 0;

  // space.highlight: unfold what hides it, bring it into view (it glows via .is-flash)
  const finishedHit = !!highlight && finished.some((g) => g.id === highlight);
  useEffect(() => {
    if (!highlight) return;
    if (finishedHit) setShowFinished(true);
    const t = requestAnimationFrame(() => revealInSide(rootRef.current?.querySelector(`[data-id="${CSS.escape(highlight)}"]`) ?? null, reduced));
    return () => cancelAnimationFrame(t);
  }, [highlight, finishedHit, reduced, active]);

  return (
    <div ref={rootRef} className="pl bl" data-active={active || undefined}>
      <h2 id={titleId} className="pl-title" tabIndex={-1}>
        Bucket List
      </h2>

      {error && (
        <p className="form-error pl-error" role="alert">
          {error}
        </p>
      )}

      {goals && noDreams && <p className="pl-empty">Was möchtest du in deinem Leben noch erleben? Erzähl es mir, oder schreib den ersten Traum auf.</p>}

      {parts.open.length > 0 && (
        <div className="pl-goals bl-dreams">
          {parts.open.map((g) => (
            <DreamBlock key={g.id} goal={g} today={today} flash={highlight === g.id} active={active} />
          ))}
        </div>
      )}

      {parts.fulfilled.length > 0 && (
        <ul className="bl-fulfilled" aria-label="Erfüllte Träume">
          {parts.fulfilled.map((g) => (
            <FulfilledDream key={g.id} goal={g} flash={highlight === g.id} active={active} />
          ))}
        </ul>
      )}

      <button type="button" className="pl-quiet pl-add bl-add" onClick={(e) => open({ kind: "goal", goal: null, dream: true }, e.currentTarget)}>
        Auf die Bucket List
      </button>

      <section className="pl-section bl-goals" aria-labelledby="pl-goals-label">
        <h3 id="pl-goals-label" className="pl-label">
          Ziele
        </h3>
        {goals && parts.goals.length === 0 && <p className="pl-hint bl-hint">Training, Prüfung, Projekt: worauf du gerade hinarbeitest.</p>}
        {parts.goals.length > 0 && (
          <div className="pl-goals">
            {parts.goals.map((g) => (
              <GoalBlock key={g.id} goal={g} today={today} flash={highlight === g.id} active={active} />
            ))}
          </div>
        )}
        <button type="button" className="pl-quiet pl-add" onClick={(e) => open({ kind: "goal", goal: null }, e.currentTarget)}>
          Ziel hinzufügen
        </button>
      </section>

      <section className="pl-section" aria-labelledby="pl-habits-label">
        <h3 id="pl-habits-label" className="pl-label">
          Gewohnheiten
        </h3>
        {habits && habits.length === 0 && <p className="pl-hint">Kleine Dinge, die du regelmässig tun möchtest, z.B. dreimal pro Woche laufen.</p>}
        {habits && habits.length > 0 && (
          <ul className="pl-habits">
            {habits.map((h) => (
              <HabitWeekRow key={h.id} habit={h} today={today} goalTitle={goalTitle(h.goal_id)} flash={highlight === h.id} active={active} />
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
              {finished.map((g) => {
                const dream = isDream(g);
                const status = g.status === "done" ? "Erreicht" : dream ? "Losgelassen" : "Aufgegeben";
                return (
                  <li key={g.id} data-id={g.id} className={`${g.status}${highlight === g.id ? " is-flash" : ""}`}>
                    <button type="button" onClick={(e) => open({ kind: "goal", goal: g }, e.currentTarget)} aria-label={`${dream ? "Traum" : "Ziel"} ansehen: ${g.title}, ${status.toLowerCase()}`}>
                      <span className="pl-finished-title">{g.title}</span>
                      <span className="pl-finished-meta">
                        <span className="pl-finished-status">{status}</span>
                        {g.target_date && <span>{shortDay(g.target_date)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
