// Tiny shared channel between the conversation and the portal:
// every word the coach says gives the portal a small kick, and while you
// speak, your voice level makes it breathe.

type Listener = (strength: number) => void;
const listeners = new Set<Listener>();

export const voice = {
  level: 0, // 0..1 your voice, while the microphone is open
  out: 0, // 0..1 the coach's voice, while it speaks
};

export function pulseOrb(strength = 0.35) {
  listeners.forEach((l) => l(strength));
}

export function onPulse(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// Pressing the circle from outside the Portal (the space's orb slot sits under a
// pointer-transparent Portal): down brings the sky closer, up lets go with a kick.
type PressListener = (down: boolean) => void;
const pressListeners = new Set<PressListener>();

export function pressOrb(down: boolean) {
  pressListeners.forEach((l) => l(down));
}

export function onPress(l: PressListener): () => void {
  pressListeners.add(l);
  return () => pressListeners.delete(l);
}

/** Opens the microphone just to measure loudness. Returns a stop function. */
export async function startVoiceLevel(): Promise<() => void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      voice.level += (Math.min(1, rms * 6) - voice.level) * 0.3;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      voice.level = 0;
    };
  } catch {
    // No level meter (e.g. the browser won't share the mic twice): the portal
    // simply uses its gentle "listening" breathing instead.
    return () => {
      voice.level = 0;
    };
  }
}
