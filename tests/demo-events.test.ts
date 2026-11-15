import { beforeEach, describe, expect, it } from "vitest";
import { DemoBackend, parseDemoEvent } from "../src/lib/demoBackend";
import { dayOf } from "../src/lib/plan";
import type { CoachEvent, CoachRequest } from "../src/lib/types";

const now = new Date(2026, 10, 15, 10, 0); // Sunday 15 Nov 2026, 10:00

describe("demo appointment parser", () => {
  it("understands weekday + time", () => {
    const e = parseDemoEvent("Am Samstag um 9 habe ich ein Rennen", now)!;
    expect(e.title).toBe("Rennen");
    expect(e.allDay).toBe(false);
    expect(e.start.getDay()).toBe(6);
    expect(e.start.getHours()).toBe(9);
    expect(e.start.getDate()).toBe(21);
  });
  it("understands dates and minutes", () => {
    const e = parseDemoEvent("Training am 3.12. um 18:30", now)!;
    expect(e.title).toBe("Training");
    expect([e.start.getDate(), e.start.getMonth(), e.start.getHours(), e.start.getMinutes()]).toEqual([3, 11, 18, 30]);
  });
  it("makes events without time all-day", () => {
    expect(parseDemoEvent("Morgen ist die Prüfung", now)!.allDay).toBe(true);
  });
  it("ignores small talk", () => {
    expect(parseDemoEvent("Mir geht es gut, danke", now)).toBeNull();
  });
});

import { splitSentences } from "../src/lib/voice";

describe("splitting the coach's speech into sentences", () => {
  it("sends complete sentences, keeps the rest", () => {
    const [s, rest] = splitSentences("Hoi Marius. Wie geht es dir heute? Ich", 1);
    expect(s).toEqual(["Hoi Marius.", "Wie geht es dir heute?"]);
    expect(rest).toBe("Ich");
  });
  it("waits when a sentence might go on (z.B., numbers)", () => {
    const [s, rest] = splitSentences("Das Rennen ist am 21.", 1);
    expect(s).toEqual([]);
    expect(rest).toBe("Das Rennen ist am 21.");
  });
  it("groups short sentences into longer pieces", () => {
    const [s] = splitSentences("Gut. Schön. Das freut mich wirklich sehr, erzähl mir mehr davon. ", 30);
    expect(s).toEqual(["Gut. Schön. Das freut mich wirklich sehr, erzähl mir mehr davon."]);
  });
});

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

describe("demo coach: planning from Tag and Woche", () => {
  const ctx: CoachRequest["context"] = { day: dayOf(), localTime: "", timezone: "Europe/Zurich", season: "Herbst", phase: "Tag", hasLocation: false };
  const talk = async (b: DemoBackend, message: string) => {
    const events: CoachEvent[] = [];
    await b.coach({ mode: "checkin", thread: ctx.day, message, context: ctx }, (e) => events.push(e));
    return { events, text: events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("") };
  };

  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });

  it("plans the week (and other days) like the day: no mood, no focus, no entry", async () => {
    const b = new DemoBackend();
    await b.signUp("demo.woche", "geheim1234");
    for (const [message, when] of [
      ["Lass uns meine Woche planen.", "diese Woche"],
      ["Lass uns die Woche vom 23. November planen.", "in der Woche"],
      ["Lass uns den Tag morgen planen.", "morgen"],
      ["Lass uns den Tag am Dienstag, 17. November planen.", "an dem Tag"],
    ] as const) {
      const res = await talk(b, message);
      expect(res.text).toContain(`Was ist ${when} das Wichtigste, und wann hast du Zeit dafür?`);
      expect(res.events.some((e) => e.type === "mood" || e.type === "focus" || e.type === "event_created" || e.type === "goal_saved")).toBe(false);
    }
    expect(await b.getDay(ctx.day)).toBeNull();
    expect(await b.listEvents("2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z")).toEqual([]);
  }, 30000);

  it("points to the goals place for a new goal", async () => {
    const b = new DemoBackend();
    await b.signUp("demo.zielort", "geheim1234");
    const res = await talk(b, "Mein Ziel ist der Halbmarathon am 6. Dezember");
    expect(res.text).toContain("Du findest es bei deinen Zielen.");
    expect(res.text).not.toContain("Plan");
  }, 20000);
});
