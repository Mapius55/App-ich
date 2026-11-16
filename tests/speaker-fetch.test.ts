// The server voice costs per sentence: a held greeting fetches only its first sentence before her tap,
// the rest once she taps, and nothing more when it is dropped. The tap's unlock does what iOS needs
// inside the tap (silent sound, speech unlock) before it waits for the audio to wake.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fetched: string[] = [];
vi.mock("../src/lib/backend", () => ({
  backend: {
    voiceReady: async () => true,
    speak: async (text: string) => {
      fetched.push(text);
      return new ArrayBuffer(8);
    },
  },
}));
vi.mock("../src/lib/speech", () => ({ listen: () => null, speechSupported: () => false }));

const played: unknown[] = [];
const unlockSpeaks: string[] = [];
let resumeCalls = 0;
let wake: (() => void) | null = null;
const saved: Record<string, unknown> = {};
beforeAll(() => {
  class Ctx {
    state = "suspended";
    destination = {};
    resume() {
      resumeCalls++;
      return new Promise<void>((r) => {
        wake = () => {
          this.state = "running";
          r();
        };
      });
    }
    createBuffer() {
      return { silent: true };
    }
    createBufferSource() {
      const src = {
        buffer: null as unknown,
        onended: null as (() => void) | null,
        connect() {},
        stop() {},
        start() {
          played.push(src.buffer);
          if (!(src.buffer as { silent?: boolean })?.silent) setTimeout(() => src.onended?.(), 1);
        },
      };
      return src;
    }
    createAnalyser() {
      return { fftSize: 0, connect() {}, getByteTimeDomainData() {} };
    }
    async decodeAudioData() {
      return { voice: true };
    }
  }
  class Utterance {
    text: string;
    volume = 1;
    constructor(t: string) {
      this.text = t;
    }
  }
  const synth = { speak: (u: Utterance) => unlockSpeaks.push(u.text), cancel() {}, getVoices: () => [] };
  for (const k of ["window", "SpeechSynthesisUtterance", "requestAnimationFrame", "cancelAnimationFrame"]) saved[k] = (globalThis as Record<string, unknown>)[k];
  Object.assign(globalThis, {
    window: { AudioContext: Ctx, speechSynthesis: synth },
    SpeechSynthesisUtterance: Utterance,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  });
});
afterAll(() => Object.assign(globalThis, saved));

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const voiced = () => played.filter((b) => (b as { voice?: boolean })?.voice).length;

describe("unlockAudio: inside the tap first", () => {
  it("plays the silent sound and unlocks speech before the audio has woken; replies wait for the wake", async () => {
    const { Speaker, audioContext, unlockAudio } = await import("../src/lib/voice");
    const s = new Speaker();
    s.say("Hoi, Marius."); // before the first tap: waits (and decodes, so the context exists, suspended)
    await tick();
    expect(audioContext().state).toBe("suspended");
    expect(s.state).toBe("waiting");

    const done = unlockAudio(); // her tap: nothing awaited yet
    expect(resumeCalls).toBe(1);
    expect(played).toEqual([{ silent: true }]);
    expect(unlockSpeaks).toEqual([" "]);

    await tick();
    expect(s.state).toBe("waiting"); // the wake has not settled
    expect(voiced()).toBe(0);
    wake!();
    await done;
    await tick(20);
    expect(voiced()).toBe(1);
    expect(s.state).toBe("idle");
  });
});

describe("Speaker: what the server voice fetches", () => {
  it("a held greeting fetches only its first sentence until her tap", async () => {
    const { Speaker } = await import("../src/lib/voice");
    fetched.length = 0;
    played.length = 0;
    const s = new Speaker();
    s.reset();
    s.hold();
    s.say("Guten Morgen, Marius.");
    s.say("Heute steht der lange Lauf an.");
    s.say("Wie fühlen sich die Beine an?");
    await tick(20);
    expect(fetched).toEqual(["Guten Morgen, Marius."]);
    expect(s.state).toBe("waiting");
    expect(voiced()).toBe(0);
    s.release(); // her tap
    await tick(40);
    expect(fetched).toEqual(["Guten Morgen, Marius.", "Heute steht der lange Lauf an.", "Wie fühlen sich die Beine an?"]);
    expect(voiced()).toBe(3);
    expect(s.state).toBe("idle");
  });

  it("a dropped greeting fetches nothing more", async () => {
    const { Speaker } = await import("../src/lib/voice");
    fetched.length = 0;
    const s = new Speaker();
    s.reset();
    s.hold();
    s.say("Guten Abend, Marius.");
    s.say("Wie war dein Tag?");
    await tick(20);
    s.reset(); // she spoke first, or a fresh greeting replaces it
    await tick(20);
    expect(fetched).toEqual(["Guten Abend, Marius."]);
  });

  it("a reply she asked for (not held) fetches every sentence at once", async () => {
    const { Speaker } = await import("../src/lib/voice");
    fetched.length = 0;
    const s = new Speaker();
    s.reset();
    s.say("Gern.");
    s.say("Was ist heute das Wichtigste?");
    await tick(5);
    expect(fetched).toEqual(["Gern.", "Was ist heute das Wichtigste?"]);
  });
});
