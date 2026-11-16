import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported, signOutDevice } from "../lib/push";
import { requestCoords, type Coords } from "../lib/location";
import type { Profile } from "../lib/types";

interface Props {
  profile: Profile;
  hasCoords: boolean;
  onBack: () => void;
  onProfile: (patch: Partial<Profile>) => void;
  onCoords: (c: Coords | null) => void;
  onOpenCalendar: () => void;
}

const hhmm = (t: string | null | undefined, fallback: string) => (t ? t.slice(0, 5) : fallback);

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="settings-section card-glass">
      <span className="pill">{label}</span>
      {children}
    </section>
  );
}

export function Settings({ profile, hasCoords, onBack, onProfile, onCoords, onOpenCalendar }: Props) {
  const [name, setName] = useState(profile.display_name ?? "");
  const [nameSaved, setNameSaved] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [morningOn, setMorningOn] = useState(!!profile.notify_morning);
  const [eveningOn, setEveningOn] = useState(!!profile.notify_evening);
  const [morning, setMorning] = useState(hhmm(profile.notify_morning, "07:30"));
  const [evening, setEvening] = useState(hhmm(profile.notify_evening, "21:00"));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const server = backend.kind === "supabase";

  useEffect(() => {
    currentSubscription().then((s) => setPushOn(!!s));
  }, []);

  const run = async (fn: () => Promise<void | string>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r) setMsg(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveTimes = (mOn = morningOn, m = morning, eOn = eveningOn, e = evening) =>
    run(async () => {
      const patch = { notify_morning: mOn ? `${m}:00` : null, notify_evening: eOn ? `${e}:00` : null };
      await backend.updateProfile(patch);
      onProfile(patch);
    });

  const download = () =>
    run(async () => {
      const data = await backend.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `bucket-list-daten-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

  return (
    <main className="screen settings">
      <header className="topbar">
        <button className="dock-round" onClick={onBack} aria-label="Zurück">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <span className="pill">Einstellungen</span>
      </header>
      <h1 className="title">Einstellungen</h1>
      {msg && (
        <p className="settings-msg" role="status">
          {msg}
        </p>
      )}

      <Section label="Dein Name">
        <div className="row">
          <input className="plain-input" value={name} onChange={(e) => (setName(e.target.value), setNameSaved(false))} aria-label="Name" />
          <button
            className="btn primary"
            disabled={busy || !name.trim() || name.trim() === profile.display_name}
            onClick={() =>
              run(async () => {
                await backend.updateProfile({ display_name: name.trim() });
                onProfile({ display_name: name.trim() });
                setNameSaved(true);
              })
            }
          >
            {nameSaved ? "Gespeichert" : "Speichern"}
          </button>
        </div>
        <p className="hint">So spricht dich der Coach an. Angemeldet bist du als „{profile.username}“.</p>
      </Section>

      {typeof profile.birth_year === "number" && (
        // the birth year (for «Leben», life in weeks): visible and removable here too
        <Section label="Geburtsjahr">
          <div className="row">
            <span className="settings-value">{profile.birth_year}</span>
            <button
              className="btn quiet"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await backend.updateProfile({ birth_year: null });
                  onProfile({ birth_year: null });
                  return "Geburtsjahr entfernt.";
                })
              }
            >
              Entfernen
            </button>
          </div>
          <p className="hint">Nur das Jahr. Die App braucht es für «Leben», dein Leben in Wochen (in der neuen Ansicht).</p>
        </Section>
      )}

      <Section label="Benachrichtigungen">
        {!server ? (
          <p className="hint">Nachrichten vom Coach gibt es, sobald die App mit dem Server (Supabase) verbunden ist.</p>
        ) : !pushSupported() ? (
          <p className="hint">Dieser Browser kann keine Benachrichtigungen empfangen.</p>
        ) : (
          <>
            {isIos() && !isStandalone() && (
              <p className="hint">
                Auf dem iPhone geht das nur, wenn „Bucket List“ auf dem Home-Bildschirm liegt: in Safari auf <strong>Teilen</strong> →{" "}
                <strong>Zum Home-Bildschirm</strong>, dann die App von dort öffnen.
              </p>
            )}
            <label className="toggle-row">
              <span>
                <strong>Morgenfrage</strong>
                <span className="hint">„Wie geht es dir heute?“ und was heute ansteht</span>
              </span>
              <input type="time" value={morning} disabled={!morningOn} onChange={(e) => setMorning(e.target.value)} onBlur={() => saveTimes()} aria-label="Zeit der Morgenfrage" />
              <input
                type="checkbox"
                className="switch"
                checked={morningOn}
                onChange={(e) => (setMorningOn(e.target.checked), saveTimes(e.target.checked))}
                aria-label="Morgenfrage an oder aus"
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Abendrückblick</strong>
                <span className="hint">„Wie war dein Tag?“</span>
              </span>
              <input type="time" value={evening} disabled={!eveningOn} onChange={(e) => setEvening(e.target.value)} onBlur={() => saveTimes()} aria-label="Zeit des Abendrückblicks" />
              <input
                type="checkbox"
                className="switch"
                checked={eveningOn}
                onChange={(e) => (setEveningOn(e.target.checked), saveTimes(morningOn, morning, e.target.checked))}
                aria-label="Abendrückblick an oder aus"
              />
            </label>
            <div className="row wrap">
              {pushOn ? (
                <>
                  <button className="btn ghost" disabled={busy} onClick={() => run(async () => `${await backend.sendTestPush()} Nachricht(en) verschickt.`)}>
                    Test senden
                  </button>
                  <button className="btn quiet" disabled={busy} onClick={() => run(async () => (await disablePush(), setPushOn(false), "Auf diesem Gerät ausgeschaltet."))}>
                    Auf diesem Gerät aus
                  </button>
                </>
              ) : (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await enablePush();
                      setPushOn(true);
                      if (!morningOn && !eveningOn) {
                        setMorningOn(true);
                        setEveningOn(true);
                        await saveTimes(true, morning, true, evening);
                      }
                      return "Benachrichtigungen sind an.";
                    })
                  }
                >
                  Auf diesem Gerät erlauben
                </button>
              )}
            </div>
          </>
        )}
      </Section>

      <Section label="Standort">
        <p className="hint">
          {hasCoords
            ? "Freigegeben. Sonnenstand und Wetter an deinem Ort bestimmen die Farben."
            : "Nicht freigegeben. Die Farben richten sich nach Zürich."}
        </p>
        <div className="row wrap">
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const c = await requestCoords();
                onCoords(c);
                return "Standort aktualisiert.";
              })
            }
          >
            {hasCoords ? "Neu bestimmen" : "Freigeben"}
          </button>
          {hasCoords && (
            <button
              className="btn quiet"
              onClick={() =>
                run(async () => {
                  try {
                    localStorage.removeItem("ich.coords");
                  } catch {
                    /* ignore */
                  }
                  await backend.updateProfile({ lat: null, lon: null });
                  onCoords(null);
                  return "Standort vergessen.";
                })
              }
            >
              Vergessen
            </button>
          )}
        </div>
      </Section>

      <Section label="Kalender „Bucket List“">
        <p className="hint">Termine, die der Coach einträgt, und die Verbindung zum iPhone-Kalender.</p>
        <button className="btn ghost" onClick={onOpenCalendar}>
          Zum Kalender im Plan
        </button>
      </Section>

      <Section label="Neue Ansicht">
        {/* the space (?space=1) is still behind its flag: in a home-screen app there is no address bar to add it */}
        <p className="hint">Mit der Bucket List und «Leben», deinem Leben in Wochen.</p>
        <button className="btn ghost" onClick={() => location.assign(`${import.meta.env.BASE_URL}?space=1`)}>
          Neue Ansicht öffnen
        </button>
      </Section>

      <Section label="Deine Daten">
        <p className="hint">Alles, was die App über dich speichert: Profil, Erinnerungen, Gespräche, Termine.</p>
        <div className="row wrap">
          <button className="btn ghost" disabled={busy} onClick={download}>
            Herunterladen
          </button>
          <button
            className="btn quiet danger"
            disabled={busy}
            onClick={() => {
              if (!confirm("Konto und alle Daten endgültig löschen? Das lässt sich nicht rückgängig machen.")) return;
              if (!confirm("Wirklich alles löschen?")) return;
              run(async () => {
                await disablePush().catch(() => {});
                await backend.deleteAccount();
              });
            }}
          >
            Konto löschen
          </button>
        </div>
      </Section>

      <button className="btn ghost wide add-btn" onClick={() => void signOutDevice()}>
        Abmelden
      </button>
    </main>
  );
}
