// Messages for the coach from anywhere in the space ("Mit dem Coach planen"), and the tap on the circle.
// The single VoiceConversation subscribes and sends each one once it is ready and
// quiet; asks made before it subscribed wait here and are handed over on subscribe.

type Listener = (text: string) => void;
const listeners = new Set<Listener>();
let pending: string[] = [];

/** queued until the conversation is ready and quiet (the subscriber does the waiting) */
export function ask(text: string): void {
  const t = text.trim();
  if (!t) return;
  if (listeners.size) listeners.forEach((fn) => fn(t));
  else pending.push(t);
}

export function onAsk(fn: Listener): () => void {
  listeners.add(fn);
  if (pending.length) {
    const queued = pending;
    pending = [];
    queued.forEach(fn);
  }
  return () => {
    listeners.delete(fn);
  };
}

// A deliberate tap on the circle (or its hint): the coach's voice may start. Sound only when she
// wants it: never from any tap anywhere, never from a swipe.
const hearers = new Set<() => void>();

export function hear(): void {
  hearers.forEach((fn) => fn());
}

export function onHear(fn: () => void): () => void {
  hearers.add(fn);
  return () => {
    hearers.delete(fn);
  };
}
