// Du › Dein Körper and the soft values of the Du rows, from the connections: with WHOOP connected the
// last 7 days (Erholung, Schlaf, Belastung), otherwise the invitation to connect. Used by YouPlace /
// BodySection (they own the rows); everything WHOOP-specific stays here.
import { dayOf } from "../../lib/plan";
import { bodyValue, connectionsValue, whoopOffered, whoopRowKind } from "../../lib/connections";
import { useNolio, useWhoop } from "./store";
import { WhoopStrip } from "./WhoopStrip";
import "./conn.css";

/** "DEIN KÖRPER": "Erholung 82 %", "WHOOP" or "Noch nicht verbunden" */
export function useBodyValue(): string {
  return bodyValue(useWhoop().value, dayOf());
}

/** "VERBINDUNGEN": what is connected ("WHOOP · Nolio"), else the iPhone calendar, which everyone has */
export function useConnectionsValue(): string {
  return connectionsValue(useWhoop().value, useNolio().value) ?? "iPhone-Kalender";
}

export function BodyContent({ onConnections }: { onConnections(): void }) {
  const whoop = useWhoop();
  const s = whoop.value;
  const kind = whoopRowKind(s, whoop.failed);
  if (kind === "connected" && s) {
    return (
      <div className="du-body cx-body">
        {s.days.length > 0 ? (
          <WhoopStrip days={s.days} today={dayOf()} n={7} />
        ) : (
          <p className="du-conn-text">Die ersten Werte von WHOOP kommen gleich.</p>
        )}
        <p className="cx-foot">
          {s.attribution}
          {!s.consent_ai && " · Nur du siehst diese Werte."}
        </p>
        <button type="button" className="pl-quiet" onClick={onConnections}>
          Zu den Verbindungen
        </button>
      </div>
    );
  }
  return (
    <div className="du-body">
      <p className="du-serif">
        {kind === "loading"
          ? "Einen Moment …"
          : whoopOffered(kind)
            ? "Verbinde WHOOP, dann sehe ich, wie du schläfst und dich erholst."
            : "Sobald WHOOP oder Polar verbunden werden kann, sehe ich hier, wie du schläfst und dich erholst."}
      </p>
      <button type="button" className="pl-quiet" onClick={onConnections}>
        Zu den Verbindungen
      </button>
    </div>
  );
}
