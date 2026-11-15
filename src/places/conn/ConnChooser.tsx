// The connection chooser under the onboarding conversation (after the coach's request_connections):
// one chip per service. An available one starts its connect flow (WHOOP: to WHOOP and back, the
// iPhone calendar: its steps inline); an unavailable one says why in one line. "Später" closes it.
// Nothing here blocks finishing onboarding. Only what the app can show and undo afterwards is offered:
// the classic screens (space flag off) have no Du › Verbindungen, so WHOOP is "kommt bald" there and
// Nolio is left out.
import { useState } from "react";
import { backend } from "../../lib/backend";
import { nolioRowKind, SERVICE_NAMES, unavailableReason, whoopRowKind, type ServiceKey } from "../../lib/connections";
import { IphoneConnect } from "../../components/plan/IphoneConnect";
import { spaceEnabled } from "../../space/flags";
import { connStore, useNolio, useWhoop } from "./store";
import { WHOOP_OUTCOME_TEXT, type useWhoopConnect } from "./useWhoopConnect";

type Flow = ReturnType<typeof useWhoopConnect>;

const Check = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.2 4.2L19 7" />
  </svg>
);

export function ConnChooser({ flow, onClose, manageable = spaceEnabled() }: { flow: Flow; onClose(): void; manageable?: boolean }) {
  const whoop = useWhoop();
  const nolio = useNolio();
  const wReal = whoopRowKind(whoop.value, whoop.failed);
  // without a place to see, allow or disconnect it later, WHOOP is not offered (one that is connected stays shown)
  const wKind = manageable || wReal === "connected" ? wReal : "soon";
  const nKind = manageable ? nolioRowKind(nolio.value, nolio.failed) : "soon";
  const [active, setActive] = useState<ServiceKey | null>(null);
  const [reason, setReason] = useState<{ text: string; ok?: boolean } | null>(null);
  const [nolioBusy, setNolioBusy] = useState(false);

  const whoopOn = wKind === "connected";
  const nolioOn = nKind === "ready";
  const services: ServiceKey[] = ["whoop", ...(nolioOn ? (["nolio"] as const) : []), "iphone", "polar", "garmin", "strava"];
  const available = (k: ServiceKey) =>
    k === "iphone" || (k === "nolio" && nolioOn) || (k === "whoop" && (wKind === "connect" || wKind === "pending" || wKind === "reconnect" || wKind === "loading"));

  const tap = async (k: ServiceKey) => {
    flow.clear();
    setActive(k);
    if (k === "whoop" && whoopOn) return setReason({ text: "WHOOP ist schon verbunden.", ok: true });
    if (!available(k)) return setReason({ text: unavailableReason(k, { nolio: nolioOn }) });
    setReason(null);
    if (k === "whoop") return flow.start();
    if (k === "nolio") {
      setNolioBusy(true);
      setReason({ text: "Ich hole die Trainings von deinem Trainer …" });
      try {
        const r = await backend.nolioSync();
        await connStore.loadNolio(true);
        // the server answers a failed, throttled or running sync with 200 too: claim only what happened
        if (r.ok === true) setReason({ text: "Nolio ist verbunden. Die Trainings von deinem Trainer sind in deinem Kalender.", ok: true });
        else if (r.skipped === "running") setReason({ text: "Ich hole gerade schon. Gleich sind die Trainings in deinem Kalender." });
        else setReason({ text: r.error || "Nolio ist gerade nicht erreichbar. Das holen wir später." });
      } catch {
        setReason({ text: "Nolio ist gerade nicht erreichbar. Das holen wir später." });
      } finally {
        setNolioBusy(false);
      }
    }
  };

  const whoopFailed = flow.outcome && flow.outcome !== "ok" ? flow.outcome : null;
  const done = whoopOn || flow.outcome === "ok";
  return (
    <div className="cx-chooser" role="group" aria-label="Verbindungen">
      <p className="cx-reason">Was darf ich lesen?</p>
      <div className="cx-chips">
        {services.map((k) => {
          const on = (k === "whoop" && done) || (k === "nolio" && nolioOn && !!nolio.value?.connected);
          return (
            <button
              key={k}
              type="button"
              className={`cx-chip${on ? " on" : ""}${available(k) || on ? "" : " soon"}`}
              aria-expanded={k === "iphone" ? active === "iphone" : undefined}
              aria-pressed={k !== "iphone" ? active === k : undefined}
              disabled={(k === "whoop" && !!flow.busy) || (k === "nolio" && nolioBusy)}
              onClick={() => (k === "iphone" && active === "iphone" ? setActive(null) : tap(k))}
            >
              {on && <Check />}
              {k === "whoop" && flow.busy ? "Einen Moment …" : SERVICE_NAMES[k]}
            </button>
          );
        })}
        <button type="button" className={`cx-chip later${done ? " next" : ""}`} onClick={onClose}>
          {done ? "Weiter" : "Später"}
        </button>
      </div>

      <div aria-live="polite" className="cx-live">
        {flow.busy === "confirming" && <p className="cx-reason">Ich bestätige die Verbindung zu WHOOP …</p>}
        {flow.outcome === "ok" && <p className="cx-reason ok">{WHOOP_OUTCOME_TEXT.ok}</p>}
        {whoopFailed && (
          <p className="cx-reason">
            {WHOOP_OUTCOME_TEXT[whoopFailed]}{" "}
            <button type="button" className="link" onClick={() => tap("whoop")}>
              Nochmal versuchen
            </button>
          </p>
        )}
        {flow.error && <p className="cx-reason">{flow.error}</p>}
        {!flow.busy && !flow.outcome && !flow.error && reason && <p className={`cx-reason${reason.ok ? " ok" : ""}`}>{reason.text}</p>}
      </div>

      {active === "iphone" && (
        <div className="cx-iphone">
          <IphoneConnect variant="inline" />
        </div>
      )}
    </div>
  );
}
