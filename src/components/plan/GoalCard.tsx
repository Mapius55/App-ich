import { useState } from "react";
import { daysBetween, daysLeftLabel, goalProgress } from "../../lib/plan";
import { shortDay } from "../../lib/dates";
import type { Goal, Milestone } from "../../lib/types";
import { IconCheck, IconEdit, IconPlus } from "./icons";

/** "So, 6. Dez · noch 22 Tage", or null for an open-ended goal */
export function goalMeta(goal: Pick<Goal, "target_date">, today: string): string | null {
  if (!goal.target_date) return null;
  return `${shortDay(goal.target_date)} · ${daysLeftLabel(daysBetween(today, goal.target_date))}`;
}

interface Props {
  goal: Goal;
  today: string;
  index: number;
  onOpen: () => void;
  onToggle: (m: Milestone) => void;
  onAddMilestone: (title: string) => Promise<void>;
}

export function GoalCard({ goal, today, index, onOpen, onToggle, onAddMilestone }: Props) {
  const p = goalProgress(goal, today);
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

      {p.total > 0 && (
        <div className="goal-progress">
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
        </div>
      )}

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
