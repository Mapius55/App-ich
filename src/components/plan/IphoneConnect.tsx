import { useEffect, useId, useState } from "react";
import { backend } from "../../lib/backend";
import { buildIcs } from "../../../supabase/functions/_shared/ics.ts";
import { IconChevron } from "./icons";

// The one-time connection to the iPhone calendar: a subscription that updates
// itself. Folded away by default; once set up, it's rarely needed again.
// variant "inline" (the space, Du › Verbindungen): no card and no own toggle, the
// steps show right away inside the row that holds them.

export function IphoneConnect({ initiallyOpen = false, variant = "card" }: { initiallyOpen?: boolean; variant?: "card" | "inline" }) {
  const inline = variant === "inline";
  const [open, setOpen] = useState(initiallyOpen || inline);
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();

  const load = () =>
    backend
      .calendarLink()
      .then(setLink)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    if (open && link === undefined) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const downloadIcs = async () => {
    try {
      const events = await backend.listEvents();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const ics = buildIcs(events, { name: "I am", timezone: tz });
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "i-am.ics";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const content = (
    <>
      <p className="hint">Alles aus deinem Plan erscheint dann im iPhone-Kalender „I am“, mit Erinnerung.</p>
      {error && <p className="form-error">{error}</p>}
      {link === undefined && !error && <p className="hint">Einen Moment …</p>}
      {link && (
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
              type="button"
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
            type="button"
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
      )}
      {link === null && (
        <>
          <p className="hint">
            Im Demo-Modus gibt es noch kein Abo. Du kannst die Termine aber als Datei öffnen und so in den iPhone-Kalender übernehmen.
          </p>
          <button type="button" className="btn ghost" onClick={downloadIcs}>
            Als Kalender-Datei öffnen
          </button>
        </>
      )}
    </>
  );

  if (inline) return <div className="iphone-inline">{content}</div>;

  return (
    <section className={`card-glass plan-connect ${open ? "open" : ""}`}>
      <button type="button" className="plan-connect-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <span className="pill">Mit dem iPhone verbinden</span>
        <span className="plan-connect-chevron" aria-hidden="true">
          <IconChevron dir="down" />
        </span>
      </button>

      {open && (
        <div id={panelId} className="plan-connect-body">
          {content}
        </div>
      )}
    </section>
  );
}
