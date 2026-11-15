// An entry the trainer planned in Nolio: read-only (title, time, place, notes as text, no delete).
// Only the reminder is the person's; it is saved when the panel closes (Unfold) or with "Speichern"
// (the old sheet). The database refuses any other change to these rows anyway.
import { useContext, useEffect, useId, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { dayOf } from "../../lib/plan";
import { longDay, timeHM } from "../../lib/dates";
import type { CalendarEvent, Goal } from "../../lib/types";
import { reminderLabel } from "../../components/plan/EventSheet";
import { SpaceContext, type CloseVia } from "../../space/state";
import { useUnfold, useUnfoldClose } from "../../space/Unfold";
import "./conn.css";

const TIMED = [null, 0, 10, 30, 60, 1440];
const ALL_DAY = [null, -480, 360];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Dienstag, 17. November, 18:00–19:00" / "Dienstag, 17. November, ganztägig" */
export function nolioWhen(e: Pick<CalendarEvent, "starts_at" | "ends_at" | "all_day">): string {
  const day = longDay(dayOf(new Date(e.starts_at)));
  if (e.all_day) return `${day}, ganztägig`;
  return `${day}, ${timeHM(e.starts_at)}${e.ends_at ? `–${timeHM(e.ends_at)}` : ""}`;
}

export function NolioEventForm({
  event,
  goals,
  variant,
  close,
  onChanged,
  onDirty,
  gone,
}: {
  event: CalendarEvent;
  goals: Goal[];
  variant: "sheet" | "detail";
  close?: () => void;
  onChanged: (day?: string, saved?: CalendarEvent) => void;
  onDirty?: (dirty: boolean) => void;
  gone?: boolean;
}) {
  const detail = variant === "detail";
  const space = useContext(SpaceContext);
  const unfold = useUnfold();
  const [reminder, setReminder] = useState<number | null>(event.reminder_minutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(false);
  const reminderId = useId();
  const dirty = reminder !== event.reminder_minutes;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  const options = [...(event.all_day ? ALL_DAY : TIMED)];
  if (!options.includes(reminder)) options.push(reminder);
  const goal = event.goal_id ? goals.find((g) => g.id === event.goal_id) : undefined;
  const day = dayOf(new Date(event.starts_at));

  const commit = async (): Promise<boolean> => {
    if (!dirty || saved.current) return true;
    setBusy(true);
    setError(null);
    try {
      const out = await backend.updateEvent(event.id, { reminder_minutes: reminder });
      saved.current = true;
      onChanged(day, out);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // closing saves the reminder (if it changed); nothing else can change here
  useUnfoldClose(async (_via: CloseVia) => {
    if (gone) return true;
    if (busy) return false;
    return commit();
  });

  const body = (
    <>
      <p className="nolio-from">Geplant von deinem Trainer in Nolio.</p>
      <dl className="nolio-facts">
        <div>
          <dt>Wann</dt>
          <dd>{nolioWhen(event)}</dd>
        </div>
        {event.location && (
          <div>
            <dt>Ort</dt>
            <dd>{event.location}</dd>
          </div>
        )}
        {goal && (
          <div>
            <dt>Zählt für</dt>
            <dd>{goal.title}</dd>
          </div>
        )}
        {event.notes && (
          <div>
            <dt>Notizen</dt>
            <dd>{event.notes}</dd>
          </div>
        )}
      </dl>
      {detail && space && goal && (
        <button type="button" className="uf-link" onClick={() => space.go("ziele", { highlight: goal.id })}>
          Ziel ansehen
        </button>
      )}
      <label className="sheet-field">
        <span id={reminderId}>Erinnerung</span>
        <select
          value={reminder === null ? "none" : String(reminder)}
          aria-labelledby={reminderId}
          onChange={(e) => {
            setError(null);
            setReminder(e.target.value === "none" ? null : Number(e.target.value));
          }}
        >
          {options.map((v) => (
            <option key={String(v)} value={v === null ? "none" : String(v)}>
              {reminderLabel(v, event.all_day)}
            </option>
          ))}
        </select>
      </label>
      <p className="sheet-hint">Ändern kann es nur dein Trainer, in Nolio.</p>
      {error && (
        <p className={`form-error ${detail ? "uf-error" : "sheet-error"}`} role="alert">
          {error}
        </p>
      )}
    </>
  );

  if (!detail)
    return (
      <form
        className="sheet-form nolio-entry"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await commit()) close?.();
        }}
      >
        <p className="nolio-title">{event.title}</p>
        {body}
        <div className="sheet-actions">
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={busy}>
            {dirty ? "Speichern" : "Schliessen"}
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
    >
      <div className="uf-titlebox" data-unfold-head="">
        <h3 className="nolio-title">
          {event.title}
        </h3>
      </div>
      <div className="unfold-body sheet-form nolio-entry">{body}</div>
    </form>
  );
}
