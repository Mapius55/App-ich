import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { buildIcs } from "../../supabase/functions/_shared/ics.ts";
import { dayHeading, eventWhen } from "../lib/dates";
import type { CalendarEvent } from "../lib/types";

// The calendar "I am": what the coach (or you) put in, plus the one-time
// connection to the iPhone calendar (a subscription that updates itself).

export function Calendar({ onBack }: { onBack: () => void }) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const load = () =>
    Promise.all([backend.listEvents(), backend.calendarLink()])
      .then(([ev, l]) => {
        setEvents(ev);
        setLink(l);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    load();
  }, []);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const downloadIcs = () => {
    const ics = buildIcs(events ?? [], { name: "I am", timezone: tz });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "i-am.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const add = async () => {
    if (!title.trim() || !date) return;
    const starts = new Date(time ? `${date}T${time}` : `${date}T00:00`);
    const ev = await backend.addEvent({
      title: title.trim(),
      starts_at: starts.toISOString(),
      ends_at: null,
      all_day: !time,
      location: null,
      notes: null,
      reminder_minutes: time ? 30 : -480,
    });
    setEvents((xs) => [...(xs ?? []), ev].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
    setTitle("");
    setDate("");
    setTime("");
    setAdding(false);
  };

  // group by day
  const groups: { day: string; items: CalendarEvent[] }[] = [];
  for (const e of events ?? []) {
    const day = new Date(e.starts_at).toDateString();
    const g = groups.find((x) => x.day === day);
    if (g) g.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <main className="screen calendar">
      <header className="topbar">
        <button className="dock-round" onClick={onBack} aria-label="Zurück">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <span className="pill">Kalender „I am“</span>
      </header>

      <h1 className="title">Deine Termine</h1>
      <p className="lede">Was du dem Coach erzählst, trägt er hier ein. Mit deinem iPhone verbunden, erscheint alles im Kalender „I am“, mit Erinnerung.</p>

      {error && <p className="form-error">{error}</p>}

      <section className="connect card-glass">
        <span className="pill">Mit dem iPhone verbinden</span>
        {link ? (
          <>
            <ol className="steps">
              <li>
                Tippe auf <strong>Kalender abonnieren</strong> und dann auf <strong>Abonnieren</strong>.
              </li>
              <li>
                Schalte <strong>„Hinweise entfernen“</strong> aus, damit die Erinnerungen klingeln. Danach oben rechts auf <strong>Hinzufügen</strong>.
              </li>
              <li>
                Optional: <em>Einstellungen → Kalender → Accounts → Abrufen</em> auf „Alle 15 Minuten“, damit neue Termine schneller da sind.
              </li>
            </ol>
            <div className="row wrap">
              <a className="btn primary" href={link}>
                Kalender abonnieren
              </a>
              <button
                className="btn ghost"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(link.replace(/^webcal:/, "https:"))
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                    .catch(() => {})
                }
              >
                {copied ? "Kopiert" : "Link kopieren"}
              </button>
            </div>
            <button
              className="btn quiet"
              onClick={async () => {
                if (!confirm("Neuen Link erstellen? Der alte funktioniert dann nicht mehr, du musst den Kalender neu abonnieren.")) return;
                await backend.renewCalendarLink();
                load();
              }}
            >
              Link erneuern
            </button>
          </>
        ) : (
          <>
            <p className="hint">
              Im Demo-Modus gibt es noch kein Abo. Du kannst die Termine aber als Datei öffnen und so in den iPhone-Kalender übernehmen.
            </p>
            <button className="btn ghost" onClick={downloadIcs} disabled={!events?.length}>
              Als Kalender-Datei öffnen
            </button>
          </>
        )}
      </section>

      {events && events.length === 0 && <p className="lede">Noch keine Termine. Erzähl dem Coach, was ansteht, z.B. „Am Samstag um 9 habe ich ein Rennen“.</p>}

      {groups.map((g) => (
        <section key={g.day} className="event-group">
          <h2 className="pill">{dayHeading(g.items[0].starts_at)}</h2>
          <ul>
            {g.items.map((e) => (
              <li key={e.id} className="event-row">
                <span className="event-row-body">
                  <span className="event-row-title">{e.title}</span>
                  <span className="event-row-when">
                    {eventWhen(e).split(" · ")[1]}
                    {e.location ? ` · ${e.location}` : ""}
                    {e.source === "coach" ? " · vom Coach" : ""}
                  </span>
                </span>
                <button
                  className="dock-round small"
                  aria-label={`${e.title} löschen`}
                  onClick={async () => {
                    await backend.deleteEvent(e.id);
                    setEvents((xs) => (xs ?? []).filter((x) => x.id !== e.id));
                  }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {adding ? (
        <div className="add-memory">
          <input placeholder="Was?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Titel" className="plain-input" autoFocus />
          <div className="row">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Datum" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Uhrzeit (optional)" />
          </div>
          <div className="row">
            <span className="spacer" />
            <button className="btn quiet" onClick={() => setAdding(false)}>
              Abbrechen
            </button>
            <button className="btn primary" onClick={add}>
              Eintragen
            </button>
          </div>
        </div>
      ) : (
        <button className="btn ghost wide add-btn" onClick={() => setAdding(true)}>
          Termin hinzufügen
        </button>
      )}
    </main>
  );
}
