import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import type { ChatMessage, CoachContext, CoachEvent } from "../lib/types";
import { listen, speechSupported, type Listener } from "../lib/speech";
import type { OrbState } from "./Sphere";

interface Props {
  mode: "onboarding" | "checkin";
  thread: string;
  context: () => CoachContext;
  onEvent: (e: CoachEvent) => void;
  onOrbState: (s: OrbState) => void;
  /** Extra UI shown under the latest coach message (e.g. "Standort freigeben"). */
  extra?: React.ReactNode;
  disabled?: boolean;
}

export function Conversation({ mode, thread, context, onEvent, onOrbState, extra, disabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false); // busy, but no words from the coach yet
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const listener = useRef<Listener | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef<string | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const scrollDown = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));

  const run = useCallback(
    async (message?: string) => {
      setBusy(true);
      setWaiting(true);
      setError(null);
      onOrbState("thinking");
      const replyId = `r-${Date.now()}`;
      if (message) {
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
            scrollDown();
          } else if (e.type === "error") {
            setError(e.message);
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
      },
      onError: (msg) => setError(msg),
    });
    if (listener.current) {
      setListening(true);
      onOrbState("listening");
    }
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="conversation">
      <div className="messages" ref={scrollRef} aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            {m.content}
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
        {!loaded && !error && <div className="msg msg-assistant typing"><span /><span /><span /></div>}
        {error && (
          <div className="msg-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
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
          placeholder={listening ? "Ich höre zu …" : "Schreib mir …"}
          aria-label="Nachricht"
          disabled={disabled}
        />
        {speechSupported() && (
          <button
            type="button"
            className={`icon-btn ${listening ? "active" : ""}`}
            onClick={toggleMic}
            aria-label={listening ? "Spracheingabe beenden" : "Sprechen"}
            aria-pressed={listening}
            disabled={disabled}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <button type="submit" className="icon-btn send" disabled={!input.trim() || busy || disabled} aria-label="Senden">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}
