// Speech-to-text via the browser's Web Speech API (Chrome, Edge, Safari).
// Not every browser has it; the mic button hides itself when unavailable.

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

function getCtor(): Ctor | null {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => getCtor() !== null;

export interface Listener {
  stop(): void;
}

export function listen(opts: {
  /** false = stops by itself after a pause (default true) */
  continuous?: boolean;
  onText: (text: string, final: boolean) => void;
  onEnd: () => void;
  onError: (msg: string) => void;
}): Listener | null {
  const C = getCtor();
  if (!C) return null;
  const rec = new C();
  rec.lang = "de-CH";
  rec.interimResults = true;
  rec.continuous = opts.continuous ?? true;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    opts.onText((finalText + interim).trim(), interim === "");
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") opts.onError("Mikrofon nicht freigegeben.");
    else if (e.error !== "aborted" && e.error !== "no-speech") opts.onError("Spracheingabe hat nicht geklappt.");
  };
  rec.onend = () => opts.onEnd();
  rec.start();
  return { stop: () => rec.stop() };
}
