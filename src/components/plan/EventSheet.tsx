import { useContext, useEffect, useId, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { addDays, dayOf, daysBetween } from "../../lib/plan";
import { localMidnightIso, shortDay, timeHM } from "../../lib/dates";
import type { CalendarEvent, EventInput, Goal } from "../../lib/types";
import { closeDecision } from "../../space/closeDecision";
import { ConfirmDelete as ConfirmInline } from "../../space/ConfirmDelete";
import { SpaceContext, type CloseVia } from "../../space/state";
import { Unfold, useUnfold, useUnfoldClose } from "../../space/Unfold";
import { ConfirmDelete, Sheet } from "./Sheet";

// Reminders are minutes before the start. For all-day entries they count back
// from midnight, and negative values mean after midnight: -480 = 08:00 that
// day (see ics.ts). The coach may store any value, so an unknown one is kept
// and shown as it is.
const TIMED = [null, 0, 10, 30, 60, 1440];
const ALL_DAY = [null, -480, 360];

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function reminderLabel(v: number | null, allDay: boolean): string {
  if (v === null) return "Keine";
  if (allDay) {
    if (v < 0) return `Am Tag um ${hm(Math.min(-v, 1439))}`;
    if (v === 0) return "Um Mitternacht";
    if (v < 1440) return `Am Vortag um ${hm(1440 - v)}`;
    const days = Math.round(v / 1440);
    return days === 1 ? "1 Tag vorher" : `${days} Tage vorher`;
  }
  if (v === 0) return "Beim Start";
  if (v % 1440 === 0) return v === 1440 ? "1 Tag vorher" : `${v / 1440} Tage vorher`;
  if (v % 60 === 0) return `${v / 60} Std vorher`;
  return `${v} Min vorher`;
}

const defaultReminder = (allDay: boolean, kind: CalendarEvent["kind"]) => (allDay ? -480 : kind === "block" ? 10 : 30);

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** a sensible start for a new entry: the next full hour today, else 09:00 */
function defaultStart(day: string): string {
  if (day !== dayOf()) return "09:00";
  const h = new Date().getHours() + 1;
  return hm(Math.min(h, 22) * 60);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface EventFormProps {
  event: CalendarEvent | null; // null = new entry
  day: string; // the day a new entry goes on
  /** "HH:MM": the start of a new entry (a free gap on Tag) */
  time?: string;
  goals: Goal[];
  /** "sheet": the old bottom sheet (flag off); "detail": inside an Unfold */
  variant: "sheet" | "detail";
  /** sheet only: closes the sheet */
  close?: () => void;
  /** after a change; with the entry's day (and the stored entry) when it was saved */
  onChanged: (day?: string, saved?: CalendarEvent) => void;
  /** detail: whether there are local edits (a coach update then waits) */
  onDirty?: (dirty: boolean) => void;
  /** detail: the entry no longer exists (deleted elsewhere): closing never saves */
  gone?: boolean;
}

/** The entry form body: shared by the old sheet and the Unfold detail. */
export function EventForm({ event, day, time, goals, variant, close, onChanged, onDirty, gone }: EventFormProps) {
  const detail = variant === "detail";
  const space = useContext(SpaceContext);
  const unfold = useUnfold();
  const startDay = event ? dayOf(new Date(event.starts_at)) : day;
  const initialStart = event && !event.all_day ? timeHM(event.starts_at) : (time ?? defaultStart(day));
  const endDays = event?.ends_at ? Math.max(0, daysBetween(startDay, dayOf(new Date(event.ends_at)))) : 0;
  // a multi-day all-day entry keeps its length when it moves
  const allDayLength = event?.all_day ? endDays : 0;
  // a timed entry of 24 hours or more is a real multi-day one: its end day stays as it is
  const multiDay = !!event && !event.all_day && !!event.ends_at && Date.parse(event.ends_at) - Date.parse(event.starts_at) >= 86400000;

  const [title, setTitle] = useState(event?.title ?? "");
  const [kind, setKind] = useState<CalendarEvent["kind"]>(event?.kind ?? "termin");
  const [date, setDate] = useState(startDay);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(() => {
    if (event) return event.ends_at && !event.all_day ? timeHM(event.ends_at) : "";
    return hm(Math.min(toMin(initialStart) + 60, 23 * 60 + 59));
  });
  // days from the start day to the end day of a timed entry (1 = ends after midnight)
  const [endOffset, setEndOffset] = useState(event && !event.all_day ? endDays : 0);
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [reminder, setReminder] = useState<number | null>(event ? event.reminder_minutes : defaultReminder(false, "termin"));
  const [reminderTouched, setReminderTouched] = useState(!!event);
  const [goalId, setGoalId] = useState(event?.goal_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const ids = { kind: useId(), allDay: useId(), endHint: useId() };

  // detail: the values as loaded, to tell local edits apart
  const values = JSON.stringify([title, kind, date, allDay, start, end, endOffset, location, notes, reminder, goalId]);
  const loaded = useRef(values);
  const dirty = values !== loaded.current;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const release = useRef(false); // saved, discarded or deleted: closing needs nothing more
  const askRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) askRef.current?.focus({ preventScroll: true });
  }, [asking]);

  const options = [...(allDay ? ALL_DAY : TIMED)];
  if (!options.includes(reminder)) options.push(reminder);

  // dropped goals stay hidden, unless this entry belongs to one (so it can be seen and unlinked)
  const goalOptions = goals.filter((g) => g.status !== "dropped" || g.id === event?.goal_id);

  // "Bis" at or before "Von" means after midnight, not an error
  const offset = end && start && endOffset === 0 && toMin(end) <= toMin(start) ? 1 : endOffset;
  const endHint = allDay || !end ? null : offset === 1 ? "endet am nächsten Tag" : offset > 1 ? `endet am ${shortDay(addDays(date, offset))}` : null;

  const changeStart = (v: string) => {
    // keep the duration, like a paper calendar: moving the start moves the end (across midnight too)
    if (end && start && v) {
      const duration = Math.max(offset * 1440 + toMin(end) - toMin(start), 0);
      const at = toMin(v) + duration;
      setEnd(hm(at % 1440));
      setEndOffset(Math.floor(at / 1440));
    }
    setStart(v);
  };

  const changeEnd = (v: string) => {
    setEnd(v);
    if (!v || multiDay) return;
    setEndOffset(start && toMin(v) <= toMin(start) ? 1 : 0);
  };

  const toggleAllDay = (v: boolean) => {
    setAllDay(v);
    // the meaning of the minutes changes with it, so fall back to the default
    if (reminder !== null) setReminder(defaultReminder(v, kind));
  };

  const changeKind = (k: CalendarEvent["kind"]) => {
    setKind(k);
    if (!reminderTouched) setReminder(defaultReminder(allDay, k));
  };

  /** the entry as it would be stored, or what is missing */
  const build = (): { error: string } | { input: EventInput } => {
    const t = title.trim();
    if (!t) return { error: "Wie heisst der Eintrag?" };
    if (!date) return { error: "An welchem Tag?" };
    let starts_at: string;
    let ends_at: string | null = null;
    if (allDay) {
      starts_at = localMidnightIso(date);
      if (allDayLength > 0) ends_at = localMidnightIso(addDays(date, allDayLength));
    } else {
      if (!start) return { error: "Wann beginnt es?" };
      starts_at = new Date(`${date}T${start}`).toISOString();
      if (end) {
        ends_at = new Date(`${addDays(date, offset)}T${end}`).toISOString();
        if (ends_at <= starts_at) return { error: "Das Ende muss nach dem Anfang liegen." };
      }
    }
    return {
      input: {
        title: t,
        starts_at,
        ends_at,
        all_day: allDay,
        location: location.trim() || null,
        notes: notes.trim() || null,
        reminder_minutes: reminder,
        kind,
        goal_id: goalId || null,
      },
    };
  };

  // the old sheet: save, then close
  const save = async (closeSheet: () => void) => {
    const b = build();
    if ("error" in b) return setError(b.error);
    setBusy(true);
    setError(null);
    try {
      if (event) await backend.updateEvent(event.id, b.input);
      else await backend.addEvent(b.input);
      onChanged(date);
      closeSheet();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  // the detail: store it; false keeps the panel open with the error
  const commit = async (): Promise<boolean> => {
    const b = build();
    if ("error" in b) {
      setError(b.error);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = event ? await backend.updateEvent(event.id, b.input) : await backend.addEvent(b.input);
      release.current = true;
      onChanged(date, saved);
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
    const b = build();
    const action = closeDecision({ isNew: !event, dirty, valid: !("error" in b), titled: !!title.trim() }, via);
    if (action === "close") return true;
    if (action === "ask") {
      setAsking(true);
      return false;
    }
    if (action === "stay") {
      setError("error" in b ? b.error : null);
      return false;
    }
    return commit();
  });

  const enter = async () => {
    if (await commit()) unfold?.requestClose("done");
  };

  const titleInput = (
    <input
      className={detail ? "uf-title" : "plain-input"}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder={kind === "block" ? "z.B. Fokuszeit" : "z.B. Zahnarzt"}
      maxLength={200}
      aria-label={detail ? "Was?" : undefined}
      enterKeyHint={detail ? "done" : undefined}
      data-autofocus={event ? undefined : true}
    />
  );

  const fields = (
    <>
      <div className="sheet-field">
        <span id={ids.kind}>Art</span>
        <div className="segmented" role="radiogroup" aria-labelledby={ids.kind}>
          <button type="button" role="radio" aria-checked={kind === "termin"} className={kind === "termin" ? "on" : ""} onClick={() => changeKind("termin")}>
            Termin
          </button>
          <button type="button" role="radio" aria-checked={kind === "block"} className={kind === "block" ? "on" : ""} onClick={() => changeKind("block")}>
            Block
          </button>
        </div>
        <span className="sheet-hint">{kind === "block" ? "Zeit, die du dir für etwas nimmst, z.B. ein Training." : "Ein Termin, den du hast."}</span>
      </div>

      <label className="sheet-field">
        <span>Tag</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>

      <label className="toggle-row sheet-toggle">
        <span id={ids.allDay}>Ganztägig</span>
        <input type="checkbox" className="switch" role="switch" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} aria-labelledby={ids.allDay} />
      </label>

      {!allDay && (
        <div className="sheet-times">
          <label className="sheet-field">
            <span>Von</span>
            <input type="time" value={start} onChange={(e) => changeStart(e.target.value)} required />
          </label>
          <label className="sheet-field">
            <span>Bis</span>
            <input type="time" value={end} onChange={(e) => changeEnd(e.target.value)} aria-describedby={endHint ? ids.endHint : undefined} />
          </label>
          {endHint && (
            <span id={ids.endHint} className="sheet-hint sheet-times-hint">
              {endHint}
            </span>
          )}
        </div>
      )}

      <label className="sheet-field">
        <span>Ort (optional)</span>
        <input className="plain-input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
      </label>

      <label className="sheet-field">
        <span>Erinnerung</span>
        <select
          value={reminder === null ? "none" : String(reminder)}
          onChange={(e) => {
            setReminderTouched(true);
            setReminder(e.target.value === "none" ? null : Number(e.target.value));
          }}
        >
          {options.map((v) => (
            <option key={String(v)} value={v === null ? "none" : String(v)}>
              {reminderLabel(v, allDay)}
            </option>
          ))}
        </select>
      </label>

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
      {detail && space && goalId && goals.some((g) => g.id === goalId) && (
        <button type="button" className="uf-link" onClick={() => space.go("ziele", { highlight: goalId })}>
          Ziel ansehen
        </button>
      )}

      <label className="sheet-field">
        <span>Notizen (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
      </label>

      {event?.source === "coach" && <p className="sheet-hint">Vom Coach eingetragen.</p>}
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
        noValidate
      >
        <label className="sheet-field">
          <span>Was?</span>
          {titleInput}
        </label>

        {fields}

        <div className="sheet-actions">
          {error && (
            <p className="form-error sheet-error" role="alert">
              {error}
            </p>
          )}
          {event && (
            <ConfirmDelete
              label="Löschen"
              question="Eintrag löschen?"
              onConfirm={async () => {
                try {
                  await backend.deleteEvent(event.id);
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
            {event ? "Speichern" : "Eintragen"}
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
                <button ref={askRef} type="button" className="btn primary" disabled={busy} onClick={enter}>
                  Eintragen
                </button>
              </span>
            </div>
          ) : (
            <>
              {event && (
                <ConfirmInline
                  label="Löschen"
                  question="Wirklich löschen?"
                  onConfirm={async () => {
                    try {
                      await backend.deleteEvent(event.id);
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
              {!event && (
                <button type="button" className="btn primary" disabled={busy} onClick={enter}>
                  Eintragen
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
  event: CalendarEvent | null; // null = new entry
  day: string; // the day a new entry goes on
  goals: Goal[];
  onClose: () => void;
  /** after a change; with the entry's day when it was saved */
  onChanged: (day?: string) => void;
}

/** the old bottom sheet (flag off) */
export function EventSheet({ event, day, goals, onClose, onChanged }: Props) {
  return (
    <Sheet title={event ? "Eintrag" : "Neuer Eintrag"} onClose={onClose}>
      {(close) => <EventForm event={event} day={day} goals={goals} variant="sheet" close={close} onChanged={onChanged} />}
    </Sheet>
  );
}

export interface EventDetailProps {
  event: CalendarEvent | null;
  day: string;
  time?: string;
  goals: Goal[];
  origin: HTMLElement | null;
  onRequestClose(via: CloseVia): Promise<boolean>;
  onChanged: (day?: string, saved?: CalendarEvent) => void;
  onDirty?: (dirty: boolean) => void;
  gone?: boolean;
  /** remounts the form with fresh values (a coach update while there are no local edits) */
  version?: string;
}

/** the entry as an Unfold (flag on) */
export function EventDetail({ event, day, time, goals, origin, onRequestClose, onChanged, onDirty, gone, version }: EventDetailProps) {
  return (
    <Unfold kindLabel={event ? "Eintrag" : "Neuer Eintrag"} origin={origin} onRequestClose={onRequestClose}>
      <EventForm key={version} event={event} day={day} time={time} goals={goals} variant="detail" onChanged={onChanged} onDirty={onDirty} gone={gone} />
    </Unfold>
  );
}
