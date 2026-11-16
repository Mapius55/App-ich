// The daily coach (build spec round 1): «Morgen in einer Minute», a pause without a word about it, the
// Wochenblick, and the coach defaults («want, not must»). Rules as text, and what the context says.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays } from "../src/lib/plan";
import {
  contextBlock,
  eveningWin,
  followUps,
  MODE_CHECKIN,
  MODE_ONBOARDING,
  MODE_TIDY,
  openerCandidates,
  openerLine,
  overdueLabel,
  PERSONA,
  type ContextGoal,
  type ContextInput,
} from "../supabase/functions/coach/prompt";
import { DREAM_ASK_HOW, goalHints, nextStepHint, REVIEW_NOTES, REVIEW_RESULTS, reviewPatch } from "../supabase/functions/coach/rules";

// Monday, 16 November 2026, 07:40 in Zurich (UTC+1).
const base: ContextInput = {
  day: "2026-11-16",
  localTime: "Montag, 16. November 2026, 07:40",
  timezone: "Europe/Zurich",
  season: "Herbst",
  phase: "Morgendämmerung",
  hasLocation: true,
  now: "2026-11-16T06:40:00Z",
  profile: { display_name: "Mia", location_name: "Bern", summary: null, nature_palette: null },
  memories: [],
  recentDays: [],
};
const race: ContextGoal = {
  id: "g1",
  title: "Halbmarathon Zürich",
  why: null,
  target_date: "2027-04-12",
  status: "active",
  weekly_hours: 4,
  milestones: [
    { id: "m1", title: "15 km am Stück", due_date: "2026-11-10", done_at: null, position: 0 },
    { id: "m2", title: "18 km am Stück", due_date: "2027-01-15", done_at: null, position: 1 },
  ],
};
const lecture = { id: "e1", title: "Vorlesung Statistik", starts_at: "2026-11-16T09:15:00Z", ends_at: "2026-11-16T11:00:00Z", all_day: false, location: null, kind: "termin" };
const ctx = (c: Partial<ContextInput>) => contextBlock({ ...base, ...c });
const section = (out: string, heading: string) => {
  const at = out.indexOf(`## ${heading}`);
  if (at < 0) return "";
  const next = out.indexOf("\n## ", at + 3);
  return out.slice(at, next < 0 ? undefined : next);
};
const prompts = [PERSONA, MODE_ONBOARDING, MODE_CHECKIN, MODE_TIDY].join("\n");
const source = readFileSync(new URL("../supabase/functions/coach/index.ts", import.meta.url), "utf8");
const tools = source.slice(source.indexOf("const TOOLS"), source.indexOf("class ToolInputError"));

describe("want, not must: the coach has no needs", () => {
  const rule = "Kein „du musst“, „du solltest“ oder „vergiss nicht“.";
  it("says it once as a rule, and nowhere else: no «musst», «solltest», «vergiss nicht», «wieder da», «vermisst»", () => {
    expect(PERSONA).toContain("Du hast keine eigenen Bedürfnisse: Du bist nie traurig oder enttäuscht, vermisst sie nicht und drängst sie nicht. " + rule);
    const rest = prompts.replace(rule, "").replace("vermisst sie nicht", "");
    for (const t of [rest, tools]) {
      expect(t).not.toMatch(/\bmusst\b|\bsolltest\b|vergiss nicht|wieder da|\bvermiss|Schön, dass du|lange nicht gesehen/i);
    }
  });

  it("praises the act, not the person; fresh starts only after a pause or her «später»", () => {
    expect(PERSONA).toContain("Lob, was sie getan hat, nicht, wer sie ist: „Du bist heute gelaufen“, nie „Jetzt bist du eine Läuferin“.");
    expect(PERSONA).toContain("Einen Neuanfang („ab Montag“, „nächsten Monat“) schlägst du nur nach einer Pause vor oder wenn sie selbst „später“ sagt, nie für ein Ziel, das gerade läuft.");
  });

  it("a clean goodbye: one sentence, no new question, no «bevor du gehst»", () => {
    expect(PERSONA).toContain("Verabschiedet sie sich („tschüss“, „danke, das wars“), verabschiedest du dich in einem Satz, ohne neue Frage und ohne „bevor du gehst“.");
  });

  it("never lengthens a conversation, and points once to people in her life", () => {
    expect(PERSONA).toContain("Verlängere ein Gespräch nie von dir aus.");
    expect(MODE_CHECKIN).toContain("Steht dort „Begleitung“, sagst du einmal warm, dass es guttun kann, auch mit einem Menschen in ihrem Leben oder einer Fachperson zu reden, und rufst note_offer mit begleitung auf.");
  });

  it("asks about sleep before WHOOP says anything, and still speaks no WHOOP numbers", () => {
    expect(PERSONA).toContain("Wie sie geschlafen hat, fragst du zuerst sie: WHOOP bestätigt höchstens. Fühlt sie sich anders als die Werte, gilt ihr Gefühl");
    expect(PERSONA).toContain("Du sagst sie in Worten statt als Zahl");
  });

  it("never «0 von 3» or «heute noch nicht», in speech or in the context", () => {
    expect(PERSONA).toContain("sag nie „0 von 3“ oder „heute noch nicht“");
    const out = ctx({ habits: [{ id: "h1", title: "Laufen", per_week: 3, goal_id: null, done_days: [] }] });
    expect(out).toContain("- [h1] Laufen · 3× pro Woche\n");
    expect(out).not.toMatch(/0 von 3|heute noch nicht/);
  });
});

describe("the morning in one minute", () => {
  it("one point, one question, the focus set by the coach, at most one block", () => {
    expect(MODE_CHECKIN).toContain("ein konkreter Punkt in einem Halbsatz und eine einzige Frage");
    expect(MODE_CHECKIN).toContain("Der Morgen dauert etwa eine Minute.");
    expect(MODE_CHECKIN).toContain("du fragst nicht eigens nach dem Wichtigsten");
    expect(MODE_CHECKIN).toContain("Dann schlägst du für heute höchstens einen Block vor, zwei nur, wenn sie danach fragt");
    expect(MODE_CHECKIN).toContain("Das Gespräch darf fertig sein, auch wenn nicht alles besprochen ist.");
    // the old fixed sequence is gone
    expect(prompts).not.toContain("ein bis drei Zeitblöcke");
    expect(prompts).not.toContain("Dann sagst du das Wichtigste zuerst");
    expect(prompts).not.toContain("etwas Gesundheitliches oder Schweres von gestern");
    expect(prompts).not.toContain("Wie geht es der Schulter heute?");
  });

  it("blocks always with a day and a clock time, «heute» too, never «diese Woche irgendwann»", () => {
    expect(PERSONA).toContain(
      "Was du vorschlägst, nennt den Tag immer mit der Uhrzeit, auch für heute („heute um 18 Uhr“, „morgen um 7“, „am Dienstag um 12“), wo es zählt auch einen Ort, nie „diese Woche irgendwann“.",
    );
    // the morning's example says «heute» with the time too
    expect(MODE_CHECKIN).toContain("(„Wenn du heute um 17:30 heimkommst, ziehst du gleich die Laufschuhe an?“)");
    expect(prompts).not.toContain("„Wenn du um 17:30 heimkommst");
    expect(PERSONA).not.toContain("hat immer einen Tag („heute“, „morgen“, „am Dienstag“) und eine Uhrzeit");
  });

  it("a block only after a clear yes: «okay, danke» as a closing is none", () => {
    expect(PERSONA).toContain(
      "Anders als Termine trägst du Blöcke erst nach einem klaren Ja ein („ja“, „passt“, „gern“, „trag es ein“); ein „okay, danke“ zum Abschluss ist kein Ja: Dann fragst du kurz nach oder lässt es.",
    );
    expect(MODE_CHECKIN).toContain("Erst nach ihrem klaren Ja trägst du ihn ein: create_event mit kind block");
    expect(PERSONA).not.toContain("trägst du Blöcke erst nach ihrem Ja ein");
  });

  it("writes only what it says: no drafts, no remarks about the reply", () => {
    expect(PERSONA).toContain("- Alles, was du schreibst, wird vorgelesen. Schreib nur, was du sagst: keine Entwürfe, keine Bemerkungen über deine Antwort. Deshalb höchstens drei kurze Sätze");
    // and the server keeps only the final version (rules: finalVersion, draftStream)
    expect(source).toContain("emit(draft.push(spoken.push(delta)))");
    // a greeting (no message) is held whole, so the draft before a remark never goes out
    expect(source).toContain("const draft = draftStream({ whole: !message });");
    expect(source).toContain("const reply = finalVersion(stripEmoji(fullText).trim());");
  });

  it("at most one setup question per conversation, never in the greeting; the connections ask counts too", () => {
    expect(MODE_CHECKIN).toContain(
      "- Einrichtungsfragen: Fehlen bei einem Ziel Etappen, Zieldatum, die Schätzung des Aufwands oder die Zeit pro Woche und sprecht ihr gerade nicht darüber, stellst du von dir aus höchstens eine solche Frage pro Gespräch, nie in der Begrüssung und nicht an vollen oder müden Tagen. Auch die Frage nach Apps und Geräten (unter „Verbindungen“) ist eine Einrichtungsfrage: Pro Gespräch stellst du höchstens eine von allen.",
    );
    expect(MODE_CHECKIN).toContain("nie in der Begrüssung und nur in einem Gespräch ohne andere Einrichtungsfrage: Du fragst, welche Apps oder Geräte sie nutzt");
    expect(MODE_CHECKIN).not.toContain("holst du das bei Gelegenheit nach");
    // the persona's goal rules ask only while a goal is created or talked about, else they point to the cap
    expect(prompts).not.toContain("spätestens in der übernächsten Antwort");
    expect(PERSONA).not.toContain("Legst du ein Ziel an oder steht bei einem „Aufwand noch nicht geschätzt“");
    expect(PERSONA).toContain("Legst du ein Ziel an, oder sprecht ihr über ein Ziel mit „Aufwand noch nicht geschätzt“, schätzt du den gesamten Aufwand");
    expect(PERSONA).toContain("schlägst du, wenn ihr es anlegt oder darüber sprecht, in einem einzigen Satz zwei bis vier Etappen mit Monat vor");
    expect(PERSONA.match(/nur als Einrichtungsfrage nach \(höchstens eine pro Gespräch\)/g)).toHaveLength(2);
  });

  it("the greeting asks only when the opener has a question; the evening plans only for the Wochenblick", () => {
    expect(MODE_CHECKIN).toContain("ein konkreter Punkt in einem Halbsatz und eine einzige Frage, ausser die Eröffnung sagt „ohne Frage“.");
    expect(MODE_CHECKIN).toContain("- Am Abend schaust du zurück, statt zu planen, ausser beim Wochenblick.");
  });

  it("the opener is chosen in code and stands in the context only for the greeting", () => {
    expect(source).toContain("chooseOpener(");
    expect(source).toContain('upsert({ user_id: userId, day: context.day, opener: kind }, { onConflict: "user_id,day" })');
    expect(ctx({})).not.toContain("## Eröffnung");
    expect(ctx({ opener: "schlaf" })).toContain("## Eröffnung (nur für die Begrüssung)\nDer Schlaf: frag, wie sie geschlafen hat\n");
  });

  it("knows which openers have something to say today", () => {
    expect(openerCandidates(base)).toEqual(["schlaf", "jahreszeit"]);
    expect(openerCandidates({ ...base, events: [lecture], goals: [race] })).toEqual(["termin", "ziel", "schlaf", "jahreszeit"]);
    // an entry later than four hours from now is not «bald»
    expect(openerCandidates({ ...base, events: [{ ...lecture, starts_at: "2026-11-16T15:00:00Z", ends_at: "2026-11-16T16:00:00Z" }] })).not.toContain("termin");
    // the last conversation two days back with her own words, or something to ask about once
    expect(openerCandidates({ ...base, lastTalk: { day: "2026-11-14", messages: [{ role: "user", content: "Morgen ist der Lauf." }] } })).toContain("gestern");
    expect(openerCandidates({ ...base, lastTalk: { day: "2026-11-14", messages: [{ role: "assistant", content: "Guten Morgen." }] } })).not.toContain("gestern");
    expect(openerCandidates({ ...base, lastTalk: { day: "2026-11-12", messages: [{ role: "user", content: "Hallo" }] } })).not.toContain("gestern");
    expect(openerCandidates({ ...base, memories: [{ id: "x1", category: "termin", event_date: "2026-11-14", content: "Läuft den Greifenseelauf." }] })).toContain("gestern");
  });

  it("says what the greeting picks up", () => {
    const c = { ...base, events: [lecture], goals: [race], memories: [{ id: "x1", category: "termin", event_date: "2026-11-14", content: "Läuft den Greifenseelauf." }] };
    expect(openerLine("termin", c)).toBe("Bald im Kalender: „Vorlesung Statistik“ um 10:15");
    expect(openerLine("gestern", c)).toBe("Aus dem letzten Gespräch: „Läuft den Greifenseelauf.“ (siehe „Zum Nachfragen“)");
    expect(openerLine("ziel", c)).toBe("Ein Ziel: „Halbmarathon Zürich“, als Nächstes „15 km am Stück“");
    expect(openerLine("jahreszeit", c)).toBe("Die Jahreszeit, das Licht oder das Wetter draussen (siehe „Jetzt“)");
    // from the excerpt: only what she said or agreed to, never a proposal she didn't take
    expect(openerLine("gestern", { ...base, lastTalk: { day: "2026-11-15", messages: [{ role: "user", content: "Morgen ist der Lauf." }] } })).toBe(
      "Aus dem letzten Gespräch: etwas, das sie selbst gesagt oder zugesagt hat (siehe „Letztes Gespräch“), nie ein Vorschlag von dir, zu dem sie nicht Ja gesagt hat",
    );
  });
});

describe("after a pause: as always, a small step", () => {
  it("the rule: never the gap, warm as any day, one small concrete restart, or how she is", () => {
    expect(MODE_CHECKIN).toContain("Wie lange sie nicht da war, sprichst du nie an: kein Lob fürs Wiederkommen, keine Zahl von Tagen, nichts, was liegen geblieben ist.");
    expect(MODE_CHECKIN).toContain("begrüsst du sie warm, passend zur Tageszeit und mit ihrem Namen, wie an jedem Tag");
    expect(MODE_CHECKIN).toContain("bietest du genau einen kleinen, konkreten Schritt an, eine kleinere Version, heute oder morgen mit Uhrzeit. Wirkt sie bedrückt, fragst du stattdessen, wie es ihr geht, und lässt die Ziele weg.");
  });

  it("the context names the last conversation, and a pause without a number of days", () => {
    expect(ctx({ lastSeen: "2026-11-13" })).toContain("Standort freigegeben: ja.\nLetztes Gespräch: Fr., 13. Nov.\n");
    expect(ctx({ lastSeen: "2026-11-15" })).toContain("Letztes Gespräch: So., 15. Nov. (gestern)\n");
    const paused = ctx({ lastSeen: "2026-11-07" });
    expect(paused).toContain("Letztes Gespräch: Sa., 7. Nov. · danach eine Pause (sprich sie nie an)\n");
    expect(paused).not.toMatch(/vor \d+ Tagen|9 Tage/);
    expect(ctx({ lastSeen: null })).toContain("Letztes Gespräch: bisher nur das Kennenlernen\n");
    expect(ctx({})).not.toContain("Letztes Gespräch:");
  });

  const pastBlock = (id: string, start: string, end: string) => ({ id, title: "Lauf", starts_at: start, ends_at: end, all_day: false, location: null, kind: "block", goal_id: "g1" });
  // a pause from 9 November: blocks on Tuesday and Thursday nobody answered, a step overdue for 6 days
  const missed = [pastBlock("b1", "2026-11-10T17:00:00Z", "2026-11-10T18:00:00Z"), pastBlock("b2", "2026-11-12T17:00:00Z", "2026-11-12T18:00:00Z")];

  it("never lists what was missed: no past blocks and no «überfällig» after a pause", () => {
    const out = ctx({ opener: "neustart", lastSeen: "2026-11-09", goals: [race], pastBlocks: missed });
    expect(out).not.toContain("Vergangene Blöcke ohne Rückmeldung");
    expect(out).not.toMatch(/Di\., 10\. Nov\.|Do\., 12\. Nov\./);
    expect(out).not.toContain("überfällig");
    expect(out).toContain("  - [m1] offen, als Nächstes: 15 km am Stück · bis 2026-11-10\n");
    // the restart still knows her usual block length
    expect(section(out, "Eröffnung")).toContain("Neustart: ein kleiner Schritt für „Halbmarathon Zürich“, etwa 30 Minuten, heute oder morgen mit Uhrzeit");
    expect(MODE_CHECKIN).toContain("Nach einer Pause fragst du weder nach vergangenen Blöcken noch nach überfälligen Etappen.");
  });

  it("the day after the restart: only blocks since the last conversation, never the ones from the pause", () => {
    // back on Sunday 15 November after the pause; today is Monday, a block on Sunday evening
    const sunday = pastBlock("b3", "2026-11-15T17:00:00Z", "2026-11-15T18:00:00Z");
    const out = ctx({ lastSeen: "2026-11-15", goals: [race], pastBlocks: [...missed, sunday] });
    expect(section(out, "Vergangene Blöcke ohne Rückmeldung")).toBe(
      "## Vergangene Blöcke ohne Rückmeldung ([id] Zeit: Titel (Ziel) · zählen eine Woche lang vorläufig)\n- [b3] So., 15. Nov. (gestern), 18:00–19:00: Lauf (Ziel „Halbmarathon Zürich“)",
    );
    // no pause: an overdue step is asked about once again
    expect(out).toContain("· überfällig seit 6 Tagen");
    // without a known last conversation (not the daily conversation): all of them, as before
    expect(section(ctx({ goals: [race], pastBlocks: missed }), "Vergangene Blöcke ohne Rückmeldung")).toContain("- [b1] Di., 10. Nov.");
  });

  it("the restart: one goal, a smaller version with minutes, today or tomorrow; quiet when it was heavy", () => {
    const block = { id: "b1", title: "Lauf", starts_at: "2026-11-04T17:00:00Z", ends_at: "2026-11-04T18:00:00Z", all_day: false, location: null, kind: "block", goal_id: "g1" };
    expect(openerLine("neustart", { ...base, goals: [race], events: [block] })).toBe("Neustart: ein kleiner Schritt für „Halbmarathon Zürich“, etwa 30 Minuten, heute oder morgen mit Uhrzeit");
    expect(openerLine("neustart", base)).toBe("Neustart: warm begrüssen und eine kleine Sache für heute anbieten");
    const heavy = { ...base, goals: [race], recentDays: [{ day: "2026-11-06", mood: { valence: -0.6 }, focus: null }, { day: "2026-11-05", mood: { valence: -0.7 }, focus: null }], today: { mood: { valence: -0.5 }, focus: null } };
    expect(openerLine("neustart", heavy)).toBe("Neustart, leise: begrüss sie wie an jedem Tag (kein „schön, dass du da bist“) und frag nur, wie es ihr geht, ohne Ziele");
  });

  it("quiet at the first greeting after a pause when the days before it were heavy, from the stored moods alone", () => {
    // last conversation on Friday 6 November, back on Monday 16: nothing stored today, nothing in the pause
    const before = (vals: number[]) => vals.map((valence, i) => ({ day: addDays("2026-11-06", -i), mood: { valence }, focus: null }));
    const after = { ...base, goals: [race], lastSeen: "2026-11-06", today: null };
    expect(openerLine("neustart", { ...after, recentDays: before([-0.6, -0.5, 0.2]) })).toBe("Neustart, leise: begrüss sie wie an jedem Tag (kein „schön, dass du da bist“) und frag nur, wie es ihr geht, ohne Ziele");
    expect(section(ctx({ ...after, opener: "neustart", recentDays: before([-0.6, -0.5]) }), "Eröffnung")).toContain("Neustart, leise:");
    // light days before the pause: the small restart as always
    expect(openerLine("neustart", { ...after, recentDays: before([0.3, -0.5, 0.4]) })).toBe(
      "Neustart: ein kleiner Schritt für „Halbmarathon Zürich“, etwa 40 Minuten, heute oder morgen mit Uhrzeit",
    );
    // without a pause, days a week back don't make today quiet
    expect(openerLine("abend", { ...after, lastSeen: "2026-11-15", recentDays: before([-0.6, -0.5]) })).not.toContain("leise");
  });
});

describe("the evening: a small win, then good night", () => {
  const evening = { ...base, localTime: "Montag, 16. November 2026, 19:10", now: "2026-11-16T18:10:00Z" };
  it("names one thing that really happened, a question only some evenings, care on a heavy day", () => {
    expect(MODE_CHECKIN).toContain("nennst du in einem Halbsatz genau die eine Sache von heute, die dort steht, nicht mehr und nie ein allgemeines Lob; steht dort keine, sagst du etwas Ruhiges zum Abend");
    expect(MODE_CHECKIN).toContain("Eine Frage stellst du nur, wenn dort „mit Frage“ steht");
    expect(MODE_CHECKIN).toContain("Steht dort „leise“, nennst du nichts Geschafftes und fragst nur, wie der Tag für sie war.");
    // nothing confirmed today: nothing to name, something calm
    expect(openerLine("abend_frage", evening)).toBe("Abend: zurückschauen, heute nichts zum Nennen: etwas Ruhiges zum Abend, mit Frage");
    expect(openerLine("abend", evening)).toBe("Abend: zurückschauen, heute nichts zum Nennen: etwas Ruhiges zum Abend, ohne Frage");
    expect(openerLine("abend", { ...evening, today: { mood: { valence: -0.6 }, focus: null } })).toBe("Abend, leise: nichts Geschafftes nennen, nur fragen, wie der Tag für sie war");
  });

  it("the greeting names one win, chosen in code, even when there are several", () => {
    const goals = [{ ...race, milestones: [{ ...race.milestones[0], done_at: "2026-11-16T16:00:00Z" }, race.milestones[1]] }];
    const habits = [{ id: "h1", title: "Dehnen", per_week: 7, goal_id: null, done_days: ["2026-11-16"] }];
    const all = { ...evening, goals, habits, todayLog: [{ goal_id: "g1", minutes: 75 }] };
    // a step done comes first
    expect(openerLine("abend_frage", all)).toBe("Abend: zurückschauen auf eine einzige Sache von heute, nur diese nennen: Etappe „15 km am Stück“ erledigt („Halbmarathon Zürich“), mit Frage");
    // else the most time for a goal, else a habit
    const two: ContextGoal = { ...race, id: "g2", title: "Italienisch B1", milestones: [] };
    const time = { ...evening, goals: [race, two], habits, todayLog: [{ goal_id: "g1", minutes: 30 }, { goal_id: "g2", minutes: 45 }] };
    expect(eveningWin(time)).toEqual({ kind: "zeit", title: "Italienisch B1", minutes: 45 });
    expect(openerLine("abend", time)).toBe("Abend: zurückschauen auf eine einzige Sache von heute, nur diese nennen: 45 Min für „Italienisch B1“, ohne Frage");
    expect(openerLine("abend", { ...evening, habits })).toBe("Abend: zurückschauen auf eine einzige Sache von heute, nur diese nennen: Gewohnheit „Dehnen“ abgehakt, ohne Frage");
    // the section still has all of them, for later in the conversation
    expect(section(ctx({ ...all, opener: "abend_frage" }), "Heute geschafft").split("\n- ")).toHaveLength(4);
  });

  it("«Heute geschafft» lists only confirmed acts of today, and is absent without any", () => {
    const goals = [{ ...race, milestones: [{ ...race.milestones[0], done_at: "2026-11-16T16:00:00Z" }, race.milestones[1]] }];
    const out = ctx({ ...evening, goals, todayLog: [{ goal_id: "g1", minutes: 75 }], habits: [{ id: "h1", title: "Dehnen", per_week: 7, goal_id: null, done_days: ["2026-11-16"] }] });
    expect(section(out, "Heute geschafft")).toBe(
      "## Heute geschafft (nur Bestätigtes)\n- 1 Std 15 Min für „Halbmarathon Zürich“\n- Etappe „15 km am Stück“ erledigt („Halbmarathon Zürich“)\n- Gewohnheit „Dehnen“ abgehakt\n",
    );
    expect(ctx({ ...evening, goals: [race], todayLog: [] })).not.toContain("Heute geschafft");
    // a planned block alone is no win
    expect(ctx({ ...evening, goals: [race], events: [{ ...lecture, kind: "block", goal_id: "g1", starts_at: "2026-11-16T07:00:00Z", ends_at: "2026-11-16T08:00:00Z" }] })).not.toContain("Heute geschafft");
  });
});

describe("follow-ups: the last conversation within a week, dated notes once, nothing sensitive", () => {
  const memories = [
    { id: "x1", category: "termin", event_date: "2026-11-14", content: "Läuft am Samstag den Greifenseelauf." },
    { id: "x2", category: "termin", event_date: "2026-11-15", content: "Zahnarzt am Sonntag." },
    { id: "x3", category: "termin", event_date: "2026-11-15", content: "Prüfung in Statistik.", followed_up_at: "2026-11-16T06:00:00Z" },
    { id: "x4", category: "termin", event_date: "2026-11-09", content: "Bewerbungsgespräch." },
  ];
  it("lists what to ask about once, and marks what was asked", () => {
    expect(followUps({ memories, day: base.day }).map((m) => m.id)).toEqual(["x1"]);
    const out = ctx({ memories });
    expect(section(out, "Zum Nachfragen")).toBe("## Zum Nachfragen (einmal, dann loslassen; [id] Datum: Inhalt)\n- [x1] 2026-11-14: Läuft am Samstag den Greifenseelauf.\n");
    expect(out).toContain("- [x3] termin · 2026-11-15 · nachgefragt: Prüfung in Statistik.");
    expect(ctx({})).not.toContain("Zum Nachfragen");
  });

  it("the rule: once, then update_memory nachgefragt; never health, relationships, money, legal matters on its own", () => {
    expect(MODE_CHECKIN).toContain("fragst du genau einmal danach, in der Begrüssung, wenn die Eröffnung es nennt, sonst an einer ruhigen Stelle, und rufst dann update_memory mit nachgefragt: true auf");
    expect(MODE_CHECKIN).toContain("Nach Gesundheit, Beziehungen, Geld oder Rechtlichem fragst du nie von dir aus nach.");
    expect(tools).toContain("nachgefragt: { type: \"boolean\"");
  });

  it("the excerpt comes from the last conversation within seven days, not only yesterday", () => {
    expect(source).not.toContain("yesterdayThread");
    expect(source).toContain('.gte("thread", addDays(day, -7)).lt("thread", day).eq("hidden", false)');
    expect(PERSONA).toContain("manchmal einen Auszug aus dem letzten Gespräch");
  });
});

describe("steps: overdue once, the next one after one is done", () => {
  it("marks an overdue step with its days, and only that it was asked once it was", () => {
    expect(overdueLabel({ due_date: "2026-11-10", done_at: null }, "2026-11-16")).toBe("überfällig seit 6 Tagen");
    expect(overdueLabel({ due_date: "2026-11-15", done_at: null }, "2026-11-16")).toBe("überfällig seit 1 Tag");
    expect(overdueLabel({ due_date: "2026-11-10", done_at: null, overdue_asked_for: "2026-11-10" }, "2026-11-16")).toBe("Datum vorbei, schon nachgefragt");
    // a new date that passed again may be asked about again
    expect(overdueLabel({ due_date: "2026-11-12", done_at: null, overdue_asked_for: "2026-11-01" }, "2026-11-16")).toBe("überfällig seit 4 Tagen");
    expect(overdueLabel({ due_date: "2026-11-10", done_at: "2026-11-11T10:00:00Z" }, "2026-11-16")).toBeNull();
    expect(overdueLabel({ due_date: "2026-11-16", done_at: null }, "2026-11-16")).toBeNull();
    expect(ctx({ goals: [race] })).toContain("  - [m1] offen, als Nächstes: 15 km am Stück · bis 2026-11-10 · überfällig seit 6 Tagen\n  - [m2] offen: 18 km am Stück · bis 2027-01-15\n");
    expect(MODE_CHECKIN).toContain("Steht bei einer Etappe „überfällig“, fragst du einmal sanft danach und bietest ein neues Datum oder einen kleineren Schritt an; danach update_milestone mit nachgefragt: true.");
  });

  it("after a step is done: the next one in the same reply", () => {
    expect(PERSONA).toContain("schlägst in derselben Antwort die nächste vor (die Antwort von update_milestone nennt sie)");
    expect(nextStepHint(race.milestones)).toEqual({
      naechste_etappe: { id: "m1", title: "15 km am Stück", due_date: "2026-11-10" },
      naechster_schritt: "In derselben Antwort die nächste Etappe vorschlagen, mit einem Tag und einer Uhrzeit für den ersten Schritt dazu.",
    });
    expect(nextStepHint(race.milestones.map((m) => ({ ...m, done_at: "2026-11-16T10:00:00Z" })))).toEqual({
      naechster_schritt: "Keine Etappe mehr offen: eine nächste vorschlagen oder fragen, ob das Ziel erreicht ist.",
    });
    expect(source).toContain("...(done === true ? nextStepHint(");
  });

  it("a reached goal gets «Wie war es?» once, like a fulfilled dream", () => {
    expect(goalHints({ kind: "goal", status: "done", target_date: "2026-11-01", milestones: [], memory: null }, "2026-11-16")).toEqual({ naechster_schritt: DREAM_ASK_HOW });
    expect(goalHints({ kind: "goal", status: "done", target_date: "2026-11-01", milestones: [], memory: "Ich war so stolz." }, "2026-11-16")).toEqual({});
    expect(PERSONA).toContain("Ist es erreicht, freust du dich kurz mit ihr und fragst einmal „Wie war es?“");
  });
});

describe("the Wochenblick", () => {
  const review = { due: "anbieten" as const, monday: "2026-11-09", goals: [{ goal_id: "g1", planned_minutes: 240, blocks: 3, done_minutes: 150, open_minutes: 60 }] };
  const habits = [{ id: "h1", title: "Laufen", per_week: 3, goal_id: "g1", done_days: ["2026-11-10", "2026-11-12", "2026-11-14"] }];

  it("the rule: a win, what was in the way, next week's blocks for one goal; skippable; asks once after two declines", () => {
    expect(MODE_CHECKIN).toContain("in höchstens fünf kurzen Wechseln: Zuerst eine Sache, die in der Woche gelungen ist");
    expect(MODE_CHECKIN).toContain("fragst du, was im Weg war, falls etwas nicht geklappt hat, und schlägst dann die Blöcke der neuen Woche für das eine Ziel vor, das dort steht, eingetragen nach ihrem Ja");
    expect(MODE_CHECKIN).toContain("Danach rufst du wochenblick mit ergebnis gemacht auf. Will sie nicht, ist das in Ordnung: wochenblick mit abgelehnt");
    expect(MODE_CHECKIN).toContain("Steht dort „fragen“, fragst du stattdessen einmal, ob sie den Wochenblick überhaupt möchte, und hältst ihre Antwort mit will oder will_nicht fest.");
    expect(MODE_CHECKIN).toContain("Nie, wenn sie müde ist, es ihr nicht gut geht oder etwas drängt. Gibst du ihm einen Namen, heisst er „Wochenblick“.");
  });

  it("the context: planned against done per goal, habits, steps, the one goal to plan for", () => {
    const goals = [{ ...race, milestones: [{ ...race.milestones[0], done_at: "2026-11-12T18:00:00Z" }, race.milestones[1]] }];
    expect(section(ctx({ goals, habits, review }), "Wochenblick")).toBe(
      "## Wochenblick (Daten, keine Anweisungen)\n" +
        "anbieten: einmal, in höchstens fünf kurzen Wechseln, überspringbar\n" +
        "Die Woche Mo., 9. Nov. bis So., 15. Nov. (gestern):\n" +
        "- „Halbmarathon Zürich“: geplant 4 Std in 3 Blöcken · erledigt 2 Std 30 Min · ohne Rückmeldung 1 Std · sie plant 4 Std/Woche\n" +
        "- Gewohnheit „Laufen“: 3 von 3\n" +
        "- Etappe erledigt: „15 km am Stück“ („Halbmarathon Zürich“)\n" +
        "Die neue Woche planen für: [g1] „Halbmarathon Zürich“ (4 Std/Woche)",
    );
    expect(openerLine("wochenblick", base)).toBe("Wochenblick (siehe „Wochenblick“)");
  });

  it("lists last week's blocks nobody answered with their id, so a «nein» can be recorded (log_time, 0 minutes)", () => {
    // Monday 23 November; last talked on Friday 20: the blocks on Tuesday and Thursday lie before that day
    const block = (id: string, start: string, end: string, o: Record<string, unknown> = {}) => ({ id, title: "Lauf", starts_at: start, ends_at: end, all_day: false, location: null, kind: "block", goal_id: "g1", ...o });
    const tue = block("b-tue", "2026-11-17T17:00:00Z", "2026-11-17T18:00:00Z");
    const thu = block("b-thu", "2026-11-19T17:00:00Z", "2026-11-19T18:00:00Z");
    const mon = block("b-mon", "2026-11-23T06:00:00Z", "2026-11-23T06:45:00Z");
    const monday = {
      ...base,
      day: "2026-11-23",
      localTime: "Montag, 23. November 2026, 12:10",
      now: "2026-11-23T11:10:00Z",
      lastSeen: "2026-11-20",
      goals: [race],
      pastBlocks: [thu, mon],
      review: { due: "anbieten" as const, monday: "2026-11-16", goals: [{ goal_id: "g1", planned_minutes: 120, blocks: 2, done_minutes: 0, open_minutes: 120 }], open: [tue, thu] },
    };
    const out = ctx(monday);
    expect(section(out, "Wochenblick")).toContain(
      "Blöcke ohne Rückmeldung ([id] Zeit: Titel (Ziel) · für log_time mit event_id):\n" +
        "- [b-tue] Di., 17. Nov., 18:00–19:00: Lauf (Ziel „Halbmarathon Zürich“)\n" +
        "- [b-thu] Do., 19. Nov., 18:00–19:00: Lauf (Ziel „Halbmarathon Zürich“)\n",
    );
    // asked about there, not a second time among the past blocks; today's block stays there
    expect(section(out, "Vergangene Blöcke ohne Rückmeldung")).toBe(
      "## Vergangene Blöcke ohne Rückmeldung ([id] Zeit: Titel (Ziel) · zählen eine Woche lang vorläufig)\n- [b-mon] Mo., 23. Nov. (heute), 07:00–07:45: Lauf (Ziel „Halbmarathon Zürich“)\n",
    );
    // the trainer's plan is never asked about; nothing open, no list
    expect(section(ctx({ ...monday, review: { ...monday.review, open: [{ ...tue, source: "nolio" }] } }), "Wochenblick")).not.toContain("Blöcke ohne Rückmeldung");
    expect(section(ctx({ ...monday, review: { ...monday.review, open: [] } }), "Wochenblick")).not.toContain("Blöcke ohne Rückmeldung");
    // the rule: her answer with log_time and the block's id, a «nein» with 0
    expect(MODE_CHECKIN).toContain(
      "Ihre Antwort hältst du mit log_time und event_id fest, auch zu den Blöcken ohne Rückmeldung beim Wochenblick: die geplante Länge, wenn es wie geplant lief, die tatsächlichen Minuten, wenn es nur teilweise klappte, oder 0, wenn es nicht stattgefunden hat („am Donnerstag nicht gelaufen“).",
    );
    expect(source).toContain("openWeekBlocks(rows, goalIds, monday, new Date(now), dayOf)");
    expect(source).toContain("input.review = { due, monday, ...(await weekSummaryFor(");
  });

  it("is decided from her own last words before today (dailySituation), not from a greeting she never answered", () => {
    // index.ts can't be loaded here (Deno); the decision itself is tested in plan-daily (dailySituation)
    expect(source).toContain("dailySituation({");
    expect(source).toMatch(/select\("thread, created_at"\)\.eq\("role", "user"\)\.eq\("hidden", false\)\.lt\("thread", day\)/);
    expect(source).not.toContain("wochenblickDue(");
  });

  it("a week with blocks planned but nothing confirmed: no win to name, the fallback instead", () => {
    const planned = { due: "anbieten" as const, monday: "2026-11-09", goals: [{ goal_id: "g1", planned_minutes: 180, blocks: 3, done_minutes: 0, open_minutes: 180 }] };
    const out = section(ctx({ goals: [race], review: planned }), "Wochenblick");
    expect(out).toContain("- „Halbmarathon Zürich“: geplant 3 Std in 3 Blöcken · erledigt noch nichts eingetragen (nicht als Gewinn nennen) · ohne Rückmeldung 3 Std · sie plant 4 Std/Woche\n");
    expect(out).toContain("- (nichts Erledigtes eingetragen: frag nach dem, was gut war, und zähl nichts auf, was nicht war)\n");
    expect(out).not.toMatch(/erledigt \d/);
    // one confirmed act is a win: then no fallback
    const habit = [{ id: "h1", title: "Dehnen", per_week: 7, goal_id: null, done_days: ["2026-11-11"] }];
    expect(section(ctx({ goals: [race], habits: habit, review: planned }), "Wochenblick")).not.toContain("nichts Erledigtes eingetragen:");
    const someDone = { ...planned, goals: [{ ...planned.goals[0], done_minutes: 60, open_minutes: 120 }] };
    const withWin = section(ctx({ goals: [race], review: someDone }), "Wochenblick");
    expect(withWin).toContain("erledigt 1 Std · ohne Rückmeldung 2 Std");
    expect(withWin).not.toContain("nichts Erledigtes eingetragen:");
  });

  it("asks instead after two declines; with nothing done it names nothing that wasn't", () => {
    const out = section(ctx({ goals: [race], review: { due: "fragen", monday: "2026-11-09", goals: [] } }), "Wochenblick");
    expect(out).toContain("fragen: Sie hat ihn zweimal nacheinander abgelehnt. Frag einmal, ob sie den Wochenblick überhaupt möchte.");
    expect(out).toContain("- (nichts Erledigtes eingetragen: frag nach dem, was gut war, und zähl nichts auf, was nicht war)");
    expect(ctx({ goals: [race] })).not.toContain("## Wochenblick");
  });

  it("the tool notes done, declined and her answer; the week settles, declines count in a row", () => {
    expect(REVIEW_RESULTS).toEqual(["gemacht", "abgelehnt", "will", "will_nicht"]);
    expect(reviewPatch("gemacht", "2026-11-16", 1)).toEqual({ review_week: "2026-11-16", review_declines: 0 });
    expect(reviewPatch("abgelehnt", "2026-11-16", 1)).toEqual({ review_week: "2026-11-16", review_declines: 2 });
    expect(reviewPatch("will", "2026-11-16", 2)).toEqual({ review_wanted: true, review_declines: 0 });
    expect(reviewPatch("will_nicht", "2026-11-16", 2)).toEqual({ review_wanted: false, review_week: "2026-11-16" });
    expect(tools).toContain('name: "wochenblick"');
    expect(tools).toContain("enum: [...REVIEW_RESULTS]");
    for (const n of Object.values(REVIEW_NOTES)) expect(n).not.toContain("ß");
  });
});

describe("dreams: the early joyful invitation, and a rest after «nicht jetzt»", () => {
  const dream = (id: string, created: string, o: Partial<ContextGoal> = {}): ContextGoal => ({
    id,
    title: id === "d1" ? "Island umrunden" : "Polarlichter sehen",
    kind: "dream",
    why: null,
    target_date: null,
    status: "active",
    milestones: [],
    created_at: `${created}T10:00:00.000Z`,
    updated_at: `${created}T10:00:00.000Z`,
    reminded_at: null,
    ...o,
  });
  // she started on 5 November: today (16 November) is in her second week with the app
  const startedAt = "2026-11-05T09:00:00Z";
  it("flags one new dream at a time, about joy, and none while one was brought up lately", () => {
    const out = section(ctx({ startedAt, goals: [dream("d1", "2026-11-06"), dream("d2", "2026-11-05")] }), "Bucket List");
    expect(out).toContain("- [d1] Island umrunden · seit 10 Tagen auf der Liste · ohne Datum · neu, Vorfreude\n");
    expect(out).toContain("- [d2] Polarlichter sehen · seit 11 Tagen auf der Liste · ohne Datum\n");
    const lately = section(ctx({ startedAt, goals: [dream("d1", "2026-11-06"), dream("d2", "2026-11-05", { reminded_at: "2026-11-10T08:00:00Z" })] }), "Bucket List");
    expect(lately).not.toContain("neu, Vorfreude");
    expect(PERSONA).toContain("Steht dort „neu, Vorfreude“, fragst du einmal nur nach der Freude daran, ohne Schritte und ohne Datum");
    expect(MODE_CHECKIN).toContain("„liegt lange“, „guter Zeitpunkt“ oder „neu, Vorfreude“, nimmst du höchstens einen davon im Gespräch auf");
  });

  it("only in her second week with the app: a dream added in month 3 gets no early invitation, nor without a start", () => {
    const later = section(ctx({ startedAt: "2026-08-10T09:00:00Z", goals: [dream("d1", "2026-11-06")] }), "Bucket List");
    expect(later).toContain("- [d1] Island umrunden · seit 10 Tagen auf der Liste · ohne Datum\n");
    expect(later).not.toContain("neu, Vorfreude");
    expect(section(ctx({ goals: [dream("d1", "2026-11-06")] }), "Bucket List")).not.toContain("neu, Vorfreude");
    // her third week is still the window (she may not have opened the app in her second)
    expect(section(ctx({ startedAt: "2026-10-28T09:00:00Z", goals: [dream("d1", "2026-10-30")] }), "Bucket List")).toContain("neu, Vorfreude");
    expect(section(ctx({ startedAt: "2026-10-26T09:00:00Z", goals: [dream("d1", "2026-10-30")] }), "Bucket List")).not.toContain("neu, Vorfreude");
  });

  it("«nicht jetzt»: update_goal nicht_jetzt, and the dream rests (nudge_after)", () => {
    expect(PERSONA).toContain("Sagt sie „nicht jetzt“, gibst du bei update_goal zusätzlich nicht_jetzt: true mit: Dann ruht der Traum drei Monate.");
    expect(tools).toContain("nicht_jetzt: {");
    expect(source).toContain("nudge_after: addDays(day, NUDGE_NOT_NOW_DAYS)");
    const resting = dream("d1", "2026-01-01", { nudge_after: "2027-02-01" });
    expect(section(ctx({ goals: [resting] }), "Bucket List")).not.toContain("liegt lange");
  });

  it("a resting dream older than 30 days still says it rests, so the season doesn't bring it up either", () => {
    // «nicht jetzt» on 10 October: the 30 days of «zuletzt von dir angesprochen» are over, the 90 quiet days not
    const resting = dream("d1", "2026-01-01", { reminded_at: "2026-10-10T08:00:00Z", nudge_after: "2027-01-08" });
    const out = section(ctx({ goals: [resting] }), "Bucket List");
    expect(out).toContain("- [d1] Island umrunden · seit 10 Monaten auf der Liste · ohne Datum · ruht bis 2027-01-08 (sie sagte „nicht jetzt“): nicht von dir aus ansprechen\n");
    expect(out).not.toContain("zuletzt von dir angesprochen");
    expect(out).not.toContain("liegt lange");
    // from the day it rests to, the usual reminders are back
    const awake = section(contextBlock({ ...base, day: "2027-01-08", goals: [resting] }), "Bucket List");
    expect(awake).not.toContain("ruht bis");
    expect(awake).toContain("liegt lange");
    expect(PERSONA).toContain("Steht bei einem Traum „ruht“, sprichst du ihn nicht von dir aus an, auch nicht wegen der Jahreszeit.");
  });
});

describe("rare offers: a small experiment, and pointing to people", () => {
  it("only when the data allows, and noted with note_offer", () => {
    expect(ctx({})).not.toContain("## Hinweise");
    expect(section(ctx({ hints: { experiment: true } }), "Hinweise")).toBe("## Hinweise (aus den Daten)\n- ein kleines Experiment: möglich (noch keine Ziele und Träume; höchstens einmal pro Woche)");
    expect(section(ctx({ hints: { support: true } }), "Hinweise")).toContain("- Begleitung: Sie spricht seit gut zwei Wochen fast täglich lange mit dir");
    expect(MODE_CHECKIN).toContain("Steht unter „Hinweise“ „ein kleines Experiment“, darfst du an einer ruhigen Stelle eines vorschlagen, aus ihren Werten oder der Jahreszeit");
    expect(tools).toContain('name: "note_offer"');
    // the example states nothing the context doesn't have (no sunset time there, only the light)
    expect(MODE_CHECKIN).toContain("etwa „Magst du heute zehn Minuten hinaus, solange es noch hell ist?“");
    expect(prompts).not.toMatch(/Sonne um \d/);
  });
});

describe("the good rules stay", () => {
  it("honest feasibility, one dream per conversation, no age talk, medical and crisis limits", () => {
    expect(PERSONA).toContain("Rechne nicht selbst.");
    expect(MODE_CHECKIN).toContain("Steht bei einem Ziel „knapp“ oder „kaum machbar“, sagst du es ihr einmal ehrlich und sanft");
    expect(PERSONA).toContain("höchstens einen einzigen pro Gespräch");
    expect(PERSONA).toContain("Ihr Alter, verbleibende Wochen oder Jahre sprichst du nie von dir aus an.");
    expect(PERSONA).toContain("Du bist weder Therapeut noch Ärztin und gibst keine medizinischen Ratschläge");
    expect(PERSONA).toContain("Die Dargebotene Hand (Telefon 143), im Notfall 144");
    expect(PERSONA).toContain("Erinnere nie an verpasste Gewohnheiten");
  });

  it("everything new is Swiss High German and the cached texts stay free of dates", () => {
    expect(prompts.replace("statt „ß“", "")).not.toContain("ß");
    expect(prompts).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(tools).not.toMatch(/\$\{|\d{4}-\d{2}-\d{2}|ß/);
    const all = ctx({
      goals: [race],
      opener: "neustart",
      lastSeen: "2026-11-07",
      todayLog: [{ goal_id: "g1", minutes: 30 }],
      review: { due: "fragen", monday: "2026-11-09", goals: [] },
      hints: { experiment: true, support: true },
      memories: [{ id: "x1", category: "termin", event_date: "2026-11-14", content: "Läuft den Greifenseelauf." }],
    });
    expect(all).not.toContain("ß");
    for (const k of ["termin", "gestern", "ziel", "schlaf", "jahreszeit", "neustart", "wochenblick", "abend", "abend_frage"] as const) expect(openerLine(k, base)).not.toContain("ß");
  });
});
