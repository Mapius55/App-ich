import { useId, useState } from "react";
import { backend } from "../../lib/backend";
import { perWeekLabel } from "../../lib/plan";
import type { Goal, Habit } from "../../lib/types";
import { ConfirmDelete, Sheet } from "./Sheet";

interface Props {
  habit: Habit | null; // null = new habit
  goals: Goal[]; // all goals; the sheet offers those it can serve
  onClose: () => void;
  onChanged: () => void;
}

export function HabitSheet({ habit, goals, onClose, onChanged }: Props) {
  const [title, setTitle] = useState(habit?.title ?? "");
  const [perWeek, setPerWeek] = useState(habit?.per_week ?? 3);
  const [goalId, setGoalId] = useState(habit?.goal_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freqId = useId();
  // dropped goals stay hidden, unless this habit belongs to one (so it can be seen and unlinked)
  const goalOptions = goals.filter((g) => g.status !== "dropped" || g.id === habit?.goal_id);

  const save = async (close: () => void) => {
    const t = title.trim();
    if (!t) {
      setError("Wie heisst die Gewohnheit?");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { title: t, per_week: perWeek, goal_id: goalId || null };
      if (habit) await backend.updateHabit(habit.id, input);
      else await backend.addHabit(input);
      onChanged();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={habit ? "Gewohnheit" : "Neue Gewohnheit"} onClose={onClose}>
      {(close) => (
        <form
          className="sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            save(close);
          }}
          onChange={() => error && setError(null)}
        >
          <label className="sheet-field">
            <span>Was möchtest du regelmässig tun?</span>
            <input
              className="plain-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="z.B. Laufen"
              maxLength={120}
              data-autofocus={habit ? undefined : true}
            />
          </label>

          <div className="sheet-field">
            <span id={freqId}>
              Wie oft pro Woche · <strong>{perWeekLabel(perWeek)}</strong>
            </span>
            <div className="segmented seven" role="radiogroup" aria-labelledby={freqId}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={perWeek === n}
                  aria-label={perWeekLabel(n)}
                  className={perWeek === n ? "on" : ""}
                  onClick={() => setPerWeek(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {goalOptions.length > 0 && (
            <label className="sheet-field">
              <span>Gehört zu Ziel</span>
              <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">Kein Ziel</option>
                {goalOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="sheet-actions">
            {error && (
              <p className="form-error sheet-error" role="alert">
                {error}
              </p>
            )}
            {habit && (
              <ConfirmDelete
                label="Löschen"
                question="Gewohnheit mit allen Häkchen löschen?"
                onConfirm={async () => {
                  try {
                    await backend.deleteHabit(habit.id);
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
              {habit ? "Speichern" : "Hinzufügen"}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
