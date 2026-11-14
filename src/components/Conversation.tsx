import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import type { ChatMessage, CoachContext, CoachEvent } from "../lib/types";
import { listen, speechSupported, type Listener } from "../lib/speech";
import type { OrbState } from "./Portal";
import { AnimatedText } from "./AnimatedText";
import { pulseOrb, startVoiceLevel } from "../lib/orbSignals";
import { eventWhen } from "../lib/dates";

interface Card {
  kind: "added" | "changed" | "removed";
  title: string;
  when?: string;
}

interface Props {
  mode: "onboarding" | "checkin";
  thread: string;
  context: () => CoachContext;
  onEvent: (e: CoachEvent) => void;
  onOrbState: (s: OrbState) => void;
  /** Extra UI shown under the latest coach message (e.g. "Standort freigeben"). */
  extra?: React.ReactNode;
  /** Optional round button at the left of the dock (e.g. the menu). */
  leftButton?: React.ReactNode;
  disabled?: boolean;
}

export function Conversation({ mode, thread, context, onEvent, onOrbState, extra, leftButton, disabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false); // busy, but no words from the coach yet
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const listener = useRef<Listener | null>(null);
  const stopLevel = useRef<(() => void) | null>(null);
  const [stagger, setStagger] = useState<string | null>(null); // history message whose words roll in
  const [cards, setCards] = useState<Record<string, Card[]>>({}); // calendar notes under a reply
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef<string | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const scrollDown = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));

  const lastRequest = useRef<{ message?: string } | null>(null);

  const run = useCallback(
    async (message?: string, retry = false) => {
      if (!navigator.onLine) {
        setError("Du bist offline. Sobald du wieder Netz hast, kannst du weiterschreiben.");
        lastRequest.current = { message };
        if (message && !retry) setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: message, created_at: new Date().toISOString() }]);
        return;
      }
      lastRequest.current = { message };
      setBusy(true);
      setWaiting(true);
      setError(null);
      onOrbState("thinking");
      const replyId = `r-${Date.now()}`;
      if (message && !retry) {
        setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: message, created_at: new Date().toISOString() }]);
      }
      let gotText = false;
      try {
        await backend.coach({ mode, thread, message, context: context() }, (e) => {
          if (e.type === "text") {
            if (!gotText) {
              gotText = true;
              setWaiting(false);
              onOrbState("speaking");
              setMessages((m) => [...m, { id: replyId, role: "assistant", content: "", created_at: new Date().toISOString() }]);
            }
            setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: x.content + e.text } : x)));
            if (e.text.trim()) pulseOrb(0.14); // the portal flinches with every word
            scrollDown();
          } else if (e.type === "error") {
            setError(e.message);
          } else if (e.type === "event_created" || e.type === "event_updated" || e.type === "event_deleted") {
            const card: Card =
              e.type === "event_deleted"
                ? { kind: "removed", title: e.title }
                : { kind: e.type === "event_created" ? "added" : "changed", title: e.event.title, when: eventWhen(e.event) };
            setCards((c) => ({ ...c, [replyId]: [...(c[replyId] ?? []), card] }));
            pulseOrb(0.5);
            onEventRef.current(e);
          } else if (e.type !== "done") {
            onEventRef.current(e);
          }
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setWaiting(false);
        onOrbState("idle");
        scrollDown();
      }
    },
    [mode, thread, context, onOrbState],
  );

  // Load the thread; if it's empty, the coach opens the conversation.
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    backend
      .getMessages(thread)
      .then((msgs) => {
        if (!alive) return;
        const visible = msgs.filter((m) => !m.hidden);
        setMessages(visible);
        const lastA = [...visible].reverse().find((m) => m.role === "assistant");
        setStagger(lastA?.id ?? null);
        setLoaded(true);
        scrollDown();
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

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    listener.current?.stop();
    setInput("");
    run(text);
  };

  const toggleMic = () => {
    if (listening) {
      listener.current?.stop();
      return;
    }
    const before = input ? input + " " : "";
    listener.current = listen({
      onText: (t) => setInput(before + t),
      onEnd: () => {
        setListening(false);
        onOrbState("idle");
        stopLevel.current?.();
        stopLevel.current = null;
      },
      onError: (msg) => setError(msg),
    });
    if (listener.current) {
      setListening(true);
      onOrbState("listening");
      // let the portal breathe with your voice
      startVoiceLevel().then((stop) => {
        if (listener.current) stopLevel.current = stop;
        else stop();
      });
    }
  };

  useEffect(() => () => stopLevel.current?.(), []);

  const canSpeak = speechSupported();
  const hasText = input.trim().length > 0;

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="conversation">
      <div className="messages" ref={scrollRef} aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            {m.role === "assistant" ? <AnimatedText text={m.content} stagger={m.id === stagger} /> : m.content}
            {cards[m.id]?.map((c, i) => (
              <div key={i} className={`event-card ${c.kind}`}>
                <span className="event-card-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="4" y="5" width="16" height="15" rx="3" />
                    <path d="M4 10h16M9 3v4M15 3v4" />
                  </svg>
                </span>
                <span className="event-card-body">
                  <span className="event-card-label">
                    {c.kind === "added" ? "Im Kalender „I am“" : c.kind === "changed" ? "Termin geändert" : "Aus dem Kalender entfernt"}
                  </span>
                  <span className="event-card-title">{c.title}</span>
                  {c.when && <span className="event-card-when">{c.when}</span>}
                </span>
              </div>
            ))}
            {m.id === lastAssistant?.id && !busy && extra}
          </div>
        ))}
        {waiting && (
          <div className="msg msg-assistant typing" aria-label="Der Coach denkt nach">
            <span />
            <span />
            <span />
          </div>
        )}
        {!loaded && !error && (
          <div className="msg msg-assistant typing">
            <span />
            <span />
            <span />
          </div>
        )}
        {error && (
          <div className="msg-error" role="alert">
            {error}
            {lastRequest.current && !busy && (
              <div>
                <button className="btn ghost retry" onClick={() => run(lastRequest.current?.message, true)}>
                  Nochmal versuchen
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The dock: [round button] [white circle: mic or send] [capsule to write in] */}
      <form
        className="dock"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {leftButton}
        {hasText || !canSpeak ? (
          <button type="submit" className="dock-main" disabled={!hasText || busy || disabled} aria-label="Senden">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className={`dock-main ${listening ? "listening" : ""}`}
            onClick={toggleMic}
            aria-label={listening ? "Spracheingabe beenden" : "Sprechen"}
            aria-pressed={listening}
            disabled={disabled}
          >
            {listening ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <rect x="7" y="7" width="10" height="10" rx="2.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            )}
          </button>
        )}
        <label className="dock-pill">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={listening ? "Ich höre zu …" : "Schreib mir"}
            aria-label="Nachricht"
            disabled={disabled}
          />
          {!hasText && <span className="dock-chevrons" aria-hidden="true">›››</span>}
        </label>
      </form>
    </div>
  );
}
