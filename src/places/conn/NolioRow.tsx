// Du › Verbindungen › Nolio: only for the owner of the app (the key is hers). Last sync, what came in,
// "Jetzt holen", and Garmin's attribution when the trainings came from a Garmin device.
import { useState } from "react";
import { backend } from "../../lib/backend";
import { agoLabel, canSyncNow, nolioRowKind, SERVICE_LINES } from "../../lib/connections";
import { planData } from "../../space/data";
import { connStore, useNolio } from "./store";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function NolioRow() {
  const nolio = useNolio();
  const s = nolio.value;
  const kind = nolioRowKind(s, nolio.failed);
  const [syncing, setSyncing] = useState(false);
  const [tapAt, setTapAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const sync = async () => {
    if (!canSyncNow(s?.last_sync_at, tapAt)) return setNote("Gerade eben geholt.");
    setSyncing(true);
    setNote(null);
    setTapAt(Date.now());
    try {
      const r = await backend.nolioSync();
      if (r.skipped === "running") setNote("Ich hole gerade schon. Gleich ist alles da.");
      else if (r.skipped === "throttled" || (r.ok === false && r.error)) setNote(r.error ?? "Nolio bittet um eine kurze Pause. Später nochmal.");
      await connStore.loadNolio(true);
      planData.bumpEvents(); // the trainer's plan in the calendar
      planData.bumpPlan(); // and the time for goals
    } catch (e) {
      setNote(message(e));
    } finally {
      setSyncing(false);
    }
  };

  const last = agoLabel(s?.last_sync_at);
  const counts = s?.counts;
  return (
    <section className="du-conn cx-conn" aria-labelledby="du-conn-nolio" data-service="nolio" data-state={kind}>
      <div className="du-conn-head">
        <h4 id="du-conn-nolio" className="du-conn-name">
          Nolio
        </h4>
        {kind === "soon" && (
          <button type="button" className="du-soon" disabled>
            Bald verfügbar
          </button>
        )}
        {kind === "ready" && last && <span className="cx-when">geholt {last}</span>}
      </div>
      {kind === "loading" && <p className="du-conn-text">Einen Moment …</p>}
      {kind === "soon" && <p className="du-conn-text">Würde die Trainings lesen, die dein Trainer plant, damit sie bei deinen Zielen zählen.</p>}
      {kind === "unreachable" && (
        <>
          <p className="du-conn-text">Gerade nicht erreichbar.</p>
          <button type="button" className="pl-quiet" onClick={() => connStore.loadNolio(true)}>
            Nochmal versuchen
          </button>
        </>
      )}
      {kind === "ready" && s && (
        <>
          <p className="du-conn-text">{SERVICE_LINES.nolio}</p>
          {counts && (counts.planned > 0 || counts.trainings > 0) ? (
            <p className="cx-counts">
              {[counts.planned > 0 ? `${count(counts.planned, "Training", "Trainings")} vom Trainer geplant` : null, counts.assigned > 0 ? `${count(counts.assigned, "Training zählt", "Trainings zählen")} für deine Ziele` : null]
                .filter(Boolean)
                .join(" · ") || `${count(counts.trainings, "Training", "Trainings")} gelesen`}
            </p>
          ) : (
            !s.last_sync_at && <p className="du-conn-text">Noch nichts geholt.</p>
          )}
          {s.last_error && <p className="du-conn-text cx-note">{s.last_error}</p>}
          <div className="cx-actions">
            <button type="button" className="pl-quiet" disabled={syncing || s.running} onClick={sync}>
              {syncing || s.running ? "Ich hole …" : "Jetzt holen"}
            </button>
          </div>
          {note && (
            <p className="du-conn-text cx-note" role="status">
              {note}
            </p>
          )}
          {s.garmin && <p className="cx-foot">Trainings aufgezeichnet mit {s.garmin}</p>}
        </>
      )}
    </section>
  );
}
