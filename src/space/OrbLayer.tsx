// The circle's fixed layer. Phase 0: only the docked circle ("Zurück zum Kreis"),
// shown when away from Jetzt; the Portal still sits in NowLevel's orb slot.
// Phase 1 moves the one Portal here (docking, CSS-dot handoff, pause).
import { useSpace } from "./state";

export function OrbLayer() {
  const { place, level, go, goLevel } = useSpace();
  const docked = place !== "jetzt" || level > 0;
  return (
    <div className="orb-layer" data-docked={docked ? "true" : "false"}>
      {docked && (
        <button
          type="button"
          className="orb-dock"
          aria-label="Zurück zum Kreis"
          onClick={async () => {
            await go("jetzt");
            await goLevel(0);
          }}
        >
          <span className="orb-dot" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
