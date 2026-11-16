// A draft that slipped into a reply (live check, 23 November): only the final version reaches her,
// in what is saved (finalVersion) and in what she hears (draftStream). supabase/functions/coach/rules.ts
import { describe, expect, it } from "vitest";
import { spokenStream } from "../supabase/functions/_shared/spoken";
import { draftStream, finalVersion } from "../supabase/functions/coach/rules";

// the reply as it came from the model, word for word
const LEAKED =
  "Guten Mittag, Mira. Bis zum Halbmarathon Zürich im April ist noch gut Zeit. Wie geht es dir heute, und passt dir heute oder morgen ein kurzer Lauf?\n\n" +
  "Das sind zwei Fragen, also nur eine:\n\n" +
  "Guten Mittag, Mira. Bis zum Halbmarathon Zürich im April ist noch gut Zeit, und du bist schon gestartet. Wie läuft dein Montag bis jetzt?";
const FINAL = "Guten Mittag, Mira. Bis zum Halbmarathon Zürich im April ist noch gut Zeit, und du bist schon gestartet. Wie läuft dein Montag bis jetzt?";

/** The stream in small pieces, as the model sends it. */
function streamed(text: string, size: number): string {
  const g = draftStream();
  let out = "";
  for (let i = 0; i < text.length; i += size) out += g.push(text.slice(i, i + size));
  return out + g.flush();
}

describe("finalVersion: only the version meant for her is saved", () => {
  it("the real example: the draft, the remark about it, then the reply", () => {
    expect(finalVersion(LEAKED)).toBe(FINAL);
    // the same with the paragraphs run together
    expect(finalVersion(LEAKED.replace(/\n+/g, " "))).toBe(FINAL);
  });

  it("a greeting that starts the reply again keeps only the last start (two tool rounds, too)", () => {
    expect(finalVersion("Guten Morgen, Mira.\n\nGuten Morgen, Mira. Der Lauf steht heute um 18 Uhr im Kalender.")).toBe("Guten Morgen, Mira. Der Lauf steht heute um 18 Uhr im Kalender.");
    expect(finalVersion("Guten Abend, Mira. Du bist heute gelaufen. Guten Abend, Mira. Schön, dass du heute gelaufen bist.")).toBe("Guten Abend, Mira. Schön, dass du heute gelaufen bist.");
  });

  it("other remarks about the reply, and one with nothing after it", () => {
    expect(finalVersion("Wie war dein Tag, und was steht morgen an?\nKürzer:\nWie war dein Tag?")).toBe("Wie war dein Tag?");
    expect(finalVersion("Guten Morgen, Mira. Wie hast du geschlafen?\n\nNeuer Versuch: Guten Morgen, Mira. Wie war die Nacht?")).toBe("Guten Morgen, Mira. Wie war die Nacht?");
    expect(finalVersion("Guten Morgen, Mira. Wie hast du geschlafen? Das sind zwei Fragen.")).toBe("Guten Morgen, Mira. Wie hast du geschlafen?");
  });

  it("leaves an ordinary reply as it is", () => {
    for (const t of [
      "Guten Morgen, Mira. Du sitzt wohl schon im Zug nach Basel. Wie hast du geschlafen?",
      "Guten Abend, Mira. Du bist heute 40 Minuten gelaufen.\n\nGute Nacht und schlaf gut.",
      "Schön, dass der Tag gut war. Gute Nacht, Mira.",
      "Um 08:00 beginnt die Vorlesung. Kürzer geht es auch: 20 Minuten reichen.",
      "Nur eine Frage: Wie hast du geschlafen?",
      "Der Block steht im Kalender.\n\nWenn es später wird, reichen auch 20 Minuten.",
      "Sag ihr einfach: „Guten Morgen“, und dann schauen wir weiter.",
      // a greeting she could write, after a colon: a quote, not a new start
      "Guten Morgen, Mira. Schreib Anna doch: Guten Morgen, ich komme heute etwas später.",
      "Hallo Mira. Du könntest ihm schreiben: Hallo Marco, am Samstag kann ich leider nicht.",
      // two paragraphs that both start with her name
      "Mira, das klingt nach einem vollen Tag.\n\nMira, magst du heute um 18 Uhr kurz laufen?",
      "",
    ])
      expect(finalVersion(t), t).toBe(t.trim());
  });
});

describe("draftStream: she never hears a remark about the reply", () => {
  it("the real example, in pieces of any size: the remark is not sent", () => {
    for (const size of [1, 3, 7, 16, 400]) {
      const out = streamed(LEAKED, size);
      expect(out, String(size)).not.toContain("zwei Fragen");
      expect(out, String(size)).toBe(LEAKED.replace("Das sind zwei Fragen, also nur eine:\n\n", ""));
    }
  });

  it("everything else goes through unchanged, sentence by sentence", () => {
    for (const t of [
      "Guten Morgen, Mira. Du sitzt wohl schon im Zug nach Basel. Wie hast du geschlafen?",
      "Um 08:00 beginnt die Vorlesung.\n\nWenn es später wird, reichen auch 20 Minuten.",
      `Ein langer Satz ${"und noch mehr ".repeat(30)}am Ende.`,
    ])
      for (const size of [1, 5, 50]) expect(streamed(t, size), t).toBe(t);
  });

  it("behind the emoji filter, as in the coach: the same", () => {
    for (const size of [1, 4, 9, 400]) {
      const spoken = spokenStream();
      const draft = draftStream();
      let out = "";
      // by code points: a delta never splits an emoji
      const chars = Array.from(LEAKED.replace("Mira.", "Mira. 😊"));
      for (let i = 0; i < chars.length; i += size) out += draft.push(spoken.push(chars.slice(i, i + size).join("")));
      out += draft.push(spoken.flush()) + draft.flush();
      expect(out, String(size)).toBe(LEAKED.replace("Das sind zwei Fragen, also nur eine:\n\n", ""));
    }
  });

  it("a greeting goes out whole: the draft before the remark is not heard either", () => {
    for (const size of [1, 7, 400]) {
      const g = draftStream({ whole: true });
      let out = "";
      for (let i = 0; i < LEAKED.length; i += size) out += g.push(LEAKED.slice(i, i + size));
      expect(out, String(size)).toBe("");
      expect(g.flush(), String(size)).toBe(FINAL);
    }
    // an ordinary greeting comes out as it was written
    const g = draftStream({ whole: true });
    g.push("Guten Morgen, Mira. Du sitzt wohl schon im Zug nach Basel. ");
    g.push("Wie hast du geschlafen?");
    expect(g.flush()).toBe("Guten Morgen, Mira. Du sitzt wohl schon im Zug nach Basel. Wie hast du geschlafen?");
    expect(draftStream({ whole: true }).flush()).toBe("");
  });

  it("a sentence waits until it is complete, then goes out", () => {
    const g = draftStream();
    expect(g.push("Guten Mittag, Mira")).toBe("");
    expect(g.push(". Wie")).toBe("Guten Mittag, Mira. ");
    expect(g.push(" läuft dein Montag?")).toBe("");
    expect(g.flush()).toBe("Wie läuft dein Montag?");
  });
});
