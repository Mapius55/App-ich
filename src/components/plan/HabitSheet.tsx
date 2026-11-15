import { useEffect, useId, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { perWeekLabel } from "../../lib/plan";
import type { Goal, Habit } from "../../lib/types";
import { closeDecision } from "../../space/closeDecision";
import { ConfirmDelete as ConfirmInline } from "../../space/ConfirmDelete";
import type { CloseVia } from "../../space/state";
import { Unfold, useUnfold, useUnfoldClose } from "../../space/Unfold";
import { ConfirmDelete, Sheet } from "./Sheet";
import { GoalLinkField } from "./GoalLinkField";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface HabitFormProps {
  habit: Habit | null; // null = new habit
  goals: Goal[]; // all goals; the form offers those it can serve
  /** "sheet": the old bottom sheet (flag off); "detail": inside an Unfold */
  variant: "sheet" | "detail";
  /** sheet only: closes the sheet */
  close?: () => void;
  /** after saving or deleting (with the stored habit when saved) */
  onChanged: (saved?: Habit) => void;
  /** detail: whether there are local edits (a coach update then waits) */
  onDirty?: (dirty: boolean) => void;
  /** detail: the habit no longer exists (deleted elsewhere): closing never saves */
  gone?: boolean;
}

/** The habit form body: shared by the old sheet and the Unfold detail. */
export function HabitForm({ habit, goals, variant, close, onChanged, onDirty, gone }: HabitFormProps) {
  const detail = variant === "detail";
  const unfold = useUnfold();
  const [title, setTitle] = useState(habit?.title ?? "");
  const [perWeek, setPerWeek] = useState(habit?.per_week ?? 3);
  const [goalId, setGoalId] = useState(habit?.goal_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const freqId = useId();

  // detail: the values as loaded, to tell local edits apart
  const values = JSON.stringify([title, perWeek, goalId]);
  const loaded = useRef(values);
  const dirty = values !== loaded.current;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const release = useRef(false); // saved, discarded or deleted: closing needs nothing more
  const askRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) askRef.current?.focus({ preventScroll: true });
  }, [asking]);

  const problem = () => (title.trim() ? null : "Wie heisst die Gewohnheit?");
  const store = () => {
    const input = { title: title.trim(), per_week: perWeek, goal_id: goalId || null };
    return habit ? backend.updateHabit(habit.id, input) : backend.addHabit(input);
  };

  // the old sheet: save, then close
  const save = async (closeSheet: () => void) => {
    const p = problem();
    if (p) {
      setError(p);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await store();
      onChanged();
      closeSheet();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  // the detail: store it; false keeps the panel open with the error
  const commit = async (): Promise<boolean> => {
    const p = problem();
    if (p) {
      setError(p);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await store();
      release.current = true;
      onChanged(saved);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // every close path of the Unfold asks here first (D6)
  useUnfoldClose(async (via: CloseVia) => {
    if (gone || release.current) return true;
    if (busy) return false;
    const p = problem();
    const action = closeDecision({ isNew: !habit, dirty, valid: !p, titled: !!title.trim() }, via);
    if (action === "close") return true;
    if (action === "ask") {
      setAsking(true);
      return false;
    }
    if (action === "stay") {
      setError(p);
      return false;
    }
    return commit();
  });

  const add = async () => {
    if (await commit()) unfold?.requestClose("done");
  };

  const titleInput = (
    <input
      className={detail ? "uf-title" : "plain-input"}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder="z.B. Laufen"
      maxLength={120}
      aria-label={detail ? "Was möchtest du regelmässig tun?" : undefined}
      enterKeyHint={detail ? "done" : undefined}
      data-autofocus={habit ? undefined : true}
    />
  );

  const fields = (
    <>
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

      <GoalLinkField goals={goals} current={habit?.goal_id} value={goalId} onChange={setGoalId} />
    </>
  );

  if (!detail)
    return (
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(close ?? (() => {}));
        }}
        onChange={() => error && setError(null)}
      >
        <label className="sheet-field">
          <span>Was möchtest du regelmässig tun?</span>
          {titleInput}
        </label>

        {fields}

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
                  close?.();
                } catch (e) {
                  setError(message(e));
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
    );

  return (
    <form
      className="uf-form"
      onSubmit={(e) => {
        e.preventDefault();
        unfold?.requestClose("done");
      }}
      onChange={() => {
        if (error) setError(null);
        if (asking) setAsking(false);
      }}
      noValidate
    >
      <div className="uf-titlebox" data-unfold-head="">
        {titleInput}
      </div>
      <div className="unfold-body sheet-form">
        {fields}
        <div className="uf-actions">
          {error && (
            <p className="form-error uf-error" role="alert">
              {error}
            </p>
          )}
          {asking ? (
            <div className="uf-ask" role="alert">
              <span>Noch nicht eingetragen.</span>
              <span className="row">
                <button
                  type="button"
                  className="btn quiet"
                  onClick={() => {
                    release.current = true;
                    unfold?.requestClose("done");
                  }}
                >
                  Verwerfen
                </button>
                <button ref={askRef} type="button" className="btn primary" disabled={busy} onClick={add}>
                  Hinzufügen
                </button>
              </span>
            </div>
          ) : (
            <>
              {habit && (
                <ConfirmInline
                  label="Löschen"
                  question="Gewohnheit mit allen Häkchen löschen?"
                  onConfirm={async () => {
                    try {
                      await backend.deleteHabit(habit.id);
                      release.current = true;
                      onChanged();
                      unfold?.requestClose("done");
                    } catch (e) {
                      setError(message(e));
                    }
                  }}
                />
              )}
              <span className="spacer" />
              {!habit && (
                <button type="button" className="btn primary" disabled={busy} onClick={add}>
                  Hinzufügen
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </form>
  );
}

interface Props {
  habit: Habit | null; // null = new habit
  goals: Goal[]; // all goals; the sheet offers those it can serve
  onClose: () => void;
  onChanged: () => void;
}

/** the old bottom sheet (flag off) */
export function HabitSheet({ habit, goals, onClose, onChanged }: Props) {
  return (
    <Sheet title={habit ? "Gewohnheit" : "Neue Gewohnheit"} onClose={onClose}>
      {(close) => <HabitForm habit={habit} goals={goals} variant="sheet" close={close} onChanged={() => onChanged()} />}
    </Sheet>
  );
}

export interface HabitDetailProps {
  habit: Habit | null;
  goals: Goal[];
  origin: HTMLElement | null;
  onRequestClose(via: CloseVia): Promise<boolean>;
  onChanged: (saved?: Habit) => void;
  onDirty?: (dirty: boolean) => void;
  gone?: boolean;
  /** remounts the form with fresh values (a coach update while there are no local edits) */
  version?: string;
}

/** the habit as an Unfold (flag on) */
export function HabitDetail({ habit, goals, origin, onRequestClose, onChanged, onDirty, gone, version }: HabitDetailProps) {
  return (
    <Unfold kindLabel={habit ? "Gewohnheit" : "Neue Gewohnheit"} origin={origin} onRequestClose={onRequestClose}>
      <HabitForm key={version} habit={habit} goals={goals} variant="detail" onChanged={onChanged} onDirty={onDirty} gone={gone} />
    </Unfold>
  );
}
