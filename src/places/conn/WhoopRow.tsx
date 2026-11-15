// Du › Verbindungen › WHOOP: connect (with the confirm after the return), then the last 14 days, the
// switch for the coach, "Jetzt holen", "Trennen" and the required attribution.
import { useId, useState } from "react";
import { backend } from "../../lib/backend";
import { dayOf } from "../../lib/plan";
import { agoLabel, canSyncNow, SERVICE_LINES, whoopRowKind } from "../../lib/connections";
import { ConfirmDelete } from "../../space/ConfirmDelete";
import { connStore, useWhoop } from "./store";
import { useWhoopConnect, WHOOP_OUTCOME_TEXT } from "./useWhoopConnect";
import { WhoopStrip } from "./WhoopStrip";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PRIVACY_URL = "./datenschutz.html";

export function WhoopRow() {
  const whoop = useWhoop();
  const s = whoop.value;
  const kind = whoopRowKind(s, whoop.failed);
  const flow = useWhoopConnect("space");
  const [syncing, setSyncing] = useState(false);
  const [tapAt, setTapAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const ids = { consent: useId(), consentHint: useId() };

  const sync = async () => {
    if (!canSyncNow(s?.last_sync_at, tapAt)) return setNote("Gerade eben geholt. Neue Werte kommen von selbst.");
    setSyncing(true);
    setNote(null);
    setTapAt(Date.now());
    try {
      const r = await backend.whoopSync();
      if (r.skipped === "recent") setNote("Gerade eben geholt. Neue Werte kommen von selbst.");
      else if (!r.ok && r.error) setNote(r.error);
      await connStore.loadWhoop(true);
    } catch (e) {
      setNote(message(e));
    } finally {
      setSyncing(false);
    }
  };

  const setConsent = async (on: boolean) => {
    if (!s) return;
    setConsentBusy(true);
    connStore.setWhoop({ ...s, consent_ai: on }); // at once; back if it fails
    try {
      const ok = await backend.setWhoopConsent(on);
      if (!ok) throw new Error("Das hat gerade nicht geklappt.");
    } catch (e) {
      connStore.setWhoop({ ...s, consent_ai: !on });
      setNote(message(e));
    } finally {
      setConsentBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      await backend.whoopDisconnect();
      flow.clear();
      setNote(null);
      await connStore.loadWhoop(true);
    } catch (e) {
      setNote(message(e));
    }
  };

  const confirming = flow.busy === "confirming";
  const failed = flow.outcome && flow.outcome !== "ok" ? flow.outcome : null;
  const lastSync = agoLabel(s?.last_sync_at);

  const connectButton = (label: string) => (
    <button type="button" className="btn ghost cx-btn" disabled={!!flow.busy} onClick={flow.start}>
      {flow.busy === "starting" ? "Einen Moment …" : label}
    </button>
  );

  return (
    <section className="du-conn cx-conn" aria-labelledby="du-conn-whoop" data-service="whoop" data-state={confirming ? "confirming" : kind}>
      <div className="du-conn-head">
        <h4 id="du-conn-whoop" className="du-conn-name">
          WHOOP
        </h4>
        {kind === "soon" && (
          <button type="button" className="du-soon" disabled>
            Bald verfügbar
          </button>
        )}
        {kind === "connected" && lastSync && <span className="cx-when">geholt {lastSync}</span>}
      </div>

      {kind === "loading" && !confirming && <p className="du-conn-text">Einen Moment …</p>}
      {kind === "soon" && <p className="du-conn-text">Würde Schlaf, Erholung und Belastung lesen, damit ich weiss, wie viel heute drinliegt.</p>}
      {kind === "unreachable" && (
        <>
          <p className="du-conn-text">Gerade nicht erreichbar.</p>
          <button type="button" className="pl-quiet" onClick={() => connStore.loadWhoop(true)}>
            Nochmal versuchen
          </button>
        </>
      )}

      {confirming && (
        <p className="du-conn-text" role="status">
          Ich bestätige die Verbindung …
        </p>
      )}

      {!confirming && failed && (kind === "connect" || kind === "pending" || kind === "reconnect") && (
        <div className="cx-outcome" role="alert">
          <p className="du-conn-text">{WHOOP_OUTCOME_TEXT[failed]}</p>
          {connectButton("Nochmal versuchen")}
        </div>
      )}

      {!confirming && !failed && (kind === "connect" || kind === "pending") && (
        <>
          <p className="du-conn-text">{SERVICE_LINES.whoop}</p>
          {kind === "pending" && <p className="du-conn-text">Die Verbindung ist noch nicht bestätigt.</p>}
          {connectButton(kind === "pending" ? "Nochmal verbinden" : "Verbinden")}
        </>
      )}

      {!confirming && !failed && kind === "reconnect" && (
        <>
          <p className="du-conn-text">Die Verbindung zu WHOOP ist abgelaufen. Verbinde sie neu, dann kommen die Werte wieder.</p>
          {connectButton("Neu verbinden")}
        </>
      )}

      {flow.error && (
        <p className="form-error cx-error" role="alert">
          {flow.error}
        </p>
      )}

      {!confirming && kind === "connected" && s && (
        <>
          {flow.outcome === "ok" && (
            <p className="cx-ok" role="status">
              {WHOOP_OUTCOME_TEXT.ok}
            </p>
          )}
          {s.days.length > 0 ? (
            <WhoopStrip days={s.days} today={dayOf()} />
          ) : (
            <p className="du-conn-text">Die ersten Werte kommen gleich. Schau in ein paar Minuten nochmal.</p>
          )}
          <label className="toggle-row cx-consent">
            <span>
              <span id={ids.consent}>Coach darf die Werte nutzen</span>
              <span id={ids.consentHint} className="cx-hint">
                {s.consent_ai ? "Ich sehe eine kurze Zusammenfassung und richte mich danach." : "Ohne das siehst nur du die Werte, hier in der App."}
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              role="switch"
              checked={s.consent_ai}
              disabled={consentBusy}
              onChange={(e) => setConsent(e.target.checked)}
              aria-labelledby={ids.consent}
              aria-describedby={ids.consentHint}
            />
          </label>
          <div className="cx-actions">
            <button type="button" className="pl-quiet" disabled={syncing} onClick={sync}>
              {syncing ? "Ich hole …" : "Jetzt holen"}
            </button>
            <ConfirmDelete label="Trennen" question="WHOOP trennen? Die Werte hier werden gelöscht." yes="Ja, trennen" onConfirm={disconnect} />
          </div>
        </>
      )}

      {note && (
        <p className="du-conn-text cx-note" role="status">
          {note}
        </p>
      )}

      {kind !== "soon" && kind !== "loading" && kind !== "unreachable" && (
        <p className="cx-foot">
          {kind === "connected" && s?.attribution && <span>{s.attribution}</span>}
          {kind === "connected" && s?.attribution && <span aria-hidden="true"> · </span>}
          <a className="cx-link" href={PRIVACY_URL} target="_blank" rel="noopener">
            Datenschutz
          </a>
        </p>
      )}
    </section>
  );
}
