// Round 3, the messages: «Blöcke und Wunsch» (owner decision 2: reminders that really come) and «Nichts, nach Pause
// eine Zeile» (owner decision 3: only her own content), P1, P2 and D2 (a habit counts its minutes). Every rule as a
// pure function of supabase/functions/_shared/push_text.ts and plan.ts; the dispatch around them is in
// tests/push-dispatch.test.ts.
import { describe, expect, it } from "vitest";
import {
  addDays,
  busyDecision,
  CALENDAR_FRESH_DAYS,
  calendarSubscribed,
  dailyTitles,
  dueReminders,
  dueSlot,
  endedLate,
  eveningCandidates,
  fingerprint,
  laterAskedToday,
  lengthLabel,
  localParts,
  mentionsDream,
  morningCandidates,
  namedCounts,
  pauseCandidates,
  pauseLineSent,
  pauseState,
  reminderAt,
  reminderDay,
  reminderInRun,
  reminderMessage,
  remindedSoon,
  REMINDERS_PER_DAY,
  runningUntil,
  safeLabel,
  slotDueAt,
  type EveningFacts,
  type MorningFacts,
  type PushEvent,
  type PushGoal,
  type ReminderEvent,
} from "../supabase/functions/_shared/push_text";
import { dayOf, habitTimeKey, habitTimeRow } from "../supabase/functions/_shared/plan";
import { DemoBackend } from "../src/lib/demoBackend";

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

const TZ = "Europe/Zurich";
const at = (local: string) => new Date(`${local}+01:00`); // CET in November
const iso = (local: string) => at(local).toISOString();
const MON = "2026-11-16";
const SAT = "2026-11-21";

const goals: PushGoal[] = [
  { id: "g-run", title: "Halbmarathon Zürich", kind: "goal", status: "active" },
  { id: "g-it", title: "Italienisch lernen", kind: "goal", status: "active" },
  { id: "g-dream", title: "In Italien Italienisch sprechen", kind: "dream", status: "active" },
  { id: "g-camino", title: "Jakobsweg gehen", kind: "dream", status: "active" },
  { id: "g-weight", title: "5 kg abnehmen", kind: "goal", status: "active" },
];
const ev = (local: string, title: string, extra: Partial<PushEvent> = {}): PushEvent => ({
  title,
  starts_at: iso(local),
  ends_at: null,
  all_day: false,
  kind: "termin",
  goal_id: null,
  ...extra,
});
const until = (local: string) => ({ ends_at: iso(local) });
const morning = (f: Partial<MorningFacts>, when = `${MON}T07:30:00`) => morningCandidates({ events: [], dueSteps: [], goals, ...f }, at(when), TZ);
const evening = (f: Partial<EveningFacts>, when = `${MON}T21:00:00`) => eveningCandidates({ goals, goalTime: [], milestones: [], habits: [], ...f }, at(when), TZ);
const first = (g: { body: string }[][]) => g[0]?.[0]?.body;

describe("no body without her own content (owner decision 3)", () => {
  it("an empty day: nothing in the morning, nothing in the evening", () => {
    expect(morning({})).toEqual([]);
    expect(evening({})).toEqual([]);
  });
  it("no template is a filler line any more", () => {
    const groups = [
      ...morning({ events: [ev(`${MON}T10:00:00`, "Vorlesung"), ev(`${MON}T20:00:00`, "Chor")], dueSteps: [{ title: "Anmelden", goal_id: "g-run" }] }),
      ...evening({ habits: [{ title: "Lesen" }], events: [ev(`${MON}T15:30:00`, "Malen mit Lina", until(`${MON}T16:30:00`))] }),
    ];
    for (const c of groups.flat()) expect(c.template, c.body).not.toMatch(/plain/);
  });
});

describe("the evening without a win: one of her own finished entries of the day as a plain statement", () => {
  it("«Heute war: 15:30 Malen mit Lina.», never a word on whether it happened", () => {
    const g = evening({ events: [ev(`${MON}T15:30:00`, "Malen mit Lina", until(`${MON}T16:30:00`))] });
    expect(g[0].map((c) => c.body)).toEqual(["Heute war: 15:30 Malen mit Lina.", "Heute um 15:30: Malen mit Lina.", "Montag um 15:30: Malen mit Lina.", "Heute: Malen mit Lina, um 15:30."]);
    for (const c of g.flat()) expect(c.body).not.toMatch(/geklappt|geschafft|gemacht|\?/);
  });
  it("only finished ones; never work, a shift, something sensitive, her trainer's, a dream's, a block she said no to", () => {
    const g = evening({
      events: [
        ev(`${MON}T08:00:00`, "Frühdienst", until(`${MON}T15:00:00`)),
        ev(`${MON}T09:00:00`, "Meeting mit Kunde", until(`${MON}T10:00:00`)),
        ev(`${MON}T11:00:00`, "Physio Knie", until(`${MON}T11:45:00`)),
        ev(`${MON}T12:00:00`, "Intervalle", { ...until(`${MON}T13:00:00`), source: "nolio", kind: "block" }),
        ev(`${MON}T13:00:00`, "Pilgerführer lesen", { ...until(`${MON}T13:30:00`), kind: "block", goal_id: "g-camino" }),
        { ...ev(`${MON}T14:00:00`, "Lauf", { ...until(`${MON}T14:30:00`), kind: "block", goal_id: "g-run" }), id: "e-no" },
        ev(`${MON}T22:00:00`, "Noch nicht vorbei", until(`${MON}T23:00:00`)),
      ],
      goalTime: [{ goal_id: "g-run", minutes: 0, event_id: "e-no", source: "block" }],
    });
    expect(g).toEqual([]);
  });
  it("a win of the day comes first", () => {
    expect(first(evening({ habits: [{ title: "Lesen" }], events: [ev(`${MON}T15:30:00`, "Malen mit Lina", until(`${MON}T16:30:00`))] }))).toBe("Heute abgehakt: Lesen.");
  });
});

describe("timing", () => {
  it("a running entry: wait while it ends within the slot's hour, else skip (and nothing while none runs)", () => {
    const now = localParts(at(`${MON}T07:31:00`), TZ);
    const due = 450; // 07:30
    expect(runningUntil([ev(`${MON}T07:00:00`, "Joggen", until(`${MON}T07:50:00`))], at(`${MON}T07:31:00`))).toBe(Date.parse(iso(`${MON}T07:50:00`)));
    expect(busyDecision([ev(`${MON}T07:00:00`, "Joggen", until(`${MON}T07:50:00`))], at(`${MON}T07:31:00`), now, due)).toBe("wait");
    // ends 08:20: the last run of the hour (08:16) cannot see it over in time
    expect(busyDecision([ev(`${MON}T07:00:00`, "Joggen", until(`${MON}T08:20:00`))], at(`${MON}T07:31:00`), now, due)).toBe("skip");
    expect(busyDecision([ev(`${MON}T06:45:00`, "Frühdienst", until(`${MON}T15:00:00`))], at(`${MON}T07:31:00`), now, due)).toBe("skip");
    // one without an end lasts an hour; an all-day one never «runs»
    expect(busyDecision([ev(`${MON}T07:00:00`, "Kaffee mit Mia")], at(`${MON}T07:31:00`), now, due)).toBe("wait");
    expect(busyDecision([{ ...ev(`${MON}T00:00:00`, "Ferien"), all_day: true }], at(`${MON}T07:31:00`), now, due)).toBeNull();
    expect(busyDecision([ev(`${MON}T09:00:00`, "Später")], at(`${MON}T07:31:00`), now, due)).toBeNull();
  });

  it("after an entry that ended after 22:00 the morning comes 2 hours later, or not at all after 11:00", () => {
    const late = [ev("2026-11-15T14:00:00", "Spätdienst", until("2026-11-15T22:30:00"))];
    expect(endedLate(late, at(`${MON}T07:30:00`), TZ)).toBe(true);
    // ended at 22:00 sharp, or one that began today (an early run), or one still running: no late night
    expect(endedLate([ev("2026-11-15T18:00:00", "Kino", until("2026-11-15T22:00:00"))], at(`${MON}T07:30:00`), TZ)).toBe(false);
    expect(endedLate([ev(`${MON}T05:00:00`, "Früh", until(`${MON}T06:00:00`))], at(`${MON}T07:30:00`), TZ)).toBe(false);
    expect(endedLate([ev("2026-11-15T22:00:00", "Nachtdienst", until(`${MON}T07:00:00`))], at(`${MON}T07:30:00`), TZ)).toBe(true); // ended this morning
    expect(slotDueAt("morning", "07:30:00", 0, true)).toEqual({ minutes: 570, skip: false });
    expect(slotDueAt("morning", "07:30:00", 5, true)).toEqual({ minutes: 660, skip: false }); // Saturday 09:00 + 2 h = 11:00
    expect(slotDueAt("morning", "09:30:00", 0, true)).toEqual({ minutes: 570, skip: true });
    expect(slotDueAt("evening", "21:00:00", 0, true)).toEqual({ minutes: 1260, skip: false }); // the evening never moves
    const p = { notify_morning: "07:30:00", notify_evening: "21:00:00", last_morning_push: null, last_evening_push: null };
    expect(dueSlot(p, localParts(at(`${MON}T07:31:00`), TZ), true)).toBeNull();
    expect(dueSlot(p, localParts(at(`${MON}T09:31:00`), TZ), true)).toBe("morning");
  });

  it("the weekend +90 only for the morning", () => {
    const p = { notify_morning: "07:30:00", notify_evening: "21:00:00", last_morning_push: null, last_evening_push: null };
    expect(dueSlot(p, localParts(at(`${SAT}T07:45:00`), TZ))).toBeNull();
    expect(dueSlot(p, localParts(at(`${SAT}T09:01:00`), TZ))).toBe("morning");
    expect(dueSlot(p, localParts(at(`${SAT}T21:01:00`), TZ))).toBe("evening");
  });
});

describe("the morning", () => {
  it("leaves out entries already running (P1: no «Um 06:45 geht es los: Frühdienst.» at 07:30)", () => {
    const g = morning({ events: [ev(`${MON}T06:45:00`, "Frühdienst", until(`${MON}T15:00:00`)), ev(`${MON}T17:00:00`, "Chor")] });
    expect(first(g)).toBe("Heute: 17:00 Chor.");
    expect(g.flat().map((c) => c.body).join(" ")).not.toMatch(/Frühdienst/);
  });
  it("names an evening entry as «heute Abend um …»", () => {
    expect(morning({ events: [ev(`${MON}T21:30:00`, "10 Minuten dehnen")] })[0].map((c) => c.body)).toEqual([
      "Heute Abend um 21:30: 10 Minuten dehnen.",
      "Montag: heute Abend um 21:30 10 Minuten dehnen.",
      "Heute Abend um 21:30 steht an: 10 Minuten dehnen.",
      "Heute ein Eintrag, am Abend um 21:30.",
    ]);
    expect(first(morning({ events: [ev(`${MON}T10:00:00`, "Vorlesung"), ev(`${MON}T21:30:00`, "Dehnen")] }))).toBe("Heute: 10:00 Vorlesung, heute Abend um 21:30 Dehnen.");
  });
  it("an entry of every day is named at most twice in 7 days", () => {
    const daily = [-3, -2, -1, 0].map((d) => ev(`${addDays(MON, d)}T21:30:00`, "10 Minuten dehnen"));
    expect(dailyTitles(daily, MON, TZ)).toEqual(new Set(["10 minuten dehnen"]));
    expect(dailyTitles(daily.slice(2), MON, TZ).size).toBe(0); // one day before is not «every day»
    const key = fingerprint("10 Minuten dehnen");
    expect(first(morning({ events: daily, named: { [key]: 1 } }))).toBe("Heute Abend um 21:30: 10 Minuten dehnen.");
    expect(morning({ events: daily, named: { [key]: 2 } })).toEqual([]);
    // the same entry not on most days before: named as usual
    expect(first(morning({ events: daily.slice(3), named: { [key]: 5 } }))).toBe("Heute Abend um 21:30: 10 Minuten dehnen.");
    // the count: sent bodies of the last 7 days that named it (fingerprints only)
    const history = [0, 1, 2, 7].map((d) => ({ day: addDays(MON, -d), slot: "morning", status: "sent", named: [key] }));
    expect(namedCounts([...history, { day: MON, slot: "evening", status: "skipped", named: [key] }], MON)).toEqual({ [key]: 3 });
  });
  it("labels: never «Zeitblock» (P2), a goal's item is no dream item", () => {
    expect(lengthLabel(15)).toBe("deine Viertelstunde");
    expect(lengthLabel(30)).toBe("deine halbe Stunde");
    expect(lengthLabel(60)).toBe("deine Stunde");
    expect(lengthLabel(45)).toBe("dein Eintrag");
    expect(lengthLabel(null)).toBe("dein Eintrag");
    // «Italienisch» is a word of the dream, but «Italienisch im Bus» serves the goal «Italienisch lernen»
    expect(mentionsDream("Italienisch im Bus", goals)).toBe(true);
    expect(mentionsDream("Italienisch im Bus", goals, false)).toBe(false);
    expect(safeLabel("Italienisch im Bus", goals, "g-it")).toBe("Italienisch im Bus");
    expect(safeLabel("Italienisch im Bus", goals)).toBeNull();
    expect(safeLabel("In Italien Italienisch sprechen üben", goals, "g-it")).toBeNull(); // the full dream title still hides it
    const block = ev(`${MON}T12:00:00`, "Abnehmen: Waage", { kind: "block", goal_id: "g-weight", ...until(`${MON}T12:15:00`) });
    expect(first(morning({ events: [block] }))).toBe("Heute: 12:00 deine Viertelstunde.");
  });
});

describe("the pause: one line from her own data after 2 to 3 days, then silent", () => {
  const a = (lastOpen: string | null, since: string | null = null) => ({ lastOpen: lastOpen ? iso(lastOpen) : null, lastTalk: null, since: since ? iso(since) : null });
  it("pauseState: nothing for under 2 days, the line from 2 until 4 days, then silent; silent once it went out", () => {
    expect(pauseState(at(`${MON}T07:30:00`), a("2026-11-15T07:31:00"))).toBeNull();
    expect(pauseState(at(`${MON}T07:30:00`), a("2026-11-14T07:30:00"))).toBe("line");
    expect(pauseState(at(`${MON}T07:30:00`), a("2026-11-12T08:00:00"))).toBe("line");
    expect(pauseState(at(`${MON}T07:30:00`), a("2026-11-12T07:00:00"))).toBe("silent");
    expect(pauseState(at(`${MON}T07:30:00`), a("2026-11-14T07:00:00"), true)).toBe("silent");
    expect(pauseState(at(`${MON}T07:30:00`), a(null, "2026-11-13T10:00:00"))).toBe("line"); // from her sign-up
    expect(pauseState(at(`${MON}T07:30:00`), a(null))).toBeNull();
  });
  it("the line counts as sent only after her last open", () => {
    const h = [{ day: "2026-11-14", slot: "morning", status: "sent", template: "p.entry.1", created_at: iso("2026-11-14T07:31:00") }];
    expect(pauseLineSent(h, a("2026-11-12T20:00:00"))).toBe(true);
    expect(pauseLineSent(h, a("2026-11-14T12:00:00"))).toBe(false); // she was there after it
    expect(pauseLineSent([{ ...h[0], template: "m.day.1" }], a("2026-11-12T20:00:00"))).toBe(false);
    expect(pauseLineSent([{ ...h[0], status: "skipped" }], a("2026-11-12T20:00:00"))).toBe(false);
  });
  it("the next entry or step, never a word about the pause; nothing when she has nothing coming", () => {
    const f = (events: PushEvent[], steps: { title: string; goal_id: string; due_date: string | null }[] = []) => pauseCandidates({ events, steps, goals }, at(`${MON}T07:30:00`), TZ);
    expect(f([ev("2026-11-17T09:00:00", "Vorlesung"), ev("2026-11-18T09:00:00", "Chor")])[0].map((c) => c.body)).toEqual(["Morgen: 09:00 Vorlesung.", "Als Nächstes: morgen um 09:00 Vorlesung."]);
    expect(first(f([ev(`${MON}T19:30:00`, "Chor")]))).toBe("Heute Abend um 19:30: Chor.");
    expect(first(f([], [{ title: "Startnummer abholen", goal_id: "g-run", due_date: "2026-11-19" }]))).toBe("Am Donnerstag an der Reihe: Startnummer abholen.");
    // never a dream, nothing sensitive, nothing further than six days
    expect(f([ev("2026-11-17T09:00:00", "Pilgerpass", { goal_id: "g-camino" }), ev("2026-11-17T10:00:00", "Physio"), ev("2026-11-24T09:00:00", "Weit weg")])).toEqual([]);
    for (const c of f([ev("2026-11-17T09:00:00", "Vorlesung")]).flat()) expect(c.body).not.toMatch(/Pause|lange|vermiss|wieder|zurück/i);
  });
});

describe("reminders (owner decision 2 «Blöcke und Wunsch»)", () => {
  const r = (local: string, title: string, extra: Partial<ReminderEvent> = {}): ReminderEvent => ({
    ...ev(local, title, { kind: "block", goal_id: "g-run", source: "coach", ...until(`${local.slice(0, 11)}${String(+local.slice(11, 13) + 1).padStart(2, "0")}:00:00`) }),
    id: `id-${title}`,
    reminder_minutes: 10,
    ...extra,
  });
  const recent = { lastOpen: iso("2026-11-15T20:00:00"), lastTalk: null };

  it("reminderAt: starts_at − reminder_minutes for a block or one she asked for; never Nolio, all-day, none set or more than a day ahead", () => {
    expect(reminderAt(r(`${MON}T10:00:00`, "Lauf"))).toBe(Date.parse(iso(`${MON}T09:50:00`)));
    expect(reminderAt(r(`${MON}T10:00:00`, "Wecker", { kind: "termin", reminder_minutes: 0, reminder_asked: true }))).toBe(Date.parse(iso(`${MON}T10:00:00`)));
    expect(reminderAt(r(`${MON}T10:00:00`, "Zahnarzt", { kind: "termin" }))).toBeNull();
    expect(reminderAt(r(`${MON}T10:00:00`, "Intervalle", { source: "nolio" }))).toBeNull();
    expect(reminderAt(r(`${MON}T10:00:00`, "Intervalle", { source: "nolio", reminder_asked: true }))).toBeNull();
    expect(reminderAt({ ...r(`${MON}T10:00:00`, "Ferien"), all_day: true })).toBeNull();
    expect(reminderAt(r(`${MON}T10:00:00`, "Lauf", { reminder_minutes: null }))).toBeNull();
    expect(reminderAt(r(`${MON}T10:00:00`, "Lauf", { reminder_minutes: 2880 }))).toBeNull();
  });

  it("eligibility: only while her iPhone calendar is not subscribed (fetched within 3 days = subscribed)", () => {
    expect(calendarSubscribed(null, at(`${MON}T09:00:00`))).toBe(false);
    expect(calendarSubscribed(iso(`${MON}T03:00:00`), at(`${MON}T09:00:00`))).toBe(true);
    expect(calendarSubscribed(new Date(at(`${MON}T09:00:00`).getTime() - CALENDAR_FRESH_DAYS * 86400e3 + 60e3).toISOString(), at(`${MON}T09:00:00`))).toBe(true);
    expect(calendarSubscribed(iso("2026-11-12T08:00:00"), at(`${MON}T09:00:00`))).toBe(false);
    expect(calendarSubscribed("kaputt", at(`${MON}T09:00:00`))).toBe(false);
  });

  it("the window: its moment within the next 15 minutes (or up to 5 behind), never once the entry began", () => {
    const due = (local: string, events: ReminderEvent[], extra: { sentToday?: number; answered?: string[] } = {}) =>
      dueReminders({ events, answered: new Set(extra.answered ?? []), sentToday: extra.sentToday ?? 0, activity: recent, goals }, at(local)).map((e) => e.title);
    const lauf = [r(`${MON}T10:00:00`, "Lauf")];
    expect(due(`${MON}T09:34:59`, lauf)).toEqual([]);
    expect(due(`${MON}T09:35:00`, lauf)).toEqual(["Lauf"]);
    expect(due(`${MON}T09:50:00`, lauf)).toEqual(["Lauf"]);
    expect(due(`${MON}T09:55:00`, lauf)).toEqual(["Lauf"]);
    expect(due(`${MON}T09:56:00`, lauf)).toEqual([]);
    // a wake-up call at 07:00 sharp comes in the run before
    expect(due(`${MON}T06:46:00`, [r(`${MON}T07:00:00`, "Aufstehen", { kind: "termin", reminder_minutes: 0, reminder_asked: true })])).toEqual(["Aufstehen"]);
    expect(due(`${MON}T07:00:00`, [r(`${MON}T07:00:00`, "Aufstehen", { kind: "termin", reminder_minutes: 0, reminder_asked: true })])).toEqual([]);
    // an answered block (done early, a habit tick) has nothing to remind of
    expect(due(`${MON}T09:46:00`, lauf, { answered: ["id-Lauf"] })).toEqual([]);
  });

  it("a run that starts on the minute still has a moment at the end of its span (a wake-up call at 07:00 sharp)", () => {
    const wake = r(`${MON}T07:00:00`, "Aufstehen", { kind: "termin", reminder_minutes: 0, reminder_asked: true });
    // runs at 06:45:00.000 and 07:00:00.000: the first one sends it, the second is too late (it began)
    expect(reminderInRun(wake, at(`${MON}T06:45:00`).getTime())).toBe(true);
    expect(reminderInRun(wake, at(`${MON}T07:00:00`).getTime())).toBe(false);
    expect(reminderInRun(wake, at(`${MON}T06:44:59`).getTime())).toBe(false);
    // a block at 10:00 with 10 minutes: the runs at 09:45 and 09:50 (the overlap: the push log keeps it once)
    const lauf = r(`${MON}T10:00:00`, "Lauf");
    expect([`${MON}T09:30:00`, `${MON}T09:35:00`, `${MON}T09:45:00`, `${MON}T09:50:00`, `${MON}T09:55:00`, `${MON}T09:55:01`].map((t) => reminderInRun(lauf, at(t).getTime()))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("the day it belongs to is the day of its moment: the runs before and after midnight share it (once per entry)", () => {
    // an entry at 00:05 with 10 minutes: its moment is 23:55; the run at 23:45 and the one at 00:00 both see it
    const late = r("2026-11-17T00:05:00", "Nachtzug", { kind: "termin", reminder_asked: true });
    expect(reminderInRun(late, at(`${MON}T23:45:00`).getTime())).toBe(true);
    expect(reminderInRun(late, at("2026-11-17T00:00:00").getTime())).toBe(true);
    expect(reminderDay(late, TZ)).toBe(MON);
    // a reminder a day ahead belongs to the day it rings, not to the entry's
    expect(reminderDay(r("2026-11-17T10:00:00", "Lauf", { reminder_minutes: 1440 }), TZ)).toBe(MON);
    // across the switch to summer time (Zurich, 29 March 2026): starts_at − 30 minutes, her local day
    const spring = { ...r("2026-03-29T03:10:00", "Früh", { reminder_minutes: 30 }), starts_at: "2026-03-29T01:10:00.000Z" };
    expect(new Date(reminderAt(spring)!).toISOString()).toBe("2026-03-29T00:40:00.000Z");
    expect(reminderDay(spring, TZ)).toBe("2026-03-29");
    expect(reminderDay(r(`${MON}T10:00:00`, "Ferien", { all_day: true }), TZ)).toBeNull();
  });

  it("a dream's block only when she asked for the reminder (dreams are never pushed otherwise); goals unknown: only what she asked for", () => {
    const events = [
      r(`${MON}T10:00:00`, "Jakobsweg: Etappen planen", { goal_id: "g-camino" }),
      r(`${MON}T10:00:00`, "Nachricht an die Stationsleitung", { goal_id: "g-camino", reminder_asked: true }),
      r(`${MON}T10:00:00`, "Intervalle"),
      r(`${MON}T10:00:00`, "Fokuszeit", { goal_id: null }),
      r(`${MON}T10:00:00`, "Unbekannt", { goal_id: "g-gone" }),
    ];
    const due = (g: PushGoal[] | null) => dueReminders({ events, answered: new Set(), sentToday: 0, activity: recent, goals: g }, at(`${MON}T09:46:00`)).map((e) => e.title);
    expect(due(goals)).toEqual(["Nachricht an die Stationsleitung", "Intervalle", "Fokuszeit"]);
    expect(due(null)).toEqual(["Nachricht an die Stationsleitung", "Fokuszeit"]);
    // a dream's block does not take one of the three
    const four = [...events.slice(0, 1), ...[0, 1, 2].map((i) => r(`${MON}T10:0${i}:00`, `B${i}`))];
    expect(dueReminders({ events: four, answered: new Set(), sentToday: 0, activity: recent, goals }, at(`${MON}T09:50:00`)).map((e) => e.title)).toEqual(["B0", "B1", "B2"]);
  });

  it("at most three a day, the earliest first", () => {
    const near = [0, 1, 2, 3].map((i) => r(`${MON}T09:0${i}:00`, `N${i}`));
    const due = (sentToday: number) => dueReminders({ events: near, answered: new Set(), sentToday, activity: recent, goals }, at(`${MON}T08:50:00`)).map((e) => e.title);
    expect(REMINDERS_PER_DAY).toBe(3);
    expect(due(0)).toEqual(["N0", "N1", "N2"]);
    expect(due(2)).toEqual(["N0"]);
    expect(due(3)).toEqual([]);
  });

  it("what she asked for is never crowded out by her blocks: hers first, and the blocks leave room for hers later today", () => {
    const run = (events: ReminderEvent[], sentToday: number, laterAsked: number) =>
      dueReminders({ events, answered: new Set(), sentToday, activity: recent, goals, laterAsked }, at(`${MON}T08:50:00`)).map((e) => e.title);
    const blocks = [0, 1, 2].map((i) => r(`${MON}T09:0${i}:00`, `B${i}`));
    const mine = r(`${MON}T09:03:00`, "Anruf Bank", { kind: "termin", reminder_asked: true });
    // in the same run: hers comes, the earliest blocks fill what is left (in the order of the day)
    expect(run([...blocks, mine], 0, 0)).toEqual(["B0", "B1", "Anruf Bank"]);
    expect(run([...blocks, mine], 2, 0)).toEqual(["Anruf Bank"]);
    // two of hers still to come today: one block now, then hers
    expect(run(blocks, 0, 2)).toEqual(["B0"]);
    expect(run(blocks, 1, 2)).toEqual([]);
    expect(run([mine], 2, 1)).toEqual(["Anruf Bank"]);
    // the three a day stay three, also for hers
    expect(run([mine], 3, 0)).toEqual([]);
  });

  it("laterAskedToday: hers that ring later today, after this run (not today's that rang already, not tomorrow's)", () => {
    const now = at(`${MON}T08:50:00`);
    const events = [
      r(`${MON}T15:00:00`, "Anruf", { kind: "termin", reminder_asked: true }),
      r(`${MON}T23:58:00`, "Spät", { kind: "termin", reminder_asked: true, reminder_minutes: 0 }),
      r(`${MON}T09:00:00`, "Jetzt gleich", { kind: "termin", reminder_asked: true }),
      r("2026-11-17T00:20:00", "Nach Mitternacht", { kind: "termin", reminder_asked: true }),
      r("2026-11-17T09:00:00", "Morgen, einen Tag vorher", { kind: "termin", reminder_asked: true, reminder_minutes: 1440 }),
      r(`${MON}T16:00:00`, "Block", {}),
      // all-day, counted from the midnight its day begins: tomorrow's at 18:00 today (360) counts, one not asked never
      r("2026-11-17T00:00:00", "Ganztag gefragt", { kind: "termin", reminder_asked: true, all_day: true, ends_at: null, reminder_minutes: 360 }),
      r("2026-11-18T00:00:00", "Ganztag ungefragt", { kind: "termin", all_day: true, ends_at: null, reminder_minutes: 360 }),
    ];
    // «Anruf» (14:50), «Spät» (23:58) and «Ganztag gefragt» (18:00); «Jetzt gleich» (08:50) rings in this run, «Nach
    // Mitternacht» (00:10) and «Morgen, einen Tag vorher» (09:00) tomorrow; a block never counts
    expect(laterAskedToday(events, now, TZ)).toBe(3);
  });

  it("away a few days: only what she asked for; after 14 days none", () => {
    const events = [r(`${MON}T10:00:00`, "Lauf"), r(`${MON}T10:00:00`, "Paket", { kind: "termin", reminder_asked: true })];
    const due = (lastOpen: string) =>
      dueReminders({ events, answered: new Set(), sentToday: 0, activity: { lastOpen: iso(lastOpen), lastTalk: null }, goals }, at(`${MON}T09:46:00`)).map((e) => e.title);
    expect(due("2026-11-15T20:00:00")).toEqual(["Lauf", "Paket"]);
    expect(due("2026-11-13T20:00:00")).toEqual(["Paket"]);
    expect(due("2026-11-01T20:00:00")).toEqual([]);
  });

  it("remindedSoon: her reminders within the hour as dueReminders would send them, for the morning and the pause line to leave out", () => {
    const events = [
      r(`${MON}T08:00:00`, "Italienisch"), // 07:50: within the hour
      r(`${MON}T09:00:00`, "Kraft"), // 08:50: later
      r(`${MON}T07:35:00`, "Schon gemacht"), // answered
      r(`${MON}T08:10:00`, "Island", { goal_id: "g-camino" }), // a dream's block she did not ask for: no reminder
      r(`${MON}T08:15:00`, "Paket", { kind: "termin", goal_id: null, reminder_asked: true }),
      r(`${MON}T07:30:00`, "Läuft schon"),
    ];
    const soon = (lastOpen: string) =>
      [...remindedSoon({ events, answered: new Set(["id-Schon gemacht"]), activity: { lastOpen: iso(lastOpen), lastTalk: null }, goals }, at(`${MON}T07:30:00`))].sort();
    expect(soon("2026-11-15T20:00:00")).toEqual(["id-Italienisch", "id-Paket"]);
    // away a few days: only what she asked for comes, so only that is left out
    expect(soon("2026-11-13T20:00:00")).toEqual(["id-Paket"]);
    expect(soon("2026-11-01T20:00:00")).toEqual([]);
    // the morning without it, the pause line too
    const list = [ev(`${MON}T08:00:00`, "Intervalle", { id: "id-Italienisch", kind: "block", goal_id: "g-run" }), ev(`${MON}T12:15:00`, "Volkshochschule anrufen", { id: "e-vhs" })];
    expect(first(morning({ events: list }))).toBe("Heute: 08:00 Intervalle, 12:15 Volkshochschule anrufen.");
    expect(first(morning({ events: list, remindSoon: new Set(["id-Italienisch"]) }))).toBe("Heute: 12:15 Volkshochschule anrufen.");
    expect(first(pauseCandidates({ events: list, steps: [], goals, remindSoon: new Set(["id-Italienisch"]) }, at(`${MON}T07:30:00`), TZ))).toBe("Heute: 12:15 Volkshochschule anrufen.");
  });

  it("the message: her title via safeLabel; one she asked for may name a dream step (her own alarm), never a sensitive word", () => {
    const msg = (e: ReminderEvent, when = `${MON}T09:46:00`) => {
      const m = reminderMessage(e, goals, at(when), TZ);
      return `${m.title} · ${m.body} · ${m.template}`;
    };
    expect(msg(r(`${MON}T10:00:00`, "Intervalle"))).toBe("Um 10:00 · Intervalle. · r.block");
    expect(msg(r(`${MON}T10:00:00`, "Nachricht an die Stationsleitung", { kind: "termin", goal_id: "g-camino", reminder_asked: true }))).toBe(
      "Um 10:00 · Nachricht an die Stationsleitung. · r.asked",
    );
    expect(msg(r(`${MON}T10:00:00`, "Jakobsweg: Etappen planen", { kind: "termin", goal_id: "g-camino", reminder_asked: true }))).toBe("Um 10:00 · Jakobsweg: Etappen planen. · r.asked");
    // a sensitive title: never on the lock screen (a dream's block she did not ask for gets no reminder at all, above)
    expect(msg(r(`${MON}T10:00:00`, "Physio Knie", { kind: "termin", goal_id: null, reminder_asked: true }))).toBe("Um 10:00 · Dein Termin. · r.asked");
    expect(msg(r(`${MON}T10:00:00`, "Krafttraining", { goal_id: "g-weight" }))).toBe("Um 10:00 · Deine Stunde. · r.block");
    // the next morning (a reminder up to a day ahead), and a later weekday
    expect(msg(r("2026-11-17T07:00:00", "Laufen"), `${MON}T21:00:00`)).toBe("Morgen um 07:00 · Laufen. · r.block");
    // goals unknown (the query failed): no title at all
    expect(reminderMessage(r(`${MON}T10:00:00`, "Intervalle"), null, at(`${MON}T09:46:00`), TZ).body).toBe("Deine Stunde.");
  });
});

describe("D2: a habit that serves a goal counts its minutes", () => {
  const habit = { id: "8b0c6b1e-0000-4000-8000-000000000001", title: "10 Minuten dehnen", goal_id: "g-run", minutes: 10 };
  const day = MON;
  // the tick at 22:00, after the evening's block began
  const opts = (blocks: Parameters<typeof habitTimeRow>[2]["blocks"] = [], times: Parameters<typeof habitTimeRow>[2]["times"] = [], now = at(`${MON}T22:00:00`).getTime()) => ({
    blocks,
    times,
    dayOfIso: (s: string) => localParts(new Date(s), TZ).date,
    now,
  });
  const block = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, goal_id: "g-run", starts_at: iso(`${MON}T21:30:00`), all_day: false, kind: "block", source: "coach", answered: false, ...extra });

  it("one row per habit and day, external_id «habit-id:day»", () => {
    expect(habitTimeKey("8B0C6B1E-0000-4000-8000-000000000001", day)).toBe("8b0c6b1e-0000-4000-8000-000000000001:2026-11-16");
    expect(habitTimeRow(habit, day, opts())).toEqual({ goal_id: "g-run", day, minutes: 10, source: "habit", external_id: habitTimeKey(habit.id, day), event_id: null });
  });
  it("nothing without a goal or a length (a tick then counts no time, as before)", () => {
    expect(habitTimeRow({ ...habit, goal_id: null }, day, opts())).toBeNull();
    expect(habitTimeRow({ ...habit, minutes: null }, day, opts())).toBeNull();
    expect(habitTimeRow({ ...habit, minutes: 0 }, day, opts())).toBeNull();
    expect(habitTimeRow({ ...habit, minutes: 721 }, day, opts())).toBeNull();
  });
  it("the same thing as an open block of that day: the tick answers the block (they count once)", () => {
    expect(habitTimeRow(habit, day, opts([block("b1", "Dehnen")]))?.event_id).toBe("b1");
    // already answered: nothing more
    expect(habitTimeRow(habit, day, opts([block("b1", "Dehnen", { answered: true })]))).toBeNull();
    // another thing for the goal, her trainer's, another day, all-day: not the same block
    expect(habitTimeRow(habit, day, opts([block("b2", "Intervalle")]))?.event_id).toBeNull();
    expect(habitTimeRow(habit, day, opts([block("b3", "Dehnen", { source: "nolio" })]))?.event_id).toBeNull();
    expect(habitTimeRow(habit, day, opts([block("b4", "Dehnen", { starts_at: iso("2026-11-17T21:30:00") })]))?.event_id).toBeNull();
    expect(habitTimeRow(habit, day, opts([block("b5", "Dehnen", { all_day: true })]))?.event_id).toBeNull();
    // ticked before the block began: her own time, the block keeps its reminder and its own answer (K6); once it
    // began (or is over) the tick answers it
    expect(habitTimeRow(habit, day, opts([block("b1", "Dehnen")], [], at(`${MON}T12:17:00`).getTime()))).toMatchObject({ minutes: 10, event_id: null });
    expect(habitTimeRow(habit, day, opts([block("b1", "Dehnen")], [], at(`${MON}T21:30:00`).getTime()))?.event_id).toBe("b1");
    // a later block answered early (she said it was done) still counts once with the tick
    expect(habitTimeRow(habit, day, opts([block("b1", "Dehnen", { answered: true })], [], at(`${MON}T12:17:00`).getTime()))).toBeNull();
  });
  it("the same minutes for the goal that day already there (said in conversation, D1): no second count", () => {
    expect(habitTimeRow(habit, day, opts([], [{ goal_id: "g-run", day, minutes: 10, source: "coach" }]))).toBeNull();
    expect(habitTimeRow(habit, day, opts([], [{ goal_id: "g-run", day, minutes: 25, source: "coach" }]))?.minutes).toBe(10);
    // its own row does not block itself (a second tick goes to the unique index)
    expect(habitTimeRow(habit, day, opts([], [{ goal_id: "g-run", day, minutes: 10, source: "habit", external_id: habitTimeKey(habit.id, day) }]))?.minutes).toBe(10);
  });

  it("the demo mirrors it: a tick counts, a second tick does not, an untick removes it", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    const b = new DemoBackend();
    await b.signUp("demo.dehnen", "geheim1234");
    const today = dayOf();
    const goal = await b.addGoal({ title: "Beweglich bleiben" });
    const h = await b.addHabit({ title: "10 Minuten dehnen", per_week: 7, goal_id: goal.id, minutes: 10 });
    const rows = async () => (await b.exportData()).goal_time.filter((t: { source: string }) => t.source === "habit");
    await b.setHabitDone(h.id, today, true);
    await b.setHabitDone(h.id, today, true);
    expect((await rows()).map((t: { minutes: number; external_id: string | null }) => [t.minutes, t.external_id])).toEqual([[10, habitTimeKey(h.id, today)]]);
    expect((await b.listGoals(true)).find((g) => g.id === goal.id)?.time?.logged_minutes).toBe(10);
    await b.setHabitDone(h.id, today, false);
    expect(await rows()).toEqual([]);
    // a habit without a length counts nothing
    const plain = await b.addHabit({ title: "Lesen", per_week: 3, goal_id: goal.id });
    await b.setHabitDone(plain.id, today, true);
    expect(await rows()).toEqual([]);
  }, 20000);
});
