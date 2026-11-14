import { useCallback, useState } from "react";
import { type OrbState } from "../components/Portal";
import { FitPortal } from "../components/FitPortal";
import { VoiceConversation } from "../components/VoiceConversation";
import { requestCoords, type Coords } from "../lib/location";
import type { Palette } from "../lib/palette";
import type { CoachContext, CoachEvent } from "../lib/types";

interface Props {
  palette: Palette;
  context: () => CoachContext;
  onEvent: (e: CoachEvent) => void;
  onCoords: (c: Coords) => void;
  hasCoords: boolean;
  onDone: () => void;
}

export function Onboarding({ palette, context, onEvent, onCoords, hasCoords, onDone }: Props) {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [askLocation, setAskLocation] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handle = useCallback(
    (e: CoachEvent) => {
      if (e.type === "request_location") setAskLocation(true);
      else if (e.type === "onboarding_done") setDone(true);
      onEvent(e);
    },
    [onEvent],
  );

  const shareLocation = async () => {
    setLocError(null);
    try {
      const c = await requestCoords();
      onCoords(c);
      setAskLocation(false);
    } catch (err) {
      setLocError(err instanceof Error ? err.message : String(err));
    }
  };

  const locationUi =
    askLocation && !hasCoords ? (
      <div className="inline-action">
        <button className="btn ghost" onClick={shareLocation}>
          Standort freigeben
        </button>
        <span className="hint">Damit passen sich die Farben an dein Wetter und deinen Sonnenuntergang an.</span>
        {locError && <span className="hint error">{locError}</span>}
      </div>
    ) : null;

  return (
    <main className="screen onboarding voice-screen">
      <header className="topbar center">
        <span className="pill">Kennenlernen</span>
      </header>
      <FitPortal colors={palette.orb} daylight={palette.daylight} clouds={palette.clouds} speed={palette.speed} seed={palette.seed} state={orbState} />
      <VoiceConversation
        mode="onboarding"
        thread="onboarding"
        context={context}
        onEvent={handle}
        onOrbState={setOrbState}
        extra={
          done ? (
            <div className="inline-action center">
              <button className="btn primary" onClick={onDone}>
                Los geht’s
              </button>
            </div>
          ) : (
            locationUi
          )
        }
      />
    </main>
  );
}
