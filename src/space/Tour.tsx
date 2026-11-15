// The short tour (§9): four steps, no modal and no dimming. On Jetzt the step block
// takes the greeting's place (TourBlock, rendered by NowLevel); on Tag (step 2) and
// on a side during step 3 a caption floats above the dock (TourCaption, rendered by
// Space, always mounted, so it also moves the tour on when the person does the thing).
// The nudges (lift, ghost dot, ring, pill halos) are A's CSS on html[data-tour].
import { useEffect, useRef } from "react";
import { markTourSeen } from "./flags";
import { useSpace, type TourStep } from "./state";

interface Step {
  serif: string;
  sans: string;
  glyph?: string; // reduced motion: a static hint instead of the nudge
}

const STEPS: Record<TourStep, Step> = {
  1: {
    serif: "Unter dem Kreis liegt deine Zeit.",
    sans: "Wisch nach oben oder tipp auf die Zeile unter dem Kreis. Zuerst kommt dein Tag, dann die Woche, dann das Jahr.",
    glyph: "↑",
  },
  2: {
    serif: "Das ist dein Tag.",
    sans: "Wisch zur Seite für gestern und morgen. Der kleine Kreis oben bringt dich immer zurück zu mir.",
    glyph: "↔",
  },
  3: {
    serif: "Rechts deine Ziele, links du.",
    sans: "Wisch hier beim Kreis zur Seite oder tipp oben auf «Ziele» oder «Du». Bei «Du» findest du, was ich über dich weiss, und deine Einstellungen.",
    glyph: "↔",
  },
  4: {
    serif: "Mehr musst du nicht wissen.",
    sans: "Senkrecht ist Zeit, waagrecht sind Orte. Den Rest machen wir zusammen: Tipp unten auf den grossen Knopf und erzähl mir, wie es dir geht.",
  },
};

const ON_SIDE: Step = {
  serif: "Gut so.",
  sans: "Zurück geht’s mit dem kleinen Kreis oben oder mit einem Wisch zur Seite.",
};

function Copy({ step, n, reduced }: { step: Step; n: TourStep; reduced: boolean }) {
  return (
    <>
      <span className="tour-pill">Kurz gezeigt · {n} von 4</span>
      <div className="tour-text" aria-live="polite">
        <p className="tour-serif">{step.serif}</p>
        <p className="tour-sans">
          {reduced && step.glyph && (
            <span className="tour-glyph" aria-hidden="true">
              {step.glyph}
            </span>
          )}
          {step.sans}
        </p>
      </div>
    </>
  );
}

/** the primary button takes the focus at every step (not while a detail is open) */
function useStepFocus(ref: React.RefObject<HTMLButtonElement | null>, key: string) {
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      if (!document.querySelector(".detail-root .unfold")) ref.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(t);
  }, [ref, key]);
}

const end = (setTour: (s: TourStep | null) => void) => {
  markTourSeen();
  setTour(null);
};

/** rendered by NowLevel in place of the greeting when tour ∈ {1, 3, 4} at level 0 */
export function TourBlock() {
  const { tour, setTour, goLevel, reduced } = useSpace();
  const primary = useRef<HTMLButtonElement>(null);
  useStepFocus(primary, String(tour));
  if (tour === null || tour === 2) return null;
  const step = STEPS[tour];
  const action =
    tour === 1 ? { label: "Zeig es mir", run: () => void goLevel(1) } : tour === 3 ? { label: "Weiter", run: () => setTour(4) } : { label: "Los geht’s", run: () => end(setTour) };
  return (
    <div className="tour-block" role="region" aria-label="Kurze Einführung" data-step={tour}>
      <Copy step={step} n={tour} reduced={reduced} />
      <div className="tour-row">
        {tour < 4 && (
          <button type="button" className="tour-skip" onClick={() => end(setTour)}>
            Überspringen
          </button>
        )}
        <button ref={primary} type="button" className="tour-go" onClick={action.run}>
          {action.label}
        </button>
      </div>
    </div>
  );
}

/** rendered by Space above the dock: step 2 on Tag, and on a side during step 3 */
export function TourCaption() {
  const { tour, level, place, detail, setTour, goLevel, reduced } = useSpace();
  const primary = useRef<HTMLButtonElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const visitedSide = useRef(false);

  // the tour follows what the person does
  useEffect(() => {
    if (tour === null) return;
    if (tour !== 3) visitedSide.current = false;
    if (tour === 1 && place === "jetzt" && level >= 1) setTour(2);
    else if (tour === 2 && place === "jetzt" && level === 0) setTour(3);
    else if (tour === 3) {
      if (place !== "jetzt") visitedSide.current = true;
      else if (visitedSide.current && level === 0) setTour(4);
    }
  }, [tour, place, level, setTour]);

  const onTag = tour === 2 && place === "jetzt" && level >= 1;
  const onSide = tour === 3 && place !== "jetzt";
  useStepFocus(onTag ? primary : skip, `${tour}-${place}-${onTag || onSide}`);
  if (detail || !(onTag || onSide)) return null;
  const step = onTag ? STEPS[2] : ON_SIDE;
  return (
    <div className="tour-caption" role="region" aria-label="Kurze Einführung" data-step={tour}>
      <div className="tour-caption-inner">
        <Copy step={step} n={tour} reduced={reduced} />
        <div className="tour-row">
          <button ref={skip} type="button" className="tour-skip" onClick={() => end(setTour)}>
            Überspringen
          </button>
          {onTag && (
            <button ref={primary} type="button" className="tour-go" onClick={() => void goLevel(0)}>
              Zurück zum Kreis
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
