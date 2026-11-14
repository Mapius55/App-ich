import { useState } from "react";
import { daysBetween, daysLeftLabel, durationLabel, goalEffort, goalProgress, hoursLabel, type GoalEffort } from "../../lib/plan";
import { shortDay } from "../../lib/dates";
import type { Goal, Milestone } from "../../lib/types";
import { IconCheck, IconEdit, IconPlus } from "./icons";

/** "So, 6. Dez · noch 22 Tage", or null for an open-ended goal */
export function goalMeta(goal: Pick<Goal, "target_date">, today: string): string | null {
  if (!goal.target_date) return null;
  return `${shortDay(goal.target_date)} · ${daysLeftLabel(daysBetween(today, goal.target_date))}`;
}

const nb = (s: string) => s.replace(/ /g, "\u00a0"); // keeps "7 Jahre" or "35 Std/Woche" on one line

/** "≈ 120 Std · 34 geschafft · 10 Std/Woche nötig", or null without an estimate */
export function effortLine(e: GoalEffort): string | null {
  if (e.effort === null) return null;
  const parts = [nb(`≈ ${hoursLabel(e.effort)} Std`)];
  if (e.done > 0) parts.push(nb(`${hoursLabel(e.done)} geschafft`));
  if (e.remaining !== 0) {
    if (e.neededPerWeek !== null) parts.push(`${nb(`${hoursLabel(e.neededPerWeek)} Std/Woche`)} nötig`);
    else if (e.weeksToFinish !== null && e.available !== null)
      parts.push(`bei ${nb(`${hoursLabel(e.available)} Std/Woche`)} ${nb(`ca. ${durationLabel(e.weeksToFinish)}`)}`);
  }
  return parts.join(" · ");
}

/** A quiet chip when the time per week is tight or not enough, or a check once the hours are reached. */
function FeasibilityChip({ e }: { e: GoalEffort }) {
  if (e.feasibility === "erreicht")
    return (
      <span className="effort-chip reached">
        <IconCheck size={11} />
        <span aria-hidden="true">erreicht</span>
        <span className="plan-sr">Die geschätzten Stunden sind erreicht.</span>
      </span>
    );
  if (e.feasibility !== "knapp" && e.feasibility !== "kaum machbar") return null;
  const tight = e.feasibility === "knapp";
  const detail = `etwa ${hoursLabel(e.neededPerWeek ?? 0)} Stunden pro Woche nötig, du hast ${hoursLabel(e.available ?? 0)}`;
  return (
    <span className={`effort-chip ${tight ? "tight" : "hard"}`}>
      <span aria-hidden="true">{e.feasibility}</span>
      <span className="plan-sr">{tight ? `Wird knapp: ${detail}.` : `Kaum machbar: ${detail}.`}</span>
    </span>
  );
}

interface Props {
  goal: Goal;
  today: string;
  index: number;
  onOpen: () => void;
  /** open the goal sheet at the effort fields */
  onEstimate: () => void;
  onToggle: (m: Milestone) => void;
  onAddMilestone: (title: string) => Promise<void>;
}

export function GoalCard({ goal, today, index, onOpen, onEstimate, onToggle, onAddMilestone }: Props) {
  const p = goalProgress(goal, today);
  const e = goalEffort(goal, today);
  const line = effortLine(e);
  const meta = goalMeta(goal, today);
  const paused = goal.status === "paused";
  const ms = [...goal.milestones].sort((a, b) => a.position - b.position);

  return (
    <article className={`card-glass goal-card ${paused ? "paused" : ""}`} style={{ animationDelay: `${0.06 * index}s` }}>
      <button type="button" className="goal-head" onClick={onOpen} aria-label={`Ziel bearbeiten: ${goal.title}`}>
        <span className="goal-head-text">
          <span className="goal-title">{goal.title}</span>
          {(meta || paused) && (
            <span className="goal-meta">
              {meta}
              {meta && paused ? " · " : ""}
              {paused ? "pausiert" : ""}
            </span>
          )}
        </span>
        <span className="goal-edit" aria-hidden="true">
          <IconEdit />
        </span>
      </button>

      {goal.why && <p className="goal-why">{goal.why}</p>}

      {/* the numbers: hours (line and a hairline bar) above the steps bar; both bars share one width */}
      <div className={`goal-measure ${p.total > 0 ? "" : "no-steps"}`}>
        {line !== null && e.effort !== null ? (
          <>
            <p className="goal-effort-line">
              <span>{line}</span>
              <FeasibilityChip e={e} />
            </p>
            <div
              className="effort-bar"
              role="progressbar"
              aria-label={`Stunden ${goal.title}`}
              aria-valuemin={0}
              aria-valuemax={e.effort}
              aria-valuenow={Math.min(e.done, e.effort)}
              aria-valuetext={`${hoursLabel(e.done)} von etwa ${hoursLabel(e.effort)} Stunden`}
            >
              <span style={{ transform: `scaleX(${Math.min(1, e.done / e.effort)})` }} />
            </div>
          </>
        ) : (
          <p className="goal-effort-line quiet">
            {e.done > 0 && <span>{hoursLabel(e.done)} Std investiert</span>}
            <button type="button" className="effort-estimate" onClick={onEstimate}>
              Aufwand schätzen
            </button>
          </p>
        )}

        {p.total > 0 && (
          <>
            <div
              className="goal-bar"
              role="progressbar"
              aria-label={`Fortschritt ${goal.title}`}
              aria-valuemin={0}
              aria-valuemax={p.total}
              aria-valuenow={p.done}
              aria-valuetext={`${p.done} von ${p.total} Etappen`}
            >
              <span style={{ transform: `scaleX(${p.ratio})` }} />
            </div>
            <span className="goal-count">
              {p.done} von {p.total}
            </span>
          </>
        )}
      </div>

      {ms.length > 0 && (
        <ul className="milestones">
          {ms.map((m) => {
            const isNext = p.next?.id === m.id;
            return (
              <li key={m.id} className={`milestone ${m.done_at ? "done" : ""} ${isNext ? "next" : ""}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!!m.done_at}
                  className="milestone-check"
                  onClick={() => onToggle(m)}
                  aria-label={`Etappe ${m.title}`}
                >
                  <span className="check-circle">
                    <IconCheck />
                  </span>
                  <span className="milestone-text">
                    <span className="milestone-title">{m.title}</span>
                    {(isNext || (m.due_date && !m.done_at)) && (
                      <span className="milestone-sub">
                        {isNext ? "Als Nächstes" : ""}
                        {isNext && m.due_date ? " · " : ""}
                        {m.due_date && !m.done_at ? `bis ${shortDay(m.due_date)}` : ""}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AddMilestone onAdd={onAddMilestone} first={ms.length === 0} />
    </article>
  );
}

function AddMilestone({ onAdd, first }: { onAdd: (title: string) => Promise<void>; first: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open)
    return (
      <button type="button" className="milestone-add" onClick={() => setOpen(true)}>
        <IconPlus size={16} />
        {first ? "Erste Etappe hinzufügen" : "Etappe hinzufügen"}
      </button>
    );

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onAdd(t);
      setTitle(""); // stay open: several steps are often added in a row
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="milestone-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="plain-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (setOpen(false), setTitle(""))}
        placeholder="Nächster Schritt"
        aria-label="Neue Etappe"
        maxLength={200}
        autoFocus
      />
      <button type="submit" className="dock-main small" disabled={!title.trim() || busy} aria-label="Etappe hinzufügen">
        <IconPlus size={18} />
      </button>
      <button type="button" className="btn quiet" onClick={() => (setOpen(false), setTitle(""))}>
        Fertig
      </button>
    </form>
  );
}
