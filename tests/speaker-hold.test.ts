// Sound only when she wants it: a greeting is held until her tap (it never plays by itself, not
// even once the sound is unlocked), a reply before the first tap waits for it, and sound counts as
// heard only when it really starts. The phone voice stands in for the server voice here.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/backend", () => ({ backend: { voiceReady: async () => false } }));
vi.mock("../src/lib/speech", () => ({ listen: () => null, speechSupported: () => false }));

const spoken: string[] = [];
const saved: Record<string, unknown> = {};
beforeAll(() => {
  class Ctx {
    state = "suspended";
    destination = {};
    async resume() {
      this.state = "running";
    }
    createBufferSource() {
      return { connect() {}, start() {} };
    }
    createBuffer() {
      return {};
    }
  }
  class Utterance {
    text: string;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(t: string) {
      this.text = t;
    }
  }
  const synth = {
    speak(u: Utterance) {
      if (u.text.trim()) spoken.push(u.text);
      setTimeout(() => u.onend?.(), 1);
    },
    cancel() {},
    getVoices: () => [],
  };
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

describe("Speaker: the greeting waits for her tap", () => {
  it("before the first tap a reply waits; the tap plays it", async () => {
    const { Speaker, unlockAudio } = await import("../src/lib/voice");
    const s = new Speaker();
    const states: string[] = [];
    let sounds = 0;
    s.onState((x) => states.push(x));
    s.onSound(() => sounds++);
    s.say("Guten Morgen, Marius.");
    await tick();
    expect(s.state).toBe("waiting");
    expect(sounds).toBe(0);
    expect(spoken).toEqual([]);
    await unlockAudio(); // her tap on the circle, the hint or the mic
    await tick(30);
    expect(spoken).toEqual(["Guten Morgen, Marius."]);
    expect(sounds).toBe(1);
    expect(states).toEqual(["waiting", "speaking", "idle"]);
  });

  it("a held greeting stays silent although the sound is unlocked, until release()", async () => {
    const { Speaker } = await import("../src/lib/voice");
    spoken.length = 0;
    const s = new Speaker();
    let sounds = 0;
    s.onSound(() => sounds++);
    s.hold();
    expect(s.held).toBe(true);
    s.say("Hoi, Marius.");
    s.say("Wie war der Morgen?");
    await tick(30);
    expect(s.state).toBe("waiting");
    expect(spoken).toEqual([]);
    expect(sounds).toBe(0);
    s.release();
    expect(s.held).toBe(false);
    await tick(40);
    expect(spoken).toEqual(["Hoi, Marius.", "Wie war der Morgen?"]);
    expect(sounds).toBe(2);
    expect(s.state).toBe("idle");
  });

  it("stop() drops a held greeting silently, and the next reply is not held", async () => {
    const { Speaker } = await import("../src/lib/voice");
    spoken.length = 0;
    const s = new Speaker();
    s.hold();
    s.say("Guten Abend.");
    await tick();
    s.stop(); // she tapped the mic: she speaks first
    await tick(20);
    expect(spoken).toEqual([]);
    expect(s.state).toBe("idle");
    expect(s.held).toBe(false);
    s.say("Gern.");
    await tick(30);
    expect(spoken).toEqual(["Gern."]);
  });
});
