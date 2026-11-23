// Du › Benachrichtigungen (round 3, owner decision 2): which parts the section shows. The final UI check found the
// demo build showing a single line instead of the rows, so «Erinnerungen an Einträge» could not be seen or set there.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notifyParts, NOTIFY_NO_SERVER, remindersOn } from "../src/places/NotificationsSection";

describe("notifyParts", () => {
  it("shows the rows in the demo too, with the server note where the device buttons would be", () => {
    expect(notifyParts(false, true)).toEqual({ rows: true, device: false, note: NOTIFY_NO_SERVER });
    // the demo never asks the browser for anything, so its support does not matter there
    expect(notifyParts(false, false)).toEqual({ rows: true, device: false, note: NOTIFY_NO_SERVER });
  });
  it("with the server: rows and the device part, or one line when the browser cannot receive notifications", () => {
    expect(notifyParts(true, true)).toEqual({ rows: true, device: true, note: null });
    expect(notifyParts(true, false)).toEqual({ rows: false, device: false, note: "Dieser Browser kann keine Benachrichtigungen empfangen." });
  });
  it("keeps «Erinnerungen an Einträge» on unless she switched it off", () => {
    expect(remindersOn({ notify_reminders: undefined })).toBe(true);
    expect(remindersOn({ notify_reminders: true })).toBe(true);
    expect(remindersOn({ notify_reminders: false })).toBe(false);
    for (const t of [NOTIFY_NO_SERVER]) expect(t).not.toMatch(/ß/);
  });
});

describe("the rows at 320 px", () => {
  it("keep a row's name on one line beside the time field", () => {
    const css = readFileSync(new URL("../src/places/places.css", import.meta.url), "utf8");
    expect(css).toContain(".space .du-toggle strong { white-space: nowrap; }");
  });
});
