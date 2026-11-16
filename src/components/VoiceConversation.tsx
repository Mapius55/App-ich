import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import type { CoachContext, CoachEvent, Goal } from "../lib/types";
import type { OrbState } from "./Portal";
import { pulseOrb } from "../lib/orbSignals";
import { eventWhen, minutesLabel, shortDay } from "../lib/dates";
import { dayOf, perWeekLabel } from "../lib/plan";
import { isAudioUnlocked, listenOnce, Speaker, splitSentences, unlockAudio, type ListenHandle } from "../lib/voice";
import * as coachBus from "../space/coachBus";
import { useStill } from "../space/motion";
import { dreamWhen } from "../places/bucket";
import { requestWash } from "../places/fulfilled";
import { targetOf, type Target } from "../space/state";

// The conversation as pure voice: the coach speaks (no text on screen), you
// tap the white button and talk; the app hears when you're done and sends.
// A small keyboard button opens a text field for places where talking won't do.

type Phase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

interface Toast {
  id: number;
  label: string;
  title: string;
  when?: string;
  icon?: "calendar" | "goal" | "check" | "link";
  /** what "Ansehen" opens (space only) */
  target?: Target;
  /** a text button of its own, e.g. "Verbindungen ansehen" (request_connections) */
  open?: { label: string; run(): void };
}

// goal_saved covers new goals (created: true) and changed ones; a step ticked a
// moment ago tells a tick apart from other changes. A goal gets its "Ziel" toast
// once, a step its "Etappe erledigt" once, and further saves of the same goal
// right after (e.g. its steps being added) stay quiet.
const RECENT = 2 * 60 * 1000;
const QUIET = 15 * 1000;
export function goalToast(e: { goal: Goal; created?: boolean; fulfilled?: boolean }, seen: Map<string, number>, now = Date.now()): Omit<Toast, "id"> | null {
  const { goal } = e;
  // a dream that came true in this call (the server says so: with done_date its done_at may lie days
  // back), else one done a moment ago: «Erfüllt» once (the Bucket List washes it in the colour flow)
  const fulfilled = `erfuellt:${goal.id}`;
  const justDone = !!e.fulfilled || (!!goal.done_at && Math.abs(now - Date.parse(goal.done_at)) < RECENT);
  if (goal.kind === "dream" && goal.status === "done" && justDone && !seen.has(fulfilled)) {
    seen.set(fulfilled, now);
    seen.set(goal.id, now);
    return { label: "Erfüllt", title: goal.title, icon: "check" };
  }
  if (e.created && !seen.has(goal.id)) {
    seen.set(goal.id, now);
    if (goal.kind === "dream") return { label: "Auf der Bucket List", title: goal.title, when: dreamWhen(goal.target_date) ?? undefined, icon: "goal" };
    return { label: "Ziel", title: goal.title, when: goal.target_date ? shortDay(goal.target_date) : undefined, icon: "goal" };
  }
  const ticked = goal.milestones.find((m) => m.done_at && now - new Date(m.done_at).getTime() < RECENT && !seen.has(m.id));
  if (ticked) {
    seen.set(ticked.id, now);
    seen.set(goal.id, now);
    return { label: "Etappe erledigt", title: ticked.title, icon: "check" };
  }
  if (now - (seen.get(goal.id) ?? 0) < QUIET) return null;
  seen.set(goal.id, now);
  if (goal.kind === "dream" && goal.status === "done" && goal.memory) return { label: "Erinnerung", title: goal.title, icon: "check" };
  return { label: "Plan aktualisiert", title: goal.title, icon: "goal" };
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
  /** Sent once by itself as soon as the conversation is ready (e.g. "Lass uns meinen Tag planen."). */
  kickoff?: string | null;
  /** Called when the kickoff went out, so it isn't sent again later. */
  onKickoffSent?: () => void;
  /** "layer": the space's single, always-mounted conversation (asks come from coachBus, not kickoff) */
  variant?: "screen" | "layer";
  /** the smaller dock away from Jetzt (mic 56, round 48) */
  compact?: boolean;
  /** while true the greeting and queued asks wait (e.g. during the tour) */
  hold?: boolean;
  /** "untilFirstMessage": "Tippe und sprich" only until the person's first message of the day */
  idleHint?: "always" | "untilFirstMessage";
  /** asked before a toast: true = the change is visible where the person is (it glows instead) */
  suppressToast?(t: Target): boolean;
  /** the toast's "Ansehen" */
  onOpenTarget?(t: Target): void;
  /** something is happening in the status area (phase, heard words, error, toasts) */
  onActivity?(active: boolean): void;
  /** the typed field opened or closed */
  onTyping?(on: boolean): void;
  /** request_connections: a toast with "Verbindungen ansehen" (space only; none when they're already shown) */
  connections?: { shown(): boolean; open(): void };
  /** a turn of the conversation starts ("start"; byPerson: she typed or spoke) or ended ("end") */
  onTurn?(t: "start" | "end", byPerson: boolean): void;
}

const dayOfIso = (iso: string) => dayOf(new Date(iso));

const STATUS: Record<Phase, string> = {
  idle: "Tippe und sprich",
  listening: "Ich höre zu …",
  transcribing: "Einen Moment …",
  thinking: "Ich denke nach …",
  speaking: "",
};

export function VoiceConversation({
  mode,
  thread,
  context,
  onEvent,
  onOrbState,
  extra,
  leftButton,
  kickoff,
  onKickoffSent,
  variant = "screen",
  compact = false,
  hold = false,
  idleHint = "always",
  suppressToast,
  onOpenTarget,
  onActivity,
  onTyping,
  connections,
  onTurn,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toasted = useRef(new Map<string, number>()); // goal and step ids → when they last had a toast
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [locked, setLocked] = useState(!isAudioUnlocked());
  const [lastReply, setLastReply] = useState("");
  // what she said runs over more than one line (on Jetzt it then reaches up to the «Dein Tag» door)
  const heardRef = useRef<HTMLParagraphElement>(null);
  const [heardWraps, setHeardWraps] = useState(false);
  const speaker = useRef<Speaker>(null as unknown as Speaker);
  speaker.current ??= new Speaker();
  const listening = useRef<ListenHandle | null>(null);
  const lastMessage = useRef<string | undefined>(undefined);
  const started = useRef<string | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [ready, setReady] = useState(false); // the thread has been loaded
  const kickoffRef = useRef(kickoff);
  kickoffRef.current = kickoff;
  const kickoffSent = useRef(false);
  const onKickoffSentRef = useRef(onKickoffSent);
  onKickoffSentRef.current = onKickoffSent;
  const layer = variant === "layer";
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const suppressRef = useRef(suppressToast);
  suppressRef.current = suppressToast;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;
  const kickoffRun = useRef(false);
  // the greeting waits while held (layer mode); asks from the space queue here
  const [greetPending, setGreetPending] = useState(false);
  const asks = useRef<string[]>([]);
  const [askTick, setAskTick] = useState(0);
  // has the person said anything today? ("Tippe und sprich" goes after the first message)
  const [spoke, setSpoke] = useState(false);

  // what the portal shows
  const shown: Phase = speaking ? "speaking" : phase;

  useEffect(() => {
    const off = speaker.current.onState((s) => setSpeaking(s === "speaking"));
    return () => {
      off();
    };
  }, []);
  useEffect(() => () => (speaker.current.stop(), listening.current?.cancel()), []);

  // Any first tap unlocks sound on iPhone; a waiting greeting then plays. Every tap tries again until
  // it has worked: a first try that never settles (no user activation yet) must not leave it locked.
  useEffect(() => {
    if (!locked) return;
    const unlock = () => unlockAudio().then(() => setLocked(false));
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, [locked]);

  // What the screen shows of the conversation: in the space it waits while the column moves (a status
  // line, a toast or «Nochmal hören» coming or going under the finger is a layout change: motion.ts).
  // The typed form stays live (snap is off while typing).
  const idleText = idleHint === "always" || !spoke ? STATUS.idle : "";
  const view = {
    shown,
    phase,
    status: locked && speaking ? "Tippe irgendwo, um mich zu hören" : shown === "speaking" ? "" : (note ?? (shown === "idle" ? idleText : STATUS[shown])),
    heard,
    error,
    note,
    replay: !error && shown === "idle" && !!lastReply && !heard,
    toasts,
    typing,
  };
  const v = useStill(view);
  useEffect(() => {
    onOrbState(v.shown === "speaking" ? "speaking" : v.shown === "listening" ? "listening" : v.shown === "idle" ? "idle" : "thinking");
  }, [v.shown, onOrbState]);

  // one line of what she said fits under the door on Jetzt; a longer one is marked (data-wraps)
  const hasHeard = !!v.heard;
  useLayoutEffect(() => {
    const el = heardRef.current;
    if (!el) {
      setHeardWraps(false);
      return;
    }
    const check = () => {
      const cs = getComputedStyle(el);
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      setHeardWraps(el.offsetHeight > line * 1.5);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasHeard]);

  const toast = (t: Omit<Toast, "id">) => {
    // the space: a change already visible where the person is glows instead of toasting
    if (t.target && suppressRef.current?.(t.target)) return;
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
      const byPerson = !!message && !kickoffRun.current;
      kickoffRun.current = false;
      onTurnRef.current?.("start", byPerson);
      // the person spoke first (e.g. during the tour): a held greeting no longer fits
      if (message) {
        setSpoke(true);
        setGreetPending(false);
      }
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
            toast({ label: e.type === "event_created" ? "Im Kalender „Bucket List“" : "Termin geändert", title: e.event.title, when: eventWhen(e.event), target: targetOf(e, dayOfIso) ?? undefined });
            pulseOrb(0.5);
            onEventRef.current(e);
          } else if (e.type === "event_deleted") {
            toast({ label: "Aus dem Kalender entfernt", title: e.title });
            onEventRef.current(e);
          } else if (e.type === "goal_saved") {
            // before the plan data changes: the Bucket List washes it once, also when it is in view already
            if (e.fulfilled && e.goal.kind === "dream" && e.goal.status === "done") requestWash(e.goal.id);
            const t = goalToast(e, toasted.current);
            if (t) toast({ ...t, target: targetOf(e, dayOfIso) ?? undefined });
            pulseOrb(0.4);
            onEventRef.current(e);
          } else if (e.type === "time_logged") {
            // the goal_saved that follows for the same goal needs no second toast
            toasted.current.set(e.goal_id, Date.now());
            if (e.minutes > 0) {
              toast({ label: `+${minutesLabel(e.minutes)}`, title: e.title, icon: "check", target: targetOf(e, dayOfIso) ?? undefined });
              pulseOrb(0.4);
            }
            onEventRef.current(e);
          } else if (e.type === "goal_deleted") {
            toast({ label: "Ziel entfernt", title: e.title, icon: "goal" });
            onEventRef.current(e);
          } else if (e.type === "habit_saved") {
            toast({ label: "Gewohnheit", title: e.habit.title, when: perWeekLabel(e.habit.per_week), icon: "check", target: targetOf(e, dayOfIso) ?? undefined });
            pulseOrb(0.4);
            onEventRef.current(e);
          } else if (e.type === "habit_logged") {
            toast({ label: e.done ? "Abgehakt" : "Wieder offen", title: e.title, icon: "check", target: targetOf(e, dayOfIso) ?? undefined });
            if (e.done) pulseOrb(0.4);
            onEventRef.current(e);
          } else if (e.type === "request_connections") {
            const c = connectionsRef.current;
            if (c && !c.shown()) toast({ label: "Verbindungen", title: "Was darf ich lesen?", icon: "link", open: { label: "Verbindungen ansehen", run: c.open } });
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
        onTurnRef.current?.("end", byPerson);
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
        setSpoke(msgs.some((m) => m.role === "user" && !m.hidden));
        if (msgs.length === 0 && started.current !== thread) {
          started.current = thread;
          if (layer) {
            // a queued ask opens the day instead of the greeting; a held greeting waits
            if (!asks.current.length) setGreetPending(true);
          } else {
            // with a kickoff waiting, it opens the day instead of the greeting
            const k = kickoffRef.current;
            if (k && !kickoffSent.current) sendKickoff(k);
            else run();
          }
        }
        setReady(true);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);

  const sendKickoff = (text: string) => {
    kickoffSent.current = true;
    onKickoffSentRef.current?.();
    setHeard(text);
    setTimeout(() => setHeard((h) => (h === text ? "" : h)), 8000);
    kickoffRun.current = true;
    run(text);
  };

  // Once the parent cleared the kickoff, a later one may go out.
  useEffect(() => {
    if (!kickoff) kickoffSent.current = false;
  }, [kickoff]);

  // A kickoff goes out once, when the conversation is loaded and quiet.
  useEffect(() => {
    if (layer || !kickoff || kickoffSent.current || !ready || phase !== "idle" || speaking) return;
    sendKickoff(kickoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kickoff, ready, phase, speaking]);

  // Layer mode: asks from anywhere in the space ("Mit dem Coach planen") queue here
  useEffect(() => {
    if (!layer) return;
    return coachBus.onAsk((text) => {
      asks.current.push(text);
      setAskTick((n) => n + 1);
    });
  }, [layer]);

  // …and go out one at a time once the conversation is loaded, quiet and not held
  useEffect(() => {
    if (!layer || !ready || hold || phase !== "idle" || speaking) return;
    if (asks.current.length) {
      setGreetPending(false);
      sendKickoff(asks.current.shift()!);
    } else if (greetPending) {
      setGreetPending(false);
      if (!spoke) run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, askTick, ready, hold, phase, speaking, greetPending, spoke]);

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

  const activity = v.shown !== "idle" || !!v.heard || !!v.error || !!v.note || v.toasts.length > 0;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  useEffect(() => {
    onActivityRef.current?.(activity);
  }, [activity]);
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;
  useEffect(() => {
    onTypingRef.current?.(typing);
  }, [typing]);

  return (
    <div className={`voice${layer ? " layer" : ""}${compact ? " compact" : ""}`} data-phase={v.shown} data-typed={typing || undefined}>
      <div className="voice-status" aria-live="polite">
        {v.status && <span className={`voice-status-text ${v.shown}${!v.note && v.shown === "idle" ? " idle-hint" : ""}`}>{v.status}</span>}
        {v.heard && (
          <p ref={heardRef} className="voice-heard" data-wraps={heardWraps || undefined}>
            „{v.heard}“
          </p>
        )}
        {v.error && (
          <div className="msg-error" role="alert">
            {v.error}
            <div>
              <button className="btn ghost retry" onClick={() => run(lastMessage.current)}>
                Nochmal versuchen
              </button>
            </div>
          </div>
        )}
        {v.replay && (
          <button className="link voice-replay" onClick={replay}>
            Nochmal hören
          </button>
        )}
        {v.shown === "idle" && extra}
      </div>

      <div className="toasts" aria-live="polite">
        {v.toasts.map((t) => (
          <div key={t.id} className="event-card added">
            <span className="event-card-icon" aria-hidden="true">
              {t.icon === "check" ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.2 4.2L19 7" />
                </svg>
              ) : t.icon === "link" ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                </svg>
              ) : t.icon === "goal" ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="4" y="5" width="16" height="15" rx="3" />
                  <path d="M4 10h16M9 3v4M15 3v4" />
                </svg>
              )}
            </span>
            <span className="event-card-body">
              <span className="event-card-label">{t.label}</span>
              <span className="event-card-title">{t.title}</span>
              {t.when && <span className="event-card-when">{t.when}</span>}
            </span>
            {t.target && onOpenTarget && (
              <button
                type="button"
                className="event-card-open"
                onClick={() => {
                  const target = t.target!;
                  setToasts((xs) => xs.filter((x) => x.id !== t.id));
                  onOpenTarget(target);
                }}
              >
                Ansehen
              </button>
            )}
            {t.open && (
              <button
                type="button"
                className="event-card-open"
                onClick={() => {
                  const open = t.open!;
                  setToasts((xs) => xs.filter((x) => x.id !== t.id));
                  open.run();
                }}
              >
                {t.open.label}
              </button>
            )}
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
          className={`dock-main big ${v.shown === "listening" ? "listening" : ""}`}
          onClick={talk}
          aria-label={v.shown === "listening" ? "Fertig gesprochen" : v.shown === "speaking" ? "Unterbrechen und sprechen" : "Sprechen"}
          disabled={v.phase === "thinking" || v.phase === "transcribing"}
        >
          {v.shown === "listening" ? (
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
          className={`dock-round ${v.typing ? "active-soft" : ""}`}
          onClick={() => setTyping((t) => !t)}
          aria-label={v.typing ? "Tastatur schliessen" : "Tippen statt sprechen"}
          aria-pressed={v.typing}
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
