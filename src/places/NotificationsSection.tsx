// Du › Benachrichtigungen: Morgenfrage and Abendrückblick (logic copied from
// screens/Settings.tsx, which stays for the flag-off path).
import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from "../lib/push";
import type { Profile } from "../lib/types";

export const hhmm = (t: string | null | undefined, fallback: string) => (t ? t.slice(0, 5) : fallback);

/** the row's value: "07:30 · 21:00", one time, or "Aus" */
export function notifyValue(p: Pick<Profile, "notify_morning" | "notify_evening">): string {
  const times = [p.notify_morning, p.notify_evening].filter((t): t is string => !!t).map((t) => t.slice(0, 5));
  return times.length ? times.join(" · ") : "Aus";
}

export function NotificationsSection({ profile, onProfile }: { profile: Profile; onProfile(patch: Partial<Profile>): void }) {
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

  if (!server) return <p className="pl-hint">Nachrichten vom Coach gibt es, sobald die App mit dem Server (Supabase) verbunden ist.</p>;
  if (!pushSupported()) return <p className="pl-hint">Dieser Browser kann keine Benachrichtigungen empfangen.</p>;

  return (
    <div className="du-notify">
      {msg && (
        <p className="pl-hint" role="status">
          {msg}
        </p>
      )}
      {isIos() && !isStandalone() && (
        <p className="pl-hint">
          Auf dem iPhone geht das nur, wenn „I am“ auf dem Home-Bildschirm liegt: in Safari auf <strong>Teilen</strong> → <strong>Zum Home-Bildschirm</strong>, dann die App von dort
          öffnen.
        </p>
      )}
      <label className="toggle-row du-toggle">
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
      <label className="toggle-row du-toggle">
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
            <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => `${await backend.sendTestPush()} Nachricht(en) verschickt.`)}>
              Test senden
            </button>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => run(async () => (await disablePush(), setPushOn(false), "Auf diesem Gerät ausgeschaltet."))}>
              Auf diesem Gerät aus
            </button>
          </>
        ) : (
          <button
            type="button"
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
    </div>
  );
}
