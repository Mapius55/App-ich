// Voice in and out for the coach.
//
// OUT (Speaker): the coach's reply arrives as streamed text; complete sentences
// are sent to the server (ElevenLabs) as they come, the audio is played in order
// through one AudioContext. The output level drives the portal while it speaks.
// Without a server voice it falls back to the phone's own speech synthesis.
//
// IN (listenOnce): tap once, speak; the app notices when you're done (a short
// pause after speech) and returns the text. With a server voice it records and
// transcribes (ElevenLabs Scribe); otherwise it uses the browser's recognition.

import { backend } from "./backend";
import { voice } from "./orbSignals";
import { listen as browserListen, speechSupported } from "./speech";

// ---------- audio context (iOS only plays sound after a tap has unlocked it)

let ctx: AudioContext | null = null;
let unlockResolve: (() => void) | null = null;
const unlocked = new Promise<void>((r) => (unlockResolve = r));
let unlockedOnce = false;

export function audioContext(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

// iOS: Web Audio follows the ring/silent switch, and after the microphone was on,
// sound may come out of the quiet earpiece. The Audio Session API (Safari 16.4+)
// fixes both: "playback" plays through the speaker even when the phone is silent,
// "play-and-record" while listening.
type SessionType = "playback" | "play-and-record" | "auto";
function setAudioSession(type: SessionType) {
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== type) session.type = type;
  } catch {
    /* not supported */
  }
}

/** iOS may suspend or interrupt the audio context (another app, the lock screen, a call). */
async function ensureRunning(): Promise<boolean> {
  const c = audioContext();
  if (c.state !== "running") await c.resume().catch(() => {});
  return c.state === "running";
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ctx && ctx.state !== "running") {
      setAudioSession("playback");
      void ctx.resume().catch(() => {});
    }
  });
}

/** Call from a deliberate tap (the circle, the hint, the mic, a coach hand-off): never from any tap
    anywhere. Plays a silent sound so iOS allows audio afterwards; every such tap tries again.
    Everything iOS needs inside the tap runs before the first await; the wake-up settles after. */
export async function unlockAudio(): Promise<void> {
  setAudioSession("playback");
  const c = audioContext();
  const resumed = c.state === "suspended" ? c.resume().catch(() => {}) : null;
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, 22050);
  src.connect(c.destination);
  src.start(0);
  // speech synthesis needs its own unlock on iOS
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
  await resumed;
  unlockedOnce = true;
  unlockResolve?.();
}

export function isAudioUnlocked(): boolean {
  return ctx?.state === "running";
}

// ---------- is a real voice available?

let readyCache: Promise<boolean> | null = null;
export function serverVoiceReady(): Promise<boolean> {
  readyCache ??= backend.voiceReady().catch(() => false);
  return readyCache;
}

// ---------- sentence splitting for streamed text

/** Splits off complete sentences; returns [sentences, rest]. */
export function splitSentences(buffer: string, minLength = 1): [string[], string] {
  const out: string[] = [];
  const re = /[^.!?…]*[.!?…]+["“”»«')\]]*(\s+|$)/g;
  let last = 0;
  let pending = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(buffer)) && m[0].length) {
    if (m.index + m[0].length === buffer.length && !/\s$/.test(m[0])) break; // might continue ("z.B." / "3.5")
    pending += m[0];
    last = m.index + m[0].length;
    if (pending.trim().length >= minLength) {
      out.push(pending.trim());
      pending = "";
    }
  }
  return [out, pending + buffer.slice(last)];
}

// ---------- speaker

/** waiting: a reply is ready but waits for a tap (the first tap on iOS, or a held greeting) */
export type SpeakerState = "idle" | "waiting" | "speaking";

export class Speaker {
  /** per sentence: its text and, with the server voice, the decoded audio (null = phone voice) */
  private queue: Promise<{ text: string; buf: AudioBuffer | null } | null>[] = [];
  private playing = false;
  private current: AudioBufferSourceNode | null = null;
  private generation = 0;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private listeners = new Set<(s: SpeakerState) => void>();
  private soundListeners = new Set<() => void>();
  private useServer: boolean | null = null;
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;
  private stateNow: SpeakerState = "idle";
  /** everything said in this reply, for "nochmal hören" */
  spoken: string[] = [];

  onState(l: (s: SpeakerState) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit(s: SpeakerState) {
    this.stateNow = s;
    this.listeners.forEach((l) => l(s));
  }
  get state(): SpeakerState {
    return this.stateNow;
  }

  /** called each time sound really starts (not while a reply waits for a tap): she heard it */
  onSound(l: () => void) {
    this.soundListeners.add(l);
    return () => this.soundListeners.delete(l);
  }
  private sound() {
    this.soundListeners.forEach((l) => l());
  }

  /** The next reply (the greeting) waits for her tap: sound only when she wants it. Only its first
      sentence is fetched before the tap (it starts at once); the rest is fetched once she taps, so an
      unheard greeting costs almost no voice. */
  hold() {
    this.gate ??= new Promise<void>((r) => (this.openGate = r));
  }
  /** a reply is held for her tap (the greeting, also while it is still being written) */
  get held(): boolean {
    return !!this.gate;
  }
  /** Her tap: a held reply plays. */
  release() {
    this.openGate?.();
    this.gate = null;
    this.openGate = null;
  }

  get busy() {
    return this.playing || this.queue.length > 0;
  }

  /** Adds a sentence; fetching starts right away, playing in order. */
  say(text: string) {
    const t = text.trim();
    if (!t) return;
    this.spoken.push(t);
    const gen = this.generation;
    this.queue.push(this.prepare(t, gen, this.spoken.length === 1));
    if (!this.playing) void this.playNext(gen);
  }

  /** first: the reply's first sentence (fetched even while the reply is held) */
  private async prepare(text: string, gen: number, first: boolean): Promise<{ text: string; buf: AudioBuffer | null } | null> {
    if (this.useServer === null) this.useServer = await serverVoiceReady();
    if (gen !== this.generation) return null;
    if (!this.useServer) return { text, buf: null }; // phone voice
    if (!first) {
      // a held reply: the rest is fetched only after her tap; dropped (stop), it fetches nothing
      while (this.gate) await this.gate;
      if (gen !== this.generation) return null;
    }
    try {
      const data = await backend.speak(text);
      if (gen !== this.generation) return null;
      return { text, buf: await audioContext().decodeAudioData(data) };
    } catch (e) {
      console.warn("Stimme nicht verfügbar, nehme Handy-Stimme", e);
      return { text, buf: null };
    }
  }

  private async playNext(gen: number): Promise<void> {
    const next = this.queue.shift();
    if (!next) {
      this.playing = false;
      this.stopMeter();
      this.emit("idle");
      return;
    }
    this.playing = true;
    if (!unlockedOnce || this.gate) {
      this.emit("waiting");
      await unlocked; // wait for the first deliberate tap on iOS
      while (this.gate) await this.gate; // a held reply (the greeting) waits for her tap
      if (gen !== this.generation) return;
    }
    this.emit("speaking");
    const item = await next;
    if (gen !== this.generation) return;
    if (item === null) return this.playNext(gen);
    if (!item.buf) {
      await this.speakWithPhone(item.text);
      if (gen === this.generation) void this.playNext(gen);
      return;
    }
    const c = audioContext();
    // back to the speaker (after the microphone) and wake the context if iOS paused it
    setAudioSession("playback");
    if (!(await ensureRunning())) {
      // can't play the recorded voice right now: let the phone voice try instead
      await this.speakWithPhone(item.text);
      if (gen === this.generation) void this.playNext(gen);
      return;
    }
    if (gen !== this.generation) return;
    if (!this.analyser) {
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(c.destination);
    }
    const src = c.createBufferSource();
    src.buffer = item.buf;
    src.connect(this.analyser);
    src.onended = () => {
      if (this.current === src) this.current = null;
      if (gen === this.generation) void this.playNext(gen);
    };
    this.current = src;
    this.startMeter();
    this.sound();
    src.start();
  }

  private speakWithPhone(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "de-CH";
      const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("de"));
      u.voice = voices.find((v) => /Anna|Helena|Petra|Marlene|Vicki|female/i.test(v.name)) ?? voices[0] ?? null;
      u.rate = 0.98;
      let t = 0;
      const pulse = () => {
        voice.out = 0.35 + 0.25 * Math.abs(Math.sin(t++ / 3));
        raf = requestAnimationFrame(pulse);
      };
      let raf = requestAnimationFrame(pulse);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        clearTimeout(guard);
        voice.out = 0;
        resolve();
      };
      // some phones never report the end of speech: don't hang
      const guard = setTimeout(finish, 2500 + text.length * 85);
      u.onend = u.onerror = finish;
      // heard only once the phone really speaks (iOS may refuse it, or there is no German voice)
      u.onstart = () => this.sound();
      window.speechSynthesis.speak(u);
    });
  }

  private startMeter() {
    if (this.raf || !this.analyser) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    const tick = () => {
      this.analyser!.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      voice.out += (Math.min(1, Math.sqrt(sum / buf.length) * 5) - voice.out) * 0.35;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  private stopMeter() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    voice.out = 0;
  }

  /** Stops speaking immediately and drops what's queued. */
  stop() {
    this.generation++;
    this.queue = [];
    try {
      this.current?.stop();
    } catch {
      /* already stopped */
    }
    this.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.release(); // a held reply is dropped with the rest (its wait ends on the old generation)
    this.playing = false;
    this.stopMeter();
    this.emit("idle");
  }

  /** Starts a new reply (keeps nothing from the previous one). */
  reset() {
    this.stop();
    this.spoken = [];
  }
}

// ---------- listening

export interface ListenHandle {
  /** Resolves with what was said ("" if nothing). */
  result: Promise<string>;
  /** Finish now and send what was heard so far. */
  finish(): void;
  /** Throw away and stop. */
  cancel(): void;
}

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/aac"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) ?? "";
}

/**
 * Records one utterance and stops by itself after a short silence.
 * onPhase reports "listening" → "transcribing".
 */
export function listenOnce(opts: {
  onPhase?: (p: "listening" | "transcribing") => void;
  onPartial?: (text: string) => void;
  silenceMs?: number;
  noSpeechMs?: number;
  maxMs?: number;
}): ListenHandle {
  const silenceMs = opts.silenceMs ?? 1300;
  const noSpeechMs = opts.noSpeechMs ?? 8000;
  const maxMs = opts.maxMs ?? 90000;
  let finishNow: () => void = () => {};
  let cancelled = false;

  const result = (async (): Promise<string> => {
    const server = await serverVoiceReady();
    if (!server && speechSupported()) return browserOnce(opts, (f) => (finishNow = f), () => cancelled);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Dieses Gerät kann hier keine Sprache aufnehmen. Tippe stattdessen auf die Tastatur.");
    }

    setAudioSession("play-and-record");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const c = audioContext();
    if (c.state === "suspended") await c.resume().catch(() => {});
    const source = c.createMediaStreamSource(stream);
    const analyser = c.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    opts.onPhase?.("listening");
    rec.start(250);

    const buf = new Uint8Array(analyser.fftSize);
    const start = performance.now();
    let floor = 0.01;
    let spoke = false;
    let lastVoice = start;

    const done = await new Promise<boolean>((resolve) => {
      finishNow = () => resolve(spoke);
      const tick = () => {
        if (cancelled) return resolve(false);
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (now - start < 350) floor = Math.max(floor * 0.9 + rms * 0.1, 0.004); // learn the room noise
        const threshold = Math.min(0.09, Math.max(0.018, floor * 3));
        voice.level += (Math.min(1, rms * 6) - voice.level) * 0.35;
        if (rms > threshold) {
          spoke = true;
          lastVoice = now;
        }
        if (spoke && now - lastVoice > silenceMs) return resolve(true);
        if (!spoke && now - start > noSpeechMs) return resolve(false);
        if (now - start > maxMs) return resolve(spoke);
        setTimeout(tick, 40);
      };
      tick();
    });

    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }));
      rec.stop();
    });
    stream.getTracks().forEach((t) => t.stop());
    source.disconnect();
    setAudioSession("playback"); // the reply should come from the speaker, not the earpiece
    voice.level = 0;
    if (!done || cancelled) return "";
    opts.onPhase?.("transcribing");
    return backend.transcribe(blob);
  })();

  return {
    result,
    finish: () => finishNow(),
    cancel: () => {
      cancelled = true;
      finishNow();
    },
  };
}

/** Browser speech recognition: ends by itself after a pause. */
function browserOnce(
  opts: { onPhase?: (p: "listening" | "transcribing") => void; onPartial?: (t: string) => void },
  setFinish: (f: () => void) => void,
  isCancelled: () => boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      voice.level = 0;
      resolve(isCancelled() ? "" : text.trim());
    };
    const handle = browserListen({
      continuous: false,
      onText: (t) => {
        text = t;
        voice.level = 0.5;
        opts.onPartial?.(t);
      },
      onEnd: end,
      onError: (msg) => {
        finished = true;
        voice.level = 0;
        reject(new Error(msg));
      },
    });
    if (!handle) return reject(new Error("Spracheingabe ist hier nicht verfügbar."));
    opts.onPhase?.("listening");
    setFinish(() => handle.stop());
  });
}
