// Text the coach says is read aloud: no emojis, no emoticons. Pure, no imports, so the app
// (e.g. before speech output) and the tests can use it too.

// pictographs (with skin tones, the emoji variation selector, joiners and keycap marks) and
// regional indicators (flags)
const PICTO = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
// ":)", ";-)", ":D", ":P", ":(", "<3", "^^" … standing alone (after a space or at the start, before a
// space, punctuation or the end), so times like "08:00" and words stay untouched
const EMOTICON = /(^|\s)(?:[:;=]-?[)(DPpOo3]+|<3|\^_?\^)(?=$|\s|[.,!?])/g;
// what is held back at the end of a delta: trailing spaces and a possible start of an emoticon
const TAIL = /[ \t]*(?:(?<=^|\s)(?:[:;=]-?[)(DPpOo3]*|<3?|\^_?\^?))?$/;

/** The text without emojis and emoticons; spaces left behind are folded. */
export function stripEmoji(text: string): string {
  return text
    .replace(PICTO, "")
    .replace(EMOTICON, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n");
}

/**
 * The same for a stream of deltas (the coach streams its answer): an emoticon can be split over two
 * deltas (":" then ")"), and a removed emoji leaves a space in front of the next word or full stop.
 * So trailing spaces and a possible emoticon start are held back until the next delta.
 * push() returns what can be sent now, flush() the rest at the end.
 */
export function spokenStream(): { push(delta: string): string; flush(): string } {
  let held = "";
  let last = ""; // the last character sent
  const emit = (s: string) => {
    let t = stripEmoji(s);
    if (last === " " || last === "\n" || last === "") t = t.replace(/^[ \t]+/, "");
    if (t) last = t[t.length - 1];
    return t;
  };
  return {
    push(delta: string) {
      const text = held + delta;
      const cut = TAIL.exec(text)?.index ?? text.length;
      // spaces left at the end once an emoji is gone wait as well ("Super 😊" then "!")
      const ready = stripEmoji(text.slice(0, cut));
      const spaces = /[ \t]+$/.exec(ready);
      held = (spaces ? spaces[0] : "") + text.slice(cut);
      return emit(spaces ? ready.slice(0, spaces.index) : ready);
    },
    flush() {
      const rest = held;
      held = "";
      return rest ? emit(rest).replace(/[ \t]+$/, "") : "";
    },
  };
}
