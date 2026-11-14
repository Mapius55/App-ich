import { useId, useState } from "react";
import { backend } from "../../lib/backend";
import { addDays, dayOf, daysBetween } from "../../lib/plan";
import { localMidnightIso, timeHM } from "../../lib/dates";
import type { CalendarEvent, EventInput, Goal } from "../../lib/types";
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

interface Props {
  event: CalendarEvent | null; // null = new entry
  day: string; // the day a new entry goes on
  goals: Goal[];
  onClose: () => void;
  /** after a change; with the entry's day when it was saved */
  onChanged: (day?: string) => void;
}

export function EventSheet({ event, day, goals, onClose, onChanged }: Props) {
  const startDay = event ? dayOf(new Date(event.starts_at)) : day;
  const initialStart = event && !event.all_day ? timeHM(event.starts_at) : defaultStart(day);
  // a timed entry may end on a later day; that offset is kept when editing
  const endOffset = event?.ends_at ? Math.max(0, daysBetween(startDay, dayOf(new Date(event.ends_at)))) : 0;

  const [title, setTitle] = useState(event?.title ?? "");
  const [kind, setKind] = useState<CalendarEvent["kind"]>(event?.kind ?? "termin");
  const [date, setDate] = useState(startDay);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(() => {
    if (event) return event.ends_at && !event.all_day ? timeHM(event.ends_at) : "";
    return hm(Math.min(toMin(initialStart) + 60, 23 * 60 + 59));
  });
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [reminder, setReminder] = useState<number | null>(event ? event.reminder_minutes : defaultReminder(false, "termin"));
  const [reminderTouched, setReminderTouched] = useState(!!event);
  const [goalId, setGoalId] = useState(event?.goal_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { kind: useId(), allDay: useId() };

  const options = [...(allDay ? ALL_DAY : TIMED)];
  if (!options.includes(reminder)) options.push(reminder);

  const goalOptions = goals.filter((g) => g.status !== "dropped" || g.id === goalId);

  const changeStart = (v: string) => {
    // keep the duration, like a paper calendar: moving the start moves the end
    if (end && start && v) setEnd(hm(Math.min(toMin(v) + Math.max(toMin(end) - toMin(start), 0), 23 * 60 + 59)));
    setStart(v);
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

  const save = async (close: () => void) => {
    const t = title.trim();
    if (!t) return setError("Wie heisst der Eintrag?");
    if (!date) return setError("An welchem Tag?");
    let starts_at: string;
    let ends_at: string | null = null;
    if (allDay) {
      starts_at = localMidnightIso(date);
      // a multi-day all-day entry keeps its length
      if (event?.all_day && event.ends_at && endOffset > 0) ends_at = localMidnightIso(addDays(date, endOffset));
    } else {
      if (!start) return setError("Wann beginnt es?");
      starts_at = new Date(`${date}T${start}`).toISOString();
      if (end) {
        ends_at = new Date(`${addDays(date, endOffset)}T${end}`).toISOString();
        if (ends_at <= starts_at) return setError("Das Ende muss nach dem Anfang liegen.");
      }
    }
    const input: EventInput = {
      title: t,
      starts_at,
      ends_at,
      all_day: allDay,
      location: location.trim() || null,
      notes: notes.trim() || null,
      reminder_minutes: reminder,
      kind,
      goal_id: goalId || null,
    };
    setBusy(true);
    setError(null);
    try {
      if (event) await backend.updateEvent(event.id, input);
      else await backend.addEvent(input);
      onChanged(date);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={event ? "Eintrag" : "Neuer Eintrag"} onClose={onClose}>
      {(close) => (
        <form
          className="sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            save(close);
          }}
          noValidate
        >
          <label className="sheet-field">
            <span>Was?</span>
            <input
              className="plain-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === "block" ? "z.B. Fokuszeit" : "z.B. Zahnarzt"}
              maxLength={200}
              data-autofocus={event ? undefined : true}
            />
          </label>

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
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
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

          <label className="sheet-field">
            <span>Notizen (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </label>

          {event?.source === "coach" && <p className="sheet-hint">Vom Coach eingetragen.</p>}

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
                    close();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
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
      )}
    </Sheet>
  );
}
