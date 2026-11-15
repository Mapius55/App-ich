import { useCallback, useRef, useState } from "react";
import { type OrbState } from "../components/Portal";
import { FitPortal } from "../components/FitPortal";
import { VoiceConversation } from "../components/VoiceConversation";
import { requestCoords, type Coords } from "../lib/location";
import { isAudioUnlocked } from "../lib/voice";
import type { Palette } from "../lib/palette";
import type { CoachContext, CoachEvent } from "../lib/types";
import { ConnChooser } from "../places/conn/ConnChooser";
import { useWhoopConnect } from "../places/conn/useWhoopConnect";
import "../places/conn/conn.css";

const WHOOP_NEWS = "Ich habe WHOOP verbunden.";

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
  // the coach asked which apps and devices it may read (request_connections)
  const [askConnections, setAskConnections] = useState(false);
  // the newer of the two asks is the one shown
  const [lastAsk, setLastAsk] = useState<"location" | "connections" | null>(null);
  // back from WHOOP: the chooser shows the result and the conversation goes on. After a page
  // load (back from WHOOP's site) the sound is still locked: the coach would wait for a tap with
  // the chooser hidden, so the news waits for "Weiter" (that tap also unlocks the sound).
  const [kickoff, setKickoff] = useState<string | null>(null);
  const [news, setNews] = useState<string | null>(null);
  const whoop = useWhoopConnect("onboarding", (o) => {
    setAskConnections(true);
    setLastAsk("connections");
    if (o !== "ok") return;
    if (isAudioUnlocked()) setKickoff(WHOOP_NEWS);
    else setNews(WHOOP_NEWS);
  });

  // The chooser belongs to the question about apps: it goes once the conversation moves on, when she
  // answers by typing or speaking, or after a reply of the coach that didn't ask again. It stays while
  // WHOOP is being started or confirmed.
  const askedThisTurn = useRef(false);
  const whoopBusy = useRef(whoop.busy);
  whoopBusy.current = whoop.busy;
  const onTurn = useCallback((t: "start" | "end", byPerson: boolean) => {
    if (t === "start") askedThisTurn.current = false;
    if (whoopBusy.current) return;
    if ((t === "start" && byPerson) || (t === "end" && !askedThisTurn.current)) {
      setAskConnections(false);
      setNews(null); // the coach sees WHOOP in its context anyway
    }
  }, []);

  const handle = useCallback(
    (e: CoachEvent) => {
      if (e.type === "request_location") {
        setAskLocation(true);
        setLastAsk("location");
      } else if (e.type === "request_connections") {
        askedThisTurn.current = true;
        setAskConnections(true);
        setLastAsk("connections");
      } else if (e.type === "onboarding_done") setDone(true);
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

  const closeChooser = () => {
    setAskConnections(false);
    if (news) setKickoff(news);
    setNews(null);
  };
  const connectionsUi = askConnections ? <ConnChooser flow={whoop} onClose={closeChooser} /> : null;
  const asked = lastAsk === "connections" ? (connectionsUi ?? locationUi) : (locationUi ?? connectionsUi);

  return (
    <main className="screen onboarding voice-screen">
      <header className="topbar center">
        <span className="pill">Kennenlernen</span>
      </header>
      <FitPortal colors={palette.orb} daylight={palette.daylight} clouds={palette.clouds} speed={palette.speed} seed={palette.seed} state={orbState} min={72} />
      <VoiceConversation
        mode="onboarding"
        thread="onboarding"
        context={context}
        onEvent={handle}
        onOrbState={setOrbState}
        kickoff={kickoff}
        onKickoffSent={() => setKickoff(null)}
        onTurn={onTurn}
        extra={
          done ? (
            <div className="inline-action center">
              <button className="btn primary" onClick={onDone}>
                Los geht’s
              </button>
            </div>
          ) : (
            asked
          )
        }
      />
    </main>
  );
}
