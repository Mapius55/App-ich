import { describe, expect, it } from "vitest";
import { parseDemoEvent } from "../src/lib/demoBackend";

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
