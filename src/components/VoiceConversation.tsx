import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import type { CoachContext, CoachEvent } from "../lib/types";
import type { OrbState } from "./Portal";
import { pulseOrb } from "../lib/orbSignals";
import { eventWhen } from "../lib/dates";
import { isAudioUnlocked, listenOnce, Speaker, splitSentences, unlockAudio, type ListenHandle } from "../lib/voice";

// The conversation as pure voice: the coach speaks (no text on screen), you
// tap the white button and talk; the app hears when you're done and sends.
// A small keyboard button opens a text field for places where talking won't do.

type Phase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

interface Toast {
  id: number;
  label: string;
  title: string;
  when?: string;
}

interface Props {
  mode: "onboarding" | "checkin";
  thread: string;
  context: () => CoachContext;
  onEvent: (e: CoachEvent) => void;
  onOrbState: (s: OrbState) => void;
  /** Buttons shown under the status (e.g. "Standort freigeben", "Los geht's"). */
  extra?: React.ReactNode;
  /** Round button at the left of the dock (e.g. the menu). */
  leftButton?: React.ReactNode;
}

const STATUS: Record<Phase, string> = {
  idle: "Tippe und sprich",
  listening: "Ich höre zu …",
  transcribing: "Einen Moment …",
  thinking: "Ich denke nach …",
  speaking: "",
};

export function VoiceConversation({ mode, thread, context, onEvent, onOrbState, extra, leftButton }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [locked, setLocked] = useState(!isAudioUnlocked());
  const [lastReply, setLastReply] = useState("");
  const speaker = useRef<Speaker>(null as unknown as Speaker);
  speaker.current ??= new Speaker();
  const listening = useRef<ListenHandle | null>(null);
  const lastMessage = useRef<string | undefined>(undefined);
  const started = useRef<string | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // what the portal shows
  const shown: Phase = speaking ? "speaking" : phase;
  useEffect(() => {
    onOrbState(shown === "speaking" ? "speaking" : shown === "listening" ? "listening" : shown === "idle" ? "idle" : "thinking");
  }, [shown, onOrbState]);

  useEffect(() => {
    const off = speaker.current.onState((s) => setSpeaking(s === "speaking"));
    return () => {
      off();
    };
  }, []);
  useEffect(() => () => (speaker.current.stop(), listening.current?.cancel()), []);

  // Any first tap unlocks sound on iPhone; a waiting greeting then plays.
  useEffect(() => {
    if (!locked) return;
    const unlock = () => unlockAudio().then(() => setLocked(false));
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [locked]);

  const toast = (t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 7000);
  };

  const run = useCallback(
    async (message?: string) => {
      if (!navigator.onLine) {
        setError("Du bist offline. Sobald du wieder Netz hast, können wir weiterreden.");
        lastMessage.current = message;
        return;
      }
      lastMessage.current = message;
      speaker.current.reset();
      setError(null);
      setNote(null);
      setPhase("thinking");
      let buf = "";
      let full = "";
      let first = true;
      try {
        await backend.coach({ mode, thread, message, context: context() }, (e) => {
          if (e.type === "text") {
            buf += e.text;
            full += e.text;
            // first sentence goes out at once (quick start), later ones in larger pieces (smoother voice)
            const [sentences, rest] = splitSentences(buf, first ? 1 : 60);
            if (sentences.length) first = false;
            sentences.forEach((s) => speaker.current.say(s));
            buf = rest;
            if (e.text.trim()) pulseOrb(0.06);
          } else if (e.type === "error") {
            setError(e.message);
          } else if (e.type === "event_created" || e.type === "event_updated") {
            toast({ label: e.type === "event_created" ? "Im Kalender „I am“" : "Termin geändert", title: e.event.title, when: eventWhen(e.event) });
            pulseOrb(0.5);
            onEventRef.current(e);
          } else if (e.type === "event_deleted") {
            toast({ label: "Aus dem Kalender entfernt", title: e.title });
            onEventRef.current(e);
          } else if (e.type !== "done") {
            onEventRef.current(e);
          }
        });
        if (buf.trim()) speaker.current.say(buf);
        if (full.trim()) setLastReply(full.trim());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPhase("idle");
      }
    },
    [mode, thread, context],
  );

  // Open the thread; if it's empty, the coach begins (and speaks after the first tap).
  useEffect(() => {
    let alive = true;
    backend
      .getMessages(thread)
      .then((msgs) => {
        if (!alive) return;
        const lastA = [...msgs].reverse().find((m) => m.role === "assistant" && !m.hidden);
        if (lastA) setLastReply(lastA.content);
        if (msgs.length === 0 && started.current !== thread) {
          started.current = thread;
          run();
        }
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);

  const talk = async () => {
    await unlockAudio();
    setLocked(false);
    if (phase === "listening") {
      listening.current?.finish(); // done talking: send now
      return;
    }
    if (phase === "thinking" || phase === "transcribing") return;
    if (speaker.current.busy) speaker.current.stop(); // interrupt the coach
    setError(null);
    setNote(null);
    setHeard("");
    setPhase("listening");
    const handle = listenOnce({ onPhase: (p) => setPhase(p), onPartial: (t) => setHeard(t) });
    listening.current = handle;
    try {
      const text = await handle.result;
      listening.current = null;
      if (!text) {
        setPhase("idle");
        setNote("Ich habe nichts gehört. Tippe nochmal und sprich.");
        return;
      }
      setHeard(text);
      setTimeout(() => setHeard((h) => (h === text ? "" : h)), 8000);
      await run(text);
    } catch (err) {
      listening.current = null;
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendTyped = async () => {
    const text = input.trim();
    if (!text || phase === "thinking") return;
    await unlockAudio();
    setLocked(false);
    setInput("");
    setHeard(text);
    setTimeout(() => setHeard((h) => (h === text ? "" : h)), 8000);
    await run(text);
  };

  const replay = async () => {
    await unlockAudio();
    setLocked(false);
    speaker.current.reset();
    const [sentences, rest] = splitSentences(lastReply + " ", 60);
    [...sentences, rest].forEach((s) => speaker.current.say(s));
  };

  const status =
    locked && speaking ? "Tippe irgendwo, um mich zu hören" : shown === "speaking" ? "" : note ?? STATUS[shown];

  return (
    <div className="voice">
      <div className="voice-status" aria-live="polite">
        {status && <span className={`voice-status-text ${shown}`}>{status}</span>}
        {heard && <p className="voice-heard">„{heard}“</p>}
        {error && (
          <div className="msg-error" role="alert">
            {error}
            <div>
              <button className="btn ghost retry" onClick={() => run(lastMessage.current)}>
                Nochmal versuchen
              </button>
            </div>
          </div>
        )}
        {!error && shown === "idle" && lastReply && !heard && (
          <button className="link voice-replay" onClick={replay}>
            Nochmal hören
          </button>
        )}
        {shown === "idle" && extra}
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="event-card added">
            <span className="event-card-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="4" y="5" width="16" height="15" rx="3" />
                <path d="M4 10h16M9 3v4M15 3v4" />
              </svg>
            </span>
            <span className="event-card-body">
              <span className="event-card-label">{t.label}</span>
              <span className="event-card-title">{t.title}</span>
              {t.when && <span className="event-card-when">{t.when}</span>}
            </span>
          </div>
        ))}
      </div>

      {typing && (
        <form
          className="dock-pill typed"
          onSubmit={(e) => {
            e.preventDefault();
            sendTyped();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendTyped();
              }
            }}
            rows={1}
            placeholder="Schreib mir, ich antworte mit Stimme"
            aria-label="Nachricht"
            autoFocus
          />
          <button type="submit" className="dock-main small" disabled={!input.trim() || phase === "thinking" || phase === "transcribing"} aria-label="Senden">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      )}

      <div className="dock voice-dock">
        {leftButton ?? <span className="dock-spacer" />}
        <button
          type="button"
          className={`dock-main big ${shown === "listening" ? "listening" : ""}`}
          onClick={talk}
          aria-label={shown === "listening" ? "Fertig gesprochen" : shown === "speaking" ? "Unterbrechen und sprechen" : "Sprechen"}
          disabled={phase === "thinking" || phase === "transcribing"}
        >
          {shown === "listening" ? (
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={`dock-round ${typing ? "active-soft" : ""}`}
          onClick={() => setTyping((t) => !t)}
          aria-label={typing ? "Tastatur schliessen" : "Tippen statt sprechen"}
          aria-pressed={typing}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <rect x="3" y="6" width="18" height="12" rx="3" />
            <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
