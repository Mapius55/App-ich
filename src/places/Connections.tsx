// Du › Verbindungen: one quiet row per service, no cards. WHOOP (connect, the last 14 days, the
// coach switch), Nolio (the trainer's plan, owner only), the iPhone calendar (steps inline), Polar and
// Garmin ("Bald verfügbar"), Strava (honest: its rules don't allow an AI coach). A service whose status
// can't be read shows "Bald verfügbar", never an error or a dead button.
import { IphoneConnect } from "../components/plan/IphoneConnect";
import { nolioRowKind, SERVICE_LINES, stravaLine, whoopOffered, whoopRowKind } from "../lib/connections";
import { NolioRow } from "./conn/NolioRow";
import { useNolio, useWhoop } from "./conn/store";
import { WhoopRow } from "./conn/WhoopRow";
import "./conn/conn.css";

function SoonRow({ id, name, text }: { id: string; name: string; text: string }) {
  return (
    <section className="du-conn cx-conn" aria-labelledby={`du-conn-${id}`} data-service={id} data-state="soon">
      <div className="du-conn-head">
        <h4 id={`du-conn-${id}`} className="du-conn-name">
          {name}
        </h4>
        <button type="button" className="du-soon" disabled>
          Bald verfügbar
        </button>
      </div>
      <p className="du-conn-text">{text}</p>
    </section>
  );
}

export function Connections() {
  const nolio = useNolio();
  const whoop = useWhoop();
  const nolioReady = nolioRowKind(nolio.value, nolio.failed) === "ready";
  const garminViaNolio = nolioReady && !!nolio.value?.connected;
  return (
    <div className="du-conns">
      <WhoopRow />
      <NolioRow />
      <section className="du-conn" aria-labelledby="du-conn-iphone" data-service="iphone">
        <h4 id="du-conn-iphone" className="du-conn-name">
          iPhone-Kalender
        </h4>
        <IphoneConnect variant="inline" />
      </section>
      <SoonRow id="polar" name="Polar" text={SERVICE_LINES.polar} />
      <SoonRow id="garmin" name="Garmin" text={garminViaNolio ? `${SERVICE_LINES.garminViaNolio} Direkt verbinden kommt bald.` : SERVICE_LINES.garmin} />
      <section className="du-conn cx-conn" aria-labelledby="du-conn-strava" data-service="strava" data-state="none">
        <h4 id="du-conn-strava" className="du-conn-name">
          Strava
        </h4>
        <p className="du-conn-text">{stravaLine({ whoop: whoopOffered(whoopRowKind(whoop.value, whoop.failed)), nolio: nolioReady })}</p>
      </section>
    </div>
  );
}
