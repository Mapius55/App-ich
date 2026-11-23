// Round 3, the coach's small fixes from the persona test (NEXT.md «Small fixes» K1–K13, D1), the evening that takes
// up the day (NEXT #4) and the far horizon (owner decision 1, default). Rules as text, what the context says, and
// the pure logic behind it.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DemoBackend } from "../src/lib/demoBackend";
import {
  addDays,
  awaitsReply,
  chooseOpener,
  COME_BACK_FROM,
  dailySituation,
  dayOf,
  eveningEntries,
  FOLLOW_UP_REPLY_DAYS,
  followUpDue,
  habitMatchesBlock,
  openBlocksOn,
  ROTATING_OPENERS,
  sameTimeLogged,
  SLEEP_OPENER_GAP_DAYS,
  wochenblickDue,
  workEntry,
  type OpenerKind,
} from "../src/lib/plan";
import type { CoachEvent, CoachRequest } from "../src/lib/types";
import {
  contextBlock,
  eveningWin,
  MODE_CHECKIN,
  MODE_ONBOARDING,
  MODE_TIDY,
  openerLine,
  PERSONA,
  reminderChannel,
  type ContextConnections,
  type ContextEvent,
  type ContextGoal,
  type ContextInput,
} from "../supabase/functions/coach/prompt";
import {
  BLOCK_DONE_EARLY,
  BLOCK_LATER_NO,
  BLOCK_NO_NEXT,
  blockNoNext,
  blockOpenThatDay,
  COME_BACK_NOTE,
  GREETING_WRITE_REFUSAL,
  greetingWriteRefusal,
  nolioEditAllowed as nolioEditAllowedSrc,
  NOTIFICATIONS_NOTE,
  TIME_ALREADY_LOGGED,
} from "../supabase/functions/coach/rules";

// Monday, 16 November 2026, 19:10 in Zurich (UTC+1).
const base: ContextInput = {
  day: "2026-11-16",
  localTime: "Montag, 16. November 2026, 19:10",
  timezone: "Europe/Zurich",
  season: "Herbst",
  phase: "Nacht",
  hasLocation: true,
  now: "2026-11-16T18:10:00Z",
  profile: { display_name: "Sara", location_name: "Thun", summary: null, nature_palette: null },
  memories: [],
  recentDays: [],
};
const race: ContextGoal = { id: "g1", title: "Halbmarathon Zürich", why: null, target_date: "2027-04-12", status: "active", weekly_hours: 4, milestones: [] };
const entry = (id: string, title: string, start: string, end: string | null, o: Partial<ContextEvent> = {}): ContextEvent => ({
  id,
  title,
  starts_at: start,
  ends_at: end,
  all_day: false,
  location: null,
  kind: "termin",
  ...o,
});
const section = (out: string, heading: string) => {
  const at = out.indexOf(`## ${heading}`);
  if (at < 0) return "";
  const next = out.indexOf("\n## ", at + 3);
  return out.slice(at, next < 0 ? undefined : next);
};
const prompts = [PERSONA, MODE_ONBOARDING, MODE_CHECKIN, MODE_TIDY].join("\n");
const source = readFileSync(new URL("../supabase/functions/coach/index.ts", import.meta.url), "utf8");
const tools = source.slice(source.indexOf("const TOOLS"), source.indexOf("class ToolInputError"));
const migration = readFileSync(new URL("../supabase/migrations/20261126000100_evening_come_back.sql", import.meta.url), "utf8");

describe("Erinnerungen (owner decision 2, replaces the interim rule K1): the coach promises only what the line says", () => {
  const conn = (c: Partial<ContextConnections> = {}): ContextConnections => ({
    whoop: null,
    nolio: { available: false, connected: false },
    calendarSubscribed: false,
    askedAt: "2026-11-01T08:00:00Z",
    notify: { morning: "07:30:00", evening: null, device: true },
    reminders: { on: true, askedAt: null },
    ...c,
  });
  const lines = (c: Partial<ContextConnections>, view?: string) => section(contextBlock({ ...base, view, connections: conn(c) }), "Verbindungen").split("\n");
  const line = (c: Partial<ContextConnections>, view?: string) => lines(c, view).find((l) => l.startsWith("- Erinnerungen"));
  const SPACE = "Jetzt (Startseite mit dem Kreis)";

  it("the prompt: a wake-up call or a reminder she asks for is an entry with erinnern: true; promised only as the line says", () => {
    expect(PERSONA).toContain(
      "Wünscht sie einen Wecker oder eine Erinnerung, trägst du den Eintrag mit erinnern: true ein, für einen Wecker zur gewünschten Zeit mit reminder_minutes 0. Ob und wie etwas sie erinnert, sagst du nur so, wie es unter „Verbindungen“ bei „Erinnerungen“ steht.",
    );
    // the line under «Verbindungen», never the memories («Deine Erinnerungen»)
    expect(PERSONA).not.toContain("wie es unter „Erinnerungen“ steht");
    expect(PERSONA).not.toContain("Ein Wecker ist nicht möglich");
    // the old promise is gone
    expect(PERSONA).not.toContain("und sagst ihr das.");
    expect(PERSONA).not.toContain("als kurzen Termin mit Erinnerung einzutragen");
    expect(tools).toContain('erinnern: { type: "boolean"');
    expect(tools).toContain('name: "request_notifications"');
  });

  it("kommen als Mitteilung: a device, the switch on, no calendar subscription", () => {
    // a dream's block only with erinnern: true (dreams are never pushed otherwise), so the coach promises no more
    expect(line({})).toBe("- Erinnerungen: kommen als Mitteilung, kurz vor jedem Block und vor Einträgen mit erinnern: true (für einen Traum nur damit), höchstens drei am Tag, nie für Nolio");
    expect(reminderChannel(conn())).toBe("mitteilung");
  });

  it("über den iPhone-Kalender: the subscribed calendar reminds her (no notification on top)", () => {
    expect(line({ calendarSubscribed: true })).toBe("- Erinnerungen: über den iPhone-Kalender (jeder Eintrag mit Erinnerung meldet sich dort)");
    expect(lines({ calendarSubscribed: true })).toContain("- iPhone-Kalender: abonniert");
  });

  it("kommen keine: «steht im Kalender», never «erinnert dich», and once the offer to switch notifications on", () => {
    const none = { notify: { morning: null, evening: null, device: false } };
    expect(line(none, SPACE)).toBe(
      "- Erinnerungen: kommen keine: sag „steht im Kalender“, nie „erinnert dich“; möchte sie eine, bietest du einmal an, die Benachrichtigungen einzuschalten (request_notifications)",
    );
    expect(lines(none, SPACE)).toContain("- iPhone-Kalender: noch nicht abonniert");
    // the classic screens show no button: it says where
    expect(line(none)).toBe("- Erinnerungen: kommen keine: sag „steht im Kalender“, nie „erinnert dich“; möchte sie eine, sagst du einmal, dass sie die Benachrichtigungen im Menü unter „Einstellungen“ einschalten kann");
    // offered once: not again
    expect(line({ ...none, reminders: { on: true, askedAt: "2026-11-20T08:00:00Z" } }, SPACE)).toBe(
      "- Erinnerungen: kommen keine: sag „steht im Kalender“, nie „erinnert dich“; einschalten unter Du › Benachrichtigungen",
    );
    // her own switch off: said so, no offer
    expect(line({ reminders: { on: false, askedAt: null } }, SPACE)).toBe(
      "- Erinnerungen: kommen keine: sag „steht im Kalender“, nie „erinnert dich“ (sie hat sie unter Du › Benachrichtigungen ausgeschaltet)",
    );
  });

  it("unknown (a query failed, a column not there yet): no promise at all", () => {
    expect(line({ calendarSubscribed: null, notify: { morning: null, evening: null, device: null } })).toBe("- Erinnerungen: unbekannt (versprich keine)");
    expect(line({ reminders: undefined })).toBe("- Erinnerungen: unbekannt (versprich keine)");
    expect(line({ notify: undefined })).toBe("- Erinnerungen: unbekannt (versprich keine)");
    expect(reminderChannel({ calendarSubscribed: null, notify: undefined, reminders: undefined })).toBeNull();
    // the subscribed calendar is known without the rest
    expect(reminderChannel({ calendarSubscribed: true })).toBe("kalender");
  });

  it("request_notifications notes the offer once and tells the coach nothing reminds her until she switched them on", () => {
    expect(source).toContain("notifications_asked_at: new Date().toISOString()");
    expect(NOTIFICATIONS_NOTE).toMatch(/kommt keine Erinnerung/);
    expect(NOTIFICATIONS_NOTE).toMatch(/Nicht nochmals anbieten/);
    expect(NOTIFICATIONS_NOTE).not.toMatch(/ß/);
  });
});

describe("D2 and «erinnern» in the coach and the app (wiring; the rules themselves: tests/push-round3.test.ts)", () => {
  const backendSrc = readFileSync(new URL("../src/lib/supabaseBackend.ts", import.meta.url), "utf8");
  const logHabit = source.slice(source.indexOf('case "log_habit": {'), source.indexOf('case "log_time": {'));
  it("log_habit counts the habit's minutes on a tick and removes them on an untick (never failing the tick)", () => {
    expect(logHabit).toContain("const counted = await habitTime(sb, userId, habit, logDay, done, ctx.tz, ctx.turn);");
    expect(logHabit).toContain("gezaehlt_minuten: counted");
    expect(source).toContain('.delete().eq("user_id", userId).eq("source", "habit").eq("external_id", key)');
    expect(source).toContain('{ onConflict: "user_id,source,external_id", ignoreDuplicates: true }');
    expect(tools).toContain('minutes: { type: "integer", minimum: 1, maximum: 720');
  });
  it("the app's tap does the same through habitTimeRow", () => {
    expect(backendSrc).toContain("await this.habitTime(habitId, day, done);");
    expect(backendSrc).toContain("const row = habitTimeRow(habit, day, {");
    expect(backendSrc).toContain('.delete().eq("source", "habit").eq("external_id", habitTimeKey(habitId, day))');
  });
  it("log_time on a block a habit's tick answered makes it her answer (source block, as the app does): unticking keeps it", () => {
    const logTime = source.slice(source.indexOf('case "log_time": {'));
    expect(logTime).toContain('sb.from("goal_time").update({ ...fields, source: "block" }).eq("event_id", eventId)');
    expect(backendSrc).toContain('source: "block" as GoalTime["source"]');
  });
  it("create_event and update_event keep «erinnern» in events.reminder_asked, never on a Nolio entry", () => {
    expect(source).toContain('const asked = input.erinnern === undefined ? undefined : bool(input.erinnern, "erinnern");');
    expect(source).toContain(".update({ reminder_asked: asked })");
    expect(nolioEditAllowedSrc({ id: "x", erinnern: true })).toBe(false);
  });
});

describe("K2: the coach knows the notification times", () => {
  const notifyLine = (notify: ContextConnections["notify"], view?: string) =>
    section(contextBlock({ ...base, view, connections: { whoop: null, nolio: { available: false, connected: false }, calendarSubscribed: true, askedAt: null, notify } }), "Verbindungen")
      .split("\n")
      .find((l) => l.startsWith("- Benachrichtigungen"));

  it("names the times, the weekend time at the default, and where she changes them", () => {
    expect(notifyLine({ morning: "07:30:00", evening: "21:00:00", device: true }, "Jetzt (Startseite mit dem Kreis)")).toBe(
      "- Benachrichtigungen: morgens 07:30 (Sa/So 09:00), abends 21:00 · ändern unter Du › Benachrichtigungen",
    );
    // a time of her own has no weekend shift; the classic screens have them under Einstellungen
    expect(notifyLine({ morning: "06:15:00", evening: null, device: true })).toBe("- Benachrichtigungen: morgens 06:15 · ändern im Menü unter „Einstellungen“");
  });

  it("off, no device allowed, or unknown", () => {
    expect(notifyLine({ morning: null, evening: null, device: true }, "Du")).toBe("- Benachrichtigungen: aus · einschalten unter Du › Benachrichtigungen");
    expect(notifyLine({ morning: "07:30:00", evening: null, device: false }, "Du")).toBe(
      "- Benachrichtigungen: morgens 07:30 (Sa/So 09:00) · auf keinem Gerät erlaubt, es kommt also keine an · ändern unter Du › Benachrichtigungen",
    );
    expect(notifyLine(undefined, "Du")).toBeUndefined();
  });

  it("read from the profile and the push subscriptions (unknown profile: no line)", () => {
    expect(source).toContain('select("connections_asked_at, calendar_fetched_at, notify_morning, notify_evening")');
    expect(source).toContain('sb.from("push_subscriptions").select("id").limit(1)');
    expect(source).toContain("device: pushDevice ? pushDevice.length > 0 : null");
  });
});

describe("K3: where progress shows", () => {
  it("names Jetzt, Woche and the Bucket List in the space, «Plan» in the classic screens", () => {
    expect(section(contextBlock({ ...base, view: "Du" }), "App")).toContain("Was sie geschafft hat: heute auf Jetzt beim Kreis, die Woche weiter unten unter Woche, pro Ziel auf der Bucket List.");
    expect(section(contextBlock(base), "App")).toContain("Ziele und Träume, auch was sie pro Ziel geschafft hat: im Menü unter „Plan“.");
  });
});

describe("K4: the greeting writes nothing", () => {
  it("refuses every write of her data in a turn without her words", () => {
    // her mood too: she has not said how she is
    for (const name of ["log_time", "log_habit", "create_event", "update_event", "delete_event", "create_series", "update_series", "create_goal", "delete_goal", "add_milestone", "delete_milestone", "create_habit", "update_habit", "remember", "update_profile", "wochenblick", "come_back", "set_mood"])
      expect(greetingWriteRefusal(name, { id: "x" })).toBe(GREETING_WRITE_REFUSAL);
    expect(GREETING_WRITE_REFUSAL).toContain("Erst nach ihrer Antwort");
  });

  it("keeps the marks that something was brought up, alone, and what only shows or tidies", () => {
    expect(greetingWriteRefusal("update_goal", { id: "d1", reminded: true })).toBeNull();
    expect(greetingWriteRefusal("update_goal", { id: "d1", reminded: true, nicht_jetzt: true })).toBe(GREETING_WRITE_REFUSAL);
    expect(greetingWriteRefusal("update_goal", { id: "g1", weekly_hours: 3 })).toBe(GREETING_WRITE_REFUSAL);
    expect(greetingWriteRefusal("update_memory", { id: "m1", nachgefragt: true })).toBeNull();
    expect(greetingWriteRefusal("update_memory", { id: "m1", content: "neu" })).toBe(GREETING_WRITE_REFUSAL);
    expect(greetingWriteRefusal("update_milestone", { id: "s1", nachgefragt: true })).toBeNull();
    expect(greetingWriteRefusal("update_milestone", { id: "s1", done: true })).toBe(GREETING_WRITE_REFUSAL);
    for (const name of ["set_day_focus", "note_offer", "request_location", "request_connections", "forget", "finish_onboarding"]) expect(greetingWriteRefusal(name, {})).toBeNull();
  });

  it("is checked before any tool runs, only on a turn without her message, never while tidying", () => {
    expect(source).toContain('const refused = mode !== "tidy" && !message ? greetingWriteRefusal(tu.name, input) : null;');
    expect(source).toContain("if (refused) return { type: \"tool_result\" as const, tool_use_id: tu.id, content: refused, is_error: true };");
    expect(source.indexOf("greetingWriteRefusal(tu.name")).toBeLessThan(source.indexOf("const out = await runTool("));
  });
});

describe("K5: say only what the tools did", () => {
  it("the rule", () => {
    expect(PERSONA).toContain("was du eingetragen, verschoben oder gelöscht hast, sagst du so, wie es die Werkzeuge in diesem Zug melden.");
  });
});

describe("K6: a done block or step is counted, never deleted", () => {
  it("the rule, dreams too", () => {
    expect(PERSONA).toContain("Ist ein Block oder eine Etappe erledigt, auch früher als geplant, löschst du sie nie: log_time mit event_id oder update_milestone mit done.");
  });

  it("log_time accepts a block of today that starts later; a later day never; no «Nein» to a block still to come", () => {
    expect(source).not.toContain('"Der Block liegt noch in der Zukunft"');
    expect(source).toContain('if (blockDay > day) throw new ToolInputError("Der Block liegt an einem späteren Tag");');
    expect(source).toContain("if (minutes === 0) throw new ToolInputError(BLOCK_LATER_NO);");
    expect(BLOCK_LATER_NO).toContain("verschiebst oder löschst du ihn");
    expect(tools).toContain("oder einen von heute, den sie schon erledigt hat");
  });

  it("a block done before it begins keeps its place and counts, but its alarm no longer rings", () => {
    expect(source).toContain("doneEarly = ev.data.reminder_minutes !== null && ev.data.reminder_minutes !== undefined;");
    expect(source).toContain('const off = await sb.from("events").update({ reminder_minutes: null }).eq("id", eventId);');
    expect(source).toContain("...(doneEarly ? { erinnerung: BLOCK_DONE_EARLY } : {}),");
    expect(BLOCK_DONE_EARLY).toBe("Der Block bleibt im Kalender und zählt; seine Erinnerung ist aus, weil er schon erledigt ist.");
  });
});

describe("K7: a habit and its block are asked about once", () => {
  const block = entry("b1", "Dehnen", "2026-11-16T07:00:00Z", "2026-11-16T07:15:00Z", { kind: "block", goal_id: "g1" });
  const morning = { ...base, localTime: "Montag, 16. November 2026, 12:10", now: "2026-11-16T11:10:00Z", lastSeen: "2026-11-15", goals: [race], pastBlocks: [block] };
  const asks = (c: ContextInput) => section(contextBlock(c), "Vergangene Blöcke ohne Rückmeldung");

  it("a block whose habit she ticked that day: not asked about, entered with its planned length", () => {
    const habit = { id: "h1", title: "Dehnen", per_week: 7, goal_id: null, done_days: ["2026-11-16"] };
    expect(asks({ ...morning, habits: [habit] })).toContain(
      "- [b1] Mo., 16. Nov. (heute), 08:00–08:15: Dehnen (Ziel „Halbmarathon Zürich“) · Gewohnheit „Dehnen“ an dem Tag abgehakt: nicht danach fragen, mit der geplanten Länge eintragen",
    );
    // the same thing in other words counts; a habit ticked on another day, another thing, or only the same goal is no answer
    expect(asks({ ...morning, habits: [{ ...habit, title: "10 Minuten dehnen am Abend", goal_id: "g1" }] })).toContain("Gewohnheit „10 Minuten dehnen am Abend“ an dem Tag abgehakt");
    expect(asks({ ...morning, habits: [{ ...habit, done_days: ["2026-11-15"] }] })).not.toContain("abgehakt");
    expect(asks({ ...morning, habits: [{ ...habit, title: "Lesen" }] })).not.toContain("abgehakt");
    expect(asks({ ...morning, habits: [{ ...habit, title: "Laufen", goal_id: "g1" }] })).not.toContain("abgehakt");
  });

  it("which habit is the same thing as a block: a word of what is done, never the goal alone", () => {
    expect(habitMatchesBlock({ title: "10 Minuten dehnen" }, { title: "Dehnen" })).toBe(true);
    expect(habitMatchesBlock({ title: "Laufen", goal_id: "g1" }, { title: "Lauf am See", goal_id: "G1" })).toBe(true);
    expect(habitMatchesBlock({ title: "Velo", goal_id: null }, { title: "Velofahren zur Arbeit", goal_id: "g1" })).toBe(true);
    // only the goal, only a word about time, another goal, or a word that only begins alike
    expect(habitMatchesBlock({ title: "Dehnen", goal_id: "g1" }, { title: "Intervalle", goal_id: "g1" })).toBe(false);
    expect(habitMatchesBlock({ title: "Zeit draussen" }, { title: "Zeit fürs Exposé" })).toBe(false);
    expect(habitMatchesBlock({ title: "15 Minuten Italienisch", goal_id: "g2" }, { title: "15 Minuten Joggen", goal_id: "g1" })).toBe(false);
    expect(habitMatchesBlock({ title: "Dehnen", goal_id: "g2" }, { title: "Dehnen", goal_id: "g1" })).toBe(false);
    expect(habitMatchesBlock({ title: "Stretching" }, { title: "Streit klären" })).toBe(false);
  });
});

describe("K8: «kurz» in the Wochenblick", () => {
  it("one good thing and one proposal, never single days or habits", () => {
    expect(MODE_CHECKIN).toContain("Sagt sie „kurz“, nennst du eine gelungene Sache und machst einen Vorschlag für die neue Woche; nach einzelnen Tagen oder Gewohnheiten fragst du im Wochenblick nie.");
  });
});

describe("K9: the Wochenblick stays due until it was offered", () => {
  const state = { week: null, declines: 0, wanted: null };
  const due = { day: "2026-11-16", minutes: 8 * 60, lastTalk: { day: "2026-11-15", minutes: 21 * 60 }, state, hasPlanGoal: true, heavy: false, pause: false };

  it("a talk without it leaves it due; a greeting that opened with it and that she answered counts as offered", () => {
    expect(wochenblickDue(due)).toBe("anbieten");
    // Sunday's greeting opened with it (from 16:00, so for the coming week) and she talked: not again on Monday
    expect(wochenblickDue({ ...due, offeredOn: ["2026-11-15"] })).toBeNull();
    expect(wochenblickDue({ ...due, day: "2026-11-18", offeredOn: ["2026-11-16"] })).toBeNull();
    // last week's offer, or one of today (the greeting of this very conversation), leaves this week's due
    expect(wochenblickDue({ ...due, offeredOn: ["2026-11-10", "2026-11-08"] })).toBe("anbieten");
    expect(wochenblickDue({ ...due, offeredOn: ["2026-11-16"] })).toBe("anbieten");
  });

  it("from the stored openers and her messages (coach index)", () => {
    const base = {
      day: "2026-11-16",
      now: new Date("2026-11-16T07:00:00Z"),
      tz: "Europe/Zurich",
      lastSeenDay: "2026-11-15",
      lastSpoke: { thread: "2026-11-15", created_at: "2026-11-15T17:05:00Z" },
      todayMood: undefined,
      recentDays: [],
      review: state,
      hasPlanGoal: true,
    };
    expect(dailySituation(base).review).toBe("anbieten");
    expect(dailySituation({ ...base, reviewOfferedOn: ["2026-11-15"] }).review).toBeNull();
    expect(source).toContain('reviewOfferedOn: dailyCtx.openers.filter((r) => r.kind === "wochenblick" && r.day < context.day && (dailyCtx.talkCounts[r.day] ?? 0) > 0).map((r) => r.day),');
  });
});

describe("K10: follow-ups", () => {
  it("what waits for someone else's answer is asked about after a week at the earliest", () => {
    expect(awaitsReply("Hat der Stationsleitung eine Mail wegen der Ferien geschrieben.")).toBe(true);
    expect(awaitsReply("Schickt die Ferienanfrage für den Jakobsweg ab.")).toBe(true);
    expect(awaitsReply("Hat sich bei der Gemeinde beworben.")).toBe(true);
    expect(awaitsReply("E-Mail an den Trainer wegen dem Plan.")).toBe(true);
    expect(awaitsReply("Email an die Wohnungsverwaltung.")).toBe(true);
    expect(awaitsReply("Fährt nach Mailand.")).toBe(false);
    expect(awaitsReply("Bewerbungsgespräch bei der Post.")).toBe(false);
    expect(awaitsReply("Läuft den Greifenseelauf.")).toBe(false);
    const mail = { event_date: "2026-11-15", content: "Mail an die Stationsleitung wegen der Ferien." };
    expect(followUpDue(mail, "2026-11-16")).toBe(false);
    expect(followUpDue(mail, addDays("2026-11-15", FOLLOW_UP_REPLY_DAYS - 1))).toBe(false);
    expect(followUpDue(mail, addDays("2026-11-15", FOLLOW_UP_REPLY_DAYS))).toBe(true);
    expect(followUpDue(mail, addDays("2026-11-15", FOLLOW_UP_REPLY_DAYS + 2))).toBe(true);
    expect(followUpDue(mail, addDays("2026-11-15", FOLLOW_UP_REPLY_DAYS + 3))).toBe(false);
    expect(followUpDue({ ...mail, followed_up_at: "2026-11-20T08:00:00Z" }, addDays("2026-11-15", FOLLOW_UP_REPLY_DAYS))).toBe(false);
    // her own appointment: the next days, as before
    expect(followUpDue({ event_date: "2026-11-15", content: "Läuft den Greifenseelauf." }, "2026-11-16")).toBe(true);
  });

  it("the rule: her own report counts as followed up, a reply asked about after a week", () => {
    expect(MODE_CHECKIN).toContain("erzählt sie selbst von einer deiner Erinnerungen mit Datum, rufst du das im selben Zug auf, ohne nachzufragen. Ob jemand anderes schon geantwortet hat, fragst du frühestens nach einer Woche.");
  });
});

describe("K11: the sleep opener at most twice in seven days", () => {
  it("the greeting asks about sleep only when the opener says so (the example no longer ends with it)", () => {
    expect(MODE_CHECKIN).toContain("Nur „Wie geht es dir heute?“ reicht nicht. Nach dem Schlaf fragst du nur, wenn die Eröffnung es sagt. Zum Beispiel");
    expect(MODE_CHECKIN).toContain("„Guten Morgen, Peter. Du sitzt wohl schon im Zug nach Basel. Was steht dort heute an?“");
    expect(prompts).not.toContain("Basel. Wie hast du geschlafen?");
  });

  const today = "2026-11-16";
  const morning = { minutes: 7 * 60 + 30, pause: false, wochenblick: false, available: ["schlaf", "jahreszeit"] as OpenerKind[] };

  it("not again within three days", () => {
    expect(SLEEP_OPENER_GAP_DAYS).toBe(3);
    expect(chooseOpener(morning, [{ day: "2026-11-14", kind: "schlaf" }], today)).toBe("jahreszeit");
    expect(chooseOpener(morning, [{ day: "2026-11-13", kind: "schlaf" }, { day: "2026-11-15", kind: "jahreszeit" }], today)).toBe("jahreszeit");
    expect(chooseOpener(morning, [{ day: "2026-11-12", kind: "schlaf" }, { day: "2026-11-15", kind: "jahreszeit" }], today)).toBe("schlaf");
    // in a heavy time too: then the season
    expect(chooseOpener({ ...morning, quiet: true }, [{ day: "2026-11-14", kind: "schlaf" }], today)).toBe("jahreszeit");
  });

  it("over two weeks of mornings with only the gentle kinds: never more than twice in any seven days", () => {
    const recent: { day: string; kind: OpenerKind }[] = [];
    for (let i = 0; i < 21; i++) {
      const day = addDays(today, i);
      recent.unshift({ day, kind: chooseOpener({ ...morning, available: i % 2 ? ROTATING_OPENERS : morning.available }, recent, day) });
    }
    const sleep = recent.map((r) => r.kind === "schlaf").reverse();
    for (let i = 0; i + 7 <= sleep.length; i++) expect(sleep.slice(i, i + 7).filter(Boolean).length).toBeLessThanOrEqual(2);
    expect(sleep.filter(Boolean).length).toBeGreaterThan(0);
  });
});

describe("K12: after a «Nein», one smaller variant, then let go", () => {
  it("the rules", () => {
    expect(PERSONA).toContain(
      "Hat sie keine Lust auf etwas Geplantes oder sagt sie Nein zu einem Vorschlag, schlägst du einmal eine kleinere Version vor („nur 20 Minuten“), statt es zu streichen, und sagst kurz, was das kostet; sagt sie wieder Nein, lässt du es los, und was sie zweimal abgelehnt hat, etwa einen Ort, schlägst du nie wieder vor (merk es dir mit remember).",
    );
    expect(MODE_CHECKIN).toContain("und bietest erst danach einmal einen kleineren oder verschobenen Block an;");
    for (const t of [BLOCK_NO_NEXT, blockNoNext("Wenn es regnet, laufe ich auf dem Laufband.")]) expect(t).toContain("biete erst danach einmal einen kleineren oder verschobenen Block an, sagt sie auch dazu Nein, lässt du es.");
  });
});

describe("K13: getting to know her", () => {
  it("no question about apps and devices for someone who has little to do with technology", () => {
    expect(MODE_ONBOARDING).toContain("Steht unter „Verbindungen“, dass du schon gefragt hast, oder hat sie mit Technik wenig zu tun, lässt du das aus.");
    expect(MODE_CHECKIN).toContain("nie in der Begrüssung und nie, wenn sie mit Technik wenig zu tun hat");
  });
  it("no money goal she did not ask for", () => {
    expect(PERSONA).toContain("Budget, Sparen oder Schulden legst du nie von dir aus als Ziel an.");
  });
});

describe("decision 1, default: a far horizon", () => {
  it("sets the year when it comes up, asks once for a small version now, never closes with a date", () => {
    expect(PERSONA).toContain(
      "Bei einem fernen Horizont („wenn ich pensioniert bin“, „irgendwann“) setzt du das Jahr, wenn es sich ergibt, fragst einmal nach einer kleinen Version, die schon jetzt geht, etwa mit den Enkeln, und schliesst nie mit einem Datum.",
    );
  });
});

describe("D1: no double count for log_time without event_id", () => {
  it("the same minutes for the goal on the day, from any source, are already there", () => {
    const rows = [
      { goal_id: "g1", day: "2026-11-16", minutes: 90 },
      { goal_id: "g2", day: "2026-11-16", minutes: 10 },
    ];
    expect(sameTimeLogged(rows, "g1", "2026-11-16", 90)).toBe(true);
    expect(sameTimeLogged(rows, "G1", "2026-11-16", 90)).toBe(true);
    expect(sameTimeLogged(rows, "g1", "2026-11-16", 60)).toBe(false);
    expect(sameTimeLogged(rows, "g1", "2026-11-15", 90)).toBe(false);
    expect(sameTimeLogged(rows, "g2", "2026-11-16", 10)).toBe(true);
    expect(sameTimeLogged([{ goal_id: "g1", day: "2026-11-16", minutes: 0 }], "g1", "2026-11-16", 0)).toBe(false);
  });

  it("the coach saves nothing then and says so; zusaetzlich: true counts it again", () => {
    expect(TIME_ALREADY_LOGGED).toContain("Schon eingetragen");
    expect(TIME_ALREADY_LOGGED).toContain("sag höchstens in einem Halbsatz, dass sie schon dastehen");
    expect(TIME_ALREADY_LOGGED).toContain("Nur wenn sie es wirklich zweimal gemacht hat, nochmals mit zusaetzlich: true.");
    expect(tools).toContain('zusaetzlich: { type: "boolean"');
    expect(source).toContain("if (sameTimeLogged(same.data ?? [], goalId, logDay, minutes)) {");
    expect(source).toContain("return JSON.stringify({ ok: true, hint: TIME_ALREADY_LOGGED });");
    expect(source).toContain('const extra = input.zusaetzlich === undefined ? false : bool(input.zusaetzlich, "zusaetzlich");');
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

describe("D1 with K6: time on a day with an unanswered block of the goal", () => {
  const zurich = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));

  it("finds her blocks of that day without an answer: past, running or later; never Nolio, all-day or answered", () => {
    const blocks = [
      { id: "b1", starts_at: "2026-11-16T06:00:00Z", all_day: false, source: "person", goal_time: [] },
      { id: "b2", starts_at: "2026-11-16T19:30:00Z", all_day: false, source: "coach", goal_time: null }, // later today
      { id: "b3", starts_at: "2026-11-16T10:00:00Z", all_day: false, source: "person", goal_time: [{ id: "t" }] },
      { id: "b4", starts_at: "2026-11-16T10:00:00Z", all_day: false, source: "person", goal_time: { id: "t" } },
      { id: "n1", starts_at: "2026-11-16T12:00:00Z", all_day: false, source: "nolio", goal_time: [] },
      { id: "a1", starts_at: "2026-11-16T00:00:00Z", all_day: true, source: "person", goal_time: [] },
      // 23:30 UTC on the 16th is the 17th in Zurich; 23:30 UTC on the 15th is the 16th there
      { id: "x1", starts_at: "2026-11-16T23:30:00Z", all_day: false, source: "person", goal_time: [] },
      { id: "x2", starts_at: "2026-11-15T23:30:00Z", all_day: false, source: "person", goal_time: [] },
    ];
    expect(openBlocksOn(blocks, "2026-11-16", zurich).map((b) => b.id)).toEqual(["b1", "b2", "x2"]);
    // summer time: 22:30 UTC on 30 June is 00:30 on 1 July in Zurich
    expect(openBlocksOn([{ id: "s", starts_at: "2026-06-30T22:30:00Z" }], "2026-07-01", zurich)).toHaveLength(1);
  });

  it("saves nothing then: the coach answers the block, or says it was more time", () => {
    const hint = blockOpenThatDay([{ id: "b2", time: "20:30" }]);
    expect(hint).toBe(
      "Nichts gespeichert: An diesem Tag steht für dieses Ziel ein Block ohne Rückmeldung ([b2] um 20:30), der sonst auch zählt. War ihre Zeit dieser Block, auch wenn er erst noch kommt, ruf log_time mit dessen event_id auf; war es Zeit dazu, nochmals mit zusaetzlich: true.",
    );
    expect(hint).not.toContain("ß");
    expect(blockOpenThatDay([{ id: "b1", time: "07:00" }, { id: "b2", time: "20:30" }])).toContain("stehen für dieses Ziel Blöcke ohne Rückmeldung ([b1] um 07:00, [b2] um 20:30), die sonst auch zählen. War ihre Zeit einer davon,");
    // checked before the insert (no row that the block would double), the old after-the-fact hint is gone
    const at = source.indexOf("const open = openBlocksOn(blocks.data ?? [], logDay");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(source.indexOf("const ins = await insert();\n          if (ins.error) throw missingGoal(ins.error);"));
    expect(source).toContain("return JSON.stringify({ ok: false, hint: blockOpenThatDay(");
    expect(source).not.toContain("lösche diesen Eintrag nicht doppelt");
    expect(tools).toContain("true, wenn es wirklich Zeit dazu war, neben einem Block dieses Tages oder dieselbe Zeit ein zweites Mal.");
  });
});

describe("D1 in the demo: the same sentence twice counts once", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });
  it("logs the reported time once", async () => {
    const ctx: CoachRequest["context"] = { day: dayOf(), localTime: "", timezone: "Europe/Zurich", season: "Herbst", phase: "Tag", hasLocation: false };
    const talk = async (b: DemoBackend, message: string) => {
      const events: CoachEvent[] = [];
      await b.coach({ mode: "checkin", thread: ctx.day, message, context: ctx }, (e) => events.push(e));
      return { events, text: events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("") };
    };
    const b = new DemoBackend();
    await b.signUp("demo.doppelt", "geheim1234");
    await b.addGoal({ title: "Halbmarathon" });
    expect((await talk(b, "Heute 1,5 Stunden trainiert")).events.some((e) => e.type === "time_logged")).toBe(true);
    const again = await talk(b, "Heute 1,5 Stunden trainiert");
    expect(again.events.some((e) => e.type === "time_logged")).toBe(false);
    expect(again.text).toContain("Die 1.5 Std für „Halbmarathon“ stehen schon da.");
    expect((await b.exportData()).goal_time).toHaveLength(1);
  }, 20000);

  it("answers her block of the day with the time she names, also one later today (no second count)", async () => {
    const ctx: CoachRequest["context"] = { day: dayOf(), localTime: "", timezone: "Europe/Zurich", season: "Herbst", phase: "Tag", hasLocation: false };
    const b = new DemoBackend();
    await b.signUp("demo.block", "geheim1234");
    const goal = await b.addGoal({ title: "Halbmarathon" });
    // a block of today that starts in two minutes (today in the demo's clock, also just before midnight)
    const start = new Date(Math.min(Date.now() + 2 * 60_000, new Date(`${dayOf()}T23:57:00`).getTime()));
    const block = await b.addEvent(
      { title: "Lauf", starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 60 * 60_000).toISOString(), all_day: false, location: null, notes: null, reminder_minutes: 10, kind: "block", goal_id: goal.id },
      "coach",
    );
    const events: CoachEvent[] = [];
    await b.coach({ mode: "checkin", thread: ctx.day, message: "Heute 45 Minuten gelaufen", context: ctx }, (e) => events.push(e));
    expect(events.some((e) => e.type === "time_logged")).toBe(true);
    const rows = (await b.exportData()).goal_time;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_id: block.id, minutes: 45, source: "block" });
  }, 20000);
});

describe("#4: the evening takes up the day", () => {
  const painting = entry("e1", "Malen mit Lina", "2026-11-16T14:30:00Z", "2026-11-16T16:00:00Z");
  const zurich = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));
  const now = Date.parse("2026-11-16T18:10:00Z");

  it("her own entries of today that are over: no work, shift, trainer's plan, sensitive one, block she said no to", () => {
    const events = [
      entry("w1", "Spätdienst", "2026-11-16T06:00:00Z", "2026-11-16T14:00:00Z"),
      entry("w2", "Teammeeting", "2026-11-16T08:00:00Z", "2026-11-16T09:00:00Z"),
      entry("s1", "Zahnarzt", "2026-11-16T10:00:00Z", "2026-11-16T10:30:00Z"),
      entry("s2", "Termin", "2026-11-16T11:00:00Z", "2026-11-16T11:30:00Z", { location: "Kantonsspital" }),
      entry("n1", "Intervalle", "2026-11-16T12:00:00Z", "2026-11-16T13:00:00Z", { kind: "block", source: "nolio" }),
      entry("a1", "Ferien", "2026-11-16T00:00:00Z", "2026-11-17T00:00:00Z", { all_day: true }),
      entry("l1", "Kino", "2026-11-16T19:00:00Z", "2026-11-16T21:00:00Z"), // still to come
      entry("y1", "Brunch", "2026-11-15T10:00:00Z", "2026-11-15T12:00:00Z"), // yesterday
      entry("b0", "Laufen", "2026-11-16T07:00:00Z", "2026-11-16T08:00:00Z", { kind: "block", goal_id: "g1" }),
      entry("b1", "Velo flicken", "2026-11-16T16:30:00Z", "2026-11-16T17:00:00Z", { kind: "block" }),
      painting,
    ];
    const got = eveningEntries(events, { now, today: "2026-11-16", dayOfIso: zurich, declined: new Set(["b0"]) });
    expect(got.map((e) => e.id)).toEqual(["e1", "b1"]); // a Termin first, then a block; at most two
    expect(eveningEntries(events, { now, today: "2026-11-16", dayOfIso: zurich }, 5).map((e) => e.id)).toEqual(["e1", "b0", "b1"]);
    // without an end: an hour after it began
    expect(eveningEntries([entry("x", "Znacht bei Oma", "2026-11-16T17:30:00Z", null)], { now, today: "2026-11-16", dayOfIso: zurich })).toEqual([]);
    expect(eveningEntries([entry("x", "Znacht bei Oma", "2026-11-16T17:00:00Z", null)], { now, today: "2026-11-16", dayOfIso: zurich })).toHaveLength(1);
    for (const w of ["Frühschicht", "Nachtdienst", "Arbeit", "Büro", "im Laden", "Kundentermin"]) expect(workEntry(w)).toBe(true);
    for (const t of ["Geschichte lernen", "Dienstagsrunde", "Gartenarbeit", "Malen mit Lina", "Training", "Wald erkunden"]) expect(workEntry(t)).toBe(false);
  });

  it("the order: a step done, then one of her entries, then goal time, then a habit", () => {
    const evening = { ...base, goals: [race], events: [painting], todayLog: [{ goal_id: "g1", minutes: 45 }] };
    expect(eveningWin(evening)).toEqual({ kind: "eintrag", entries: [{ title: "Malen mit Lina", time: "15:30" }] });
    const stepDone = { ...race, milestones: [{ id: "m1", title: "15 km am Stück", due_date: null, done_at: "2026-11-16T16:00:00Z", position: 0 }] };
    expect(eveningWin({ ...evening, goals: [stepDone] })).toMatchObject({ kind: "etappe" });
    expect(eveningWin({ ...evening, events: [] })).toEqual({ kind: "zeit", title: "Halbmarathon Zürich", minutes: 45 });
  });

  it("the greeting names the entry: with a question how it was, else a warm half-sentence, never whether it happened", () => {
    const evening = { ...base, events: [painting] };
    expect(openerLine("abend_frage", evening)).toBe(
      "Abend: zurückschauen auf eine einzige Sache von heute, nur diese nennen: Eintrag „Malen mit Lina“ um 15:30 (fragen, wie es war; nie, ob es stattfand), mit Frage",
    );
    expect(openerLine("abend", evening)).toBe(
      "Abend: zurückschauen auf eine einzige Sache von heute, nur diese nennen: Eintrag „Malen mit Lina“ um 15:30 (in einem warmen Halbsatz; nie, ob es stattfand), ohne Frage",
    );
    // two: she picks the one that matters to her
    const two = { ...evening, events: [painting, entry("e2", "Chor", "2026-11-16T16:30:00Z", "2026-11-16T17:30:00Z")] };
    expect(openerLine("abend", two)).toContain("nur diese nennen: der Eintrag, der ihr mehr bedeutet: „Malen mit Lina“ um 15:30 oder „Chor“ um 17:30 (");
    // a shift alone: nothing of hers to name
    expect(openerLine("abend", { ...evening, events: [entry("w1", "Spätdienst", "2026-11-16T06:00:00Z", "2026-11-16T14:00:00Z")] })).toBe(
      "Abend: zurückschauen, heute nichts zum Nennen: etwas Ruhiges zum Abend, ohne Frage",
    );
    // a heavy day stays quiet
    expect(openerLine("abend", { ...evening, today: { mood: { valence: -0.6 }, focus: null } })).toContain("Abend, leise");
  });

  it("the rules: never a good night that closes the door; something important is not put off but brought back after her yes", () => {
    expect(MODE_CHECKIN).toContain("Ein Gute-Nacht schliesst nie die Tür: Du endest offen, etwa „Ich bin da, wenn du noch etwas erzählen magst.“");
    expect(MODE_CHECKIN).toContain(
      "Sagt sie am Abend etwas Wichtiges über ihr Leben, vertagst du es nie auf „in Ruhe“: ein warmer Satz dazu und die Frage, ob du morgen darauf zurückkommen sollst (come_back nach ihrem Ja).",
    );
    expect(MODE_CHECKIN).not.toContain("sonst wünschst du einen schönen Abend");
    expect(tools).toContain('name: "come_back"');
    expect(COME_BACK_NOTE).toContain("ohne Uhrzeit und ohne mehr zu versprechen");
  });

  it("the next morning's greeting comes back to it, exactly once (before a Wochenblick; in the evening it waits)", () => {
    const morning = { minutes: 7 * 60 + 30, pause: false, wochenblick: true, available: ROTATING_OPENERS, comeBack: true };
    expect(chooseOpener(morning, [], "2026-11-17")).toBe("zurueck");
    expect(chooseOpener({ ...morning, minutes: 14 * 60 }, [], "2026-11-17")).toBe("zurueck");
    expect(chooseOpener({ ...morning, minutes: 18 * 60 }, [], "2026-11-17")).toBe("wochenblick");
    expect(chooseOpener({ ...morning, comeBack: false }, [], "2026-11-17")).toBe("wochenblick");
    expect(chooseOpener({ ...morning, pause: true }, [], "2026-11-17")).toBe("neustart");
    // not in the night: an open at 00:40 waits for the morning
    expect(COME_BACK_FROM).toBe(5 * 60);
    expect(chooseOpener({ ...morning, minutes: 40 }, [], "2026-11-17")).toBe("wochenblick");
    expect(chooseOpener({ ...morning, minutes: COME_BACK_FROM }, [], "2026-11-17")).toBe("zurueck");
    // marked when the greeting opens with it; a later open the same day finds it again for the stored opener
    expect(source).toContain('if (kind === "zurueck" && pendingBack && !raisedBack) {');
    expect(source).toContain('.update({ come_back_at: iso(now) }).eq("user_id", userId).eq("day", pendingBack.day)');
    expect(source).toContain('if (kind === "zurueck") input.comeBack = (raisedBack ?? pendingBack)?.text;');
  });

  it("the opener line: in her words; something sensitive is never named in the greeting", () => {
    const next = { ...base, day: "2026-11-17", now: "2026-11-17T06:40:00Z" };
    expect(openerLine("zurueck", { ...next, comeBack: "dass sie für alle die Jacken hält" })).toBe(
      "Zurückkommen: Sie wollte, dass du heute darauf zurückkommst: „dass sie für alle die Jacken hält“. Greif es warm auf, mit einer offenen Frage; weicht sie aus, lässt du es",
    );
    const sensitive = openerLine("zurueck", { ...next, comeBack: "die Trennung von ihrem Partner" });
    expect(sensitive).toContain("auf etwas Persönliches");
    expect(sensitive).not.toContain("Trennung");
    expect(openerLine("zurueck", next)).toContain("siehe „Letztes Gespräch“");
    expect(contextBlock({ ...next, opener: "zurueck", comeBack: "dass sie für alle die Jacken hält" })).toContain("## Eröffnung (nur für die Begrüssung)\nZurückkommen:");
  });

  it("is kept on the day she said it (a new migration: days.come_back, the opener «zurueck»)", () => {
    expect(migration).toContain("add column if not exists come_back text");
    expect(migration).toContain("add column if not exists come_back_at timestamptz");
    expect(migration).toContain("'abend_frage', 'zurueck'");
    expect(source).toContain('.select("day, come_back, come_back_at").not("come_back", "is", null).gte("day", addDays(day, -3)).lt("day", day)');
  });
});

describe("round 3 texts", () => {
  it("no sharp s, no dates in the cached texts, and the tool notes in Swiss spelling", () => {
    expect(prompts.replace("statt „ß“", "")).not.toContain("ß");
    expect(prompts).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    for (const t of [GREETING_WRITE_REFUSAL, TIME_ALREADY_LOGGED, BLOCK_LATER_NO, BLOCK_DONE_EARLY, COME_BACK_NOTE, BLOCK_NO_NEXT]) expect(t).not.toContain("ß");
    expect(migration).not.toContain("ß");
  });
});
