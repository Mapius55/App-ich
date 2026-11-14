import { useState } from "react";
import { backend } from "../../lib/backend";
import type { Goal, GoalStatus } from "../../lib/types";
import { ConfirmDelete, Sheet } from "./Sheet";
import { IconClose, IconPlus } from "./icons";

export const GOAL_STATUS: { key: GoalStatus; label: string }[] = [
  { key: "active", label: "Aktiv" },
  { key: "paused", label: "Pausiert" },
  { key: "done", label: "Erreicht" },
  { key: "dropped", label: "Aufgegeben" },
];

interface Draft {
  key: string;
  id?: string; // existing milestone
  title: string;
  removed?: boolean;
}

interface Props {
  goal: Goal | null; // null = new goal
  onClose: () => void;
  /** after saving or deleting: reload from the backend */
  onChanged: () => void;
}

export function GoalSheet({ goal, onClose, onChanged }: Props) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [target, setTarget] = useState(goal?.target_date ?? "");
  const [why, setWhy] = useState(goal?.why ?? "");
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? "active");
  const [steps, setSteps] = useState<Draft[]>(() =>
    [...(goal?.milestones ?? [])].sort((a, b) => a.position - b.position).map((m) => ({ key: m.id, id: m.id, title: m.title })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (close: () => void) => {
    const t = title.trim();
    if (!t) {
      setError("Wie heisst dein Ziel?");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { title: t, target_date: target || null, why: why.trim() || null };
      if (!goal) {
        const ms = steps.filter((s) => !s.removed && s.title.trim()).map((s) => ({ title: s.title.trim(), due_date: null }));
        await backend.addGoal(input, ms);
      } else {
        await backend.updateGoal(goal.id, { ...input, status });
        const before = new Map(goal.milestones.map((m) => [m.id, m]));
        for (const s of steps) {
          const t2 = s.title.trim();
          if (s.id && (s.removed || !t2)) await backend.deleteMilestone(s.id);
          else if (s.id && t2 !== before.get(s.id)?.title) await backend.updateMilestone(s.id, { title: t2 });
          else if (!s.id && !s.removed && t2) await backend.addMilestone(goal.id, { title: t2, due_date: null });
        }
      }
      onChanged();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setStep = (key: string, patch: Partial<Draft>) => setSteps((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <Sheet title={goal ? "Ziel" : "Neues Ziel"} onClose={onClose}>
      {(close) => (
        <form
          className="sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            save(close);
          }}
        >
          <label className="sheet-field">
            <span>Worauf arbeitest du hin?</span>
            <input
              className="plain-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="z.B. Halbmarathon"
              maxLength={200}
              data-autofocus={goal ? undefined : true}
            />
          </label>

          <label className="sheet-field">
            <span>Bis wann? (optional)</span>
            <span className="row">
              <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
              {target && (
                <button type="button" className="dock-round small" onClick={() => setTarget("")} aria-label="Datum entfernen">
                  <IconClose />
                </button>
              )}
            </span>
          </label>

          <label className="sheet-field">
            <span>Warum ist es dir wichtig? (optional)</span>
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={1000} />
          </label>

          {goal && (
            <div className="sheet-field">
              <span id="goal-status-label">Status</span>
              <div className="segmented four" role="radiogroup" aria-labelledby="goal-status-label">
                {GOAL_STATUS.map((s) => (
                  <button key={s.key} type="button" role="radio" aria-checked={status === s.key} className={status === s.key ? "on" : ""} onClick={() => setStatus(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sheet-field">
            <span>Etappen</span>
            <ul className="sheet-steps">
              {steps
                .filter((s) => !s.removed)
                .map((s, i) => (
                  <li key={s.key}>
                    <input
                      className="plain-input"
                      value={s.title}
                      onChange={(e) => setStep(s.key, { title: e.target.value })}
                      placeholder={`Etappe ${i + 1}`}
                      aria-label={`Etappe ${i + 1}`}
                      maxLength={200}
                    />
                    <button type="button" className="dock-round small" onClick={() => setStep(s.key, { removed: true })} aria-label={`Etappe ${s.title || i + 1} entfernen`}>
                      <IconClose />
                    </button>
                  </li>
                ))}
            </ul>
            <button type="button" className="milestone-add" onClick={() => setSteps((xs) => [...xs, { key: `new-${Date.now()}`, title: "" }])}>
              <IconPlus size={16} />
              Etappe hinzufügen
            </button>
          </div>

          <div className="sheet-actions">
            {error && (
              <p className="form-error sheet-error" role="alert">
                {error}
              </p>
            )}
            {goal && (
              <ConfirmDelete
                label="Löschen"
                question="Ziel mit allen Etappen löschen?"
                onConfirm={async () => {
                  try {
                    await backend.deleteGoal(goal.id);
                    onChanged();
                    close();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            )}
            <span className="spacer" />
            <button type="submit" className="btn primary" disabled={busy}>
              {goal ? "Speichern" : "Hinzufügen"}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
