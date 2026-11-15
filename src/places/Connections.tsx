// Du › Verbindungen: the iPhone calendar (steps inline, no card), and WHOOP, Polar,
// Strava as "Bald verfügbar" until their backends exist.
import { IphoneConnect } from "../components/plan/IphoneConnect";

const SOON = [
  { name: "WHOOP", text: "Liest Schlaf, Erholung und Belastung, damit ich weiss, wie viel heute drinliegt." },
  { name: "Polar", text: "Liest Trainings, Schlaf und Erholung von deiner Uhr." },
  { name: "Strava", text: "Liest deine Läufe, Velotouren und anderen Trainings, damit sie bei deinen Zielen zählen." },
];

export function Connections() {
  return (
    <div className="du-conns">
      <section className="du-conn" aria-labelledby="du-conn-iphone">
        <h4 id="du-conn-iphone" className="du-conn-name">
          iPhone-Kalender
        </h4>
        <IphoneConnect variant="inline" />
      </section>
      {SOON.map((c) => (
        <section key={c.name} className="du-conn" aria-label={c.name}>
          <div className="du-conn-head">
            <h4 className="du-conn-name">{c.name}</h4>
            <button type="button" className="du-soon" disabled>
              Bald verfügbar
            </button>
          </div>
          <p className="du-conn-text">{c.text}</p>
        </section>
      ))}
    </div>
  );
}
