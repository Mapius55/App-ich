// STUB (phase 0): Builder C builds the tour (§9); the exports are final.
import { useSpace, type TourStep } from "./state";

/** rendered by NowLevel in place of the greeting when tour ∈ {1, 3, 4} at level 0 */
export function TourBlock() {
  const { tour, setTour } = useSpace();
  if (!tour) return null;
  return (
    <div className="tour-block" role="region" aria-label="Kurze Einführung">
      <span className="pill">Kurz gezeigt · {tour} von 4</span>
      <div className="tour-row">
        {tour < 4 && (
          <button type="button" className="btn quiet" onClick={() => setTour(null)}>
            Überspringen
          </button>
        )}
        <button type="button" className="btn primary" onClick={() => setTour(tour < 4 ? ((tour + 1) as TourStep) : null)}>
          {tour < 4 ? "Weiter" : "Los geht’s"}
        </button>
      </div>
    </div>
  );
}

/** rendered by Space above the dock: step 2 on Tag, and on a side during step 3 */
export function TourCaption() {
  const { tour, level, place, setTour } = useSpace();
  const show = (tour === 2 && place === "jetzt" && level === 1) || (tour === 3 && place !== "jetzt");
  if (!show) return null;
  return (
    <div className="tour-caption" role="region" aria-label="Kurze Einführung">
      <span className="pill">Kurz gezeigt · {tour} von 4</span>
      <button type="button" className="btn quiet" onClick={() => setTour(null)}>
        Überspringen
      </button>
    </div>
  );
}
