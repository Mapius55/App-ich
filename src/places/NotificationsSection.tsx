// Du › Benachrichtigungen: the morning and the evening message and the reminders of her entries (logic
// copied from screens/Settings.tsx, which stays for the flag-off path). What they say and when they stay
// out is decided on the server (supabase/functions/_shared/push_text.ts); the hints here describe it.
import { useEffect, useState } from "react";
import { DEFAULT_TIME, weekendTime } from "../../supabase/functions/_shared/push_text.ts";
import { backend } from "../lib/backend";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from "../lib/push";
import type { Profile } from "../lib/types";

export const hhmm = (t: string | null | undefined, fallback: string) => (t ? t.slice(0, 5) : fallback);

/** the row's value: "07:30 · 21:00", one time, or "Aus" */
export function notifyValue(p: Pick<Profile, "notify_morning" | "notify_evening">): string {
  const times = [p.notify_morning, p.notify_evening].filter((t): t is string => !!t).map((t) => t.slice(0, 5));
  return times.length ? times.join(" · ") : "Aus";
}

/** a slot's hint: what it brings, and its weekend time when that differs (only at the default time) */
export function notifyHint(slot: "morning" | "evening", time: string): string {
  const what = slot === "morning" ? "Was heute ansteht" : "Ein kurzer Blick auf deinen Tag";
  const weekend = weekendTime(slot, time);
  return weekend ? `${what}, am Wochenende um ${weekend}` : what;
}

/** the first thing the hint says (owner decision 3): no message without something of her own */
export const NOTIFY_OWN = "Nur, wenn es etwas aus deinem Tag gibt.";

/** how the messages hold back, so nothing about them is a surprise */
export const NOTIFY_RULES =
  "Warst du heute schon da, kommt am Morgen keine Nachricht. Am Abend bleibt sie aus, wenn du am Abend schon in der App warst oder kurz vorher mit dem Coach gesprochen hast. Während einer deiner Einträge läuft, kommt keine. Öffnest du die App ein paar Tage nicht, kommt noch eine einzige mit deinem nächsten Eintrag, danach ist Ruhe, bis du wieder vorbeischaust. Deine Einstellungen bleiben dabei, wie sie sind.";

/** the third row: what a reminder is for, and why none comes with the calendar subscription */
export const REMINDERS_HINT =
  "Kurz vor deinen Blöcken und vor Einträgen, an die du erinnert werden möchtest, höchstens dreimal am Tag. Mit dem Kalender-Abo erinnert dich der iPhone-Kalender.";

/** «Erinnerungen an Einträge» is on unless she switched it off (the column's default; missing before its migration) */
export const remindersOn = (p: Pick<Profile, "notify_reminders">) => p.notify_reminders !== false;

export function NotificationsSection({ profile, onProfile }: { profile: Profile; onProfile(patch: Partial<Profile>): void }) {
  const [pushOn, setPushOn] = useState(false);
  const [morningOn, setMorningOn] = useState(!!profile.notify_morning);
  const [eveningOn, setEveningOn] = useState(!!profile.notify_evening);
  const [morning, setMorning] = useState(hhmm(profile.notify_morning, DEFAULT_TIME.morning));
  const [evening, setEvening] = useState(hhmm(profile.notify_evening, DEFAULT_TIME.evening));
  const [reminders, setReminders] = useState(remindersOn(profile));
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

  const saveReminders = (on: boolean) =>
    run(async () => {
      setReminders(on);
      try {
        await backend.updateProfile({ notify_reminders: on });
      } catch (e) {
        setReminders(!on);
        throw e;
      }
      onProfile({ notify_reminders: on });
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
          Auf dem iPhone geht das nur, wenn „Bucket List“ auf dem Home-Bildschirm liegt: in Safari auf <strong>Teilen</strong> → <strong>Zum Home-Bildschirm</strong>, dann die App von dort
          öffnen.
        </p>
      )}
      <label className="toggle-row du-toggle">
        <span>
          <strong>Am Morgen</strong>
          <span className="hint">{notifyHint("morning", morning)}</span>
        </span>
        <input type="time" value={morning} disabled={!morningOn} onChange={(e) => setMorning(e.target.value)} onBlur={() => saveTimes()} aria-label="Zeit der Morgennachricht" />
        <input
          type="checkbox"
          className="switch"
          checked={morningOn}
          onChange={(e) => (setMorningOn(e.target.checked), saveTimes(e.target.checked))}
          aria-label="Morgennachricht an oder aus"
        />
      </label>
      <label className="toggle-row du-toggle">
        <span>
          <strong>Am Abend</strong>
          <span className="hint">{notifyHint("evening", evening)}</span>
        </span>
        <input type="time" value={evening} disabled={!eveningOn} onChange={(e) => setEvening(e.target.value)} onBlur={() => saveTimes()} aria-label="Zeit der Abendnachricht" />
        <input
          type="checkbox"
          className="switch"
          checked={eveningOn}
          onChange={(e) => (setEveningOn(e.target.checked), saveTimes(morningOn, morning, e.target.checked))}
          aria-label="Abendnachricht an oder aus"
        />
      </label>
      <label className="toggle-row du-toggle">
        <span>
          <strong>Erinnerungen an Einträge</strong>
          <span className="hint">{REMINDERS_HINT}</span>
        </span>
        <input
          type="checkbox"
          className="switch"
          checked={reminders}
          disabled={busy}
          onChange={(e) => saveReminders(e.target.checked)}
          aria-label="Erinnerungen an Einträge an oder aus"
        />
      </label>
      <p className="pl-hint">
        {NOTIFY_OWN} {NOTIFY_RULES}
      </p>
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
