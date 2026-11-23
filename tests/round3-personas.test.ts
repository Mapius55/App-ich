// Round 3, corrections from the offline persona replay (Jonas, Lea, Mia, Peter, Sara): what the code decides, with the
// personas' own recorded data. Each block failed on 6f302a6 and holds the corrected rule. The dispatch around the push
// rules is in tests/push-dispatch.test.ts («after the persona replay»), the coach's context line for K7 in
// tests/round3-coach.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dailyTitles,
  dueReminders,
  eveningCandidates,
  fingerprint,
  morningCandidates,
  reminderAt,
  reminderInRun,
  reminderMessage,
  safeLabel,
  type PushEvent,
  type PushGoal,
  type ReminderEvent,
} from "../supabase/functions/_shared/push_text";
import { addDays, dailySituation, dailyNudge, eveningEntries, goalDayMinutes, habitMatchesBlock, habitTimeRow, reviewWeek, workEntry } from "../supabase/functions/_shared/plan";
import { MODE_ONBOARDING, PERSONA } from "../supabase/functions/coach/prompt";
import { syncDemoSeries } from "../src/lib/demoBackend";
import type { SeriesRule } from "../supabase/functions/_shared/series";

const TZ = "Europe/Zurich";
const at = (local: string) => new Date(`${local}+01:00`); // CET from November to March
const iso = (local: string) => at(local).toISOString();
const zurich = (s: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(s));
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// ---------- Jonas F1: his job «Veloladen» is work ----------

describe("Jonas: «Veloladen», his job, is work, so the evening never names it", () => {
  it("a shop in a compound word is work; inviting, charging, uploading, a shutter or chocolate are not", () => {
    for (const t of ["Veloladen", "Bioladen", "im Laden", "Laden", "Veloladen Schicht"]) expect(workEntry(t)).toBe(true);
    for (const t of ["Freunde einladen", "Handy aufladen", "Fotos hochladen", "Fensterladen streichen", "Schokoladen probieren", "Auto ausladen", "Malen mit Lina"])
      expect(workEntry(t)).toBe(false);
  });

  it("the evening without a win: no «Heute um 09:00: Veloladen.» (19.11 and 26.11), another own entry is named", () => {
    const goals: PushGoal[] = [{ id: "g-ba", title: "Bachelorarbeit Hitzeinseln Zürich", kind: "goal", status: "active" }];
    const shop: PushEvent = { id: "e-shop", title: "Veloladen", starts_at: iso("2026-11-19T09:00:00"), ends_at: iso("2026-11-19T17:00:00"), all_day: false, kind: "termin" };
    const football: PushEvent = { id: "e-fb", title: "Fussball mit Freunden", starts_at: iso("2026-11-19T18:00:00"), ends_at: iso("2026-11-19T19:30:00"), all_day: false, kind: "termin" };
    const evening = (events: PushEvent[]) => eveningCandidates({ goals, goalTime: [], milestones: [], habits: [], events }, at("2026-11-19T21:00:00"), TZ);
    expect(evening([shop])).toEqual([]);
    expect(evening([shop, football])[0][0].body).toBe("Heute war: 18:00 Fussball mit Freunden.");
    expect(eveningEntries([{ ...shop, id: "e-shop", all_day: false, ends_at: shop.ends_at!, kind: "termin" }], { now: at("2026-11-19T21:00:00").getTime(), today: "2026-11-19", dayOfIso: zurich })).toEqual([]);
  });
});

// ---------- Jonas F2: the goal's own title in the evening (P2 (a)) ----------

describe("Jonas: the evening names his goal, though «Zürich» is a word of his dream (P2)", () => {
  const goals: PushGoal[] = [
    { id: "g-ba", title: "Bachelorarbeit Hitzeinseln Zürich", kind: "goal", status: "active" },
    { id: "g-velo", title: "Mit dem Velo von Zürich ans Meer", kind: "dream", status: "active" },
  ];
  const evening = (f: { goalTime?: { goal_id: string; minutes: number; source?: string }[]; goals?: PushGoal[] }, when = "2026-12-04T21:00:00") =>
    eveningCandidates({ goals: f.goals ?? goals, goalTime: f.goalTime ?? [], milestones: [], habits: [] }, at(when), TZ);

  it("time for it today: «Heute 1 Stunde für Bachelorarbeit Hitzeinseln Zürich.» (round 2 and 3 on 4.12: «für dein Ziel»)", () => {
    expect(evening({ goalTime: [{ goal_id: "g-ba", minutes: 60, source: "block" }] })[0][0].body).toBe("Heute 1 Stunde für Bachelorarbeit Hitzeinseln Zürich.");
  });

  it("reached today: its title too", () => {
    const done = goals.map((g) => (g.id === "g-ba" ? { ...g, status: "done", done_at: iso("2026-12-04T15:00:00") } : g));
    expect(evening({ goals: done })[0][0].body).toBe("Heute erreicht: Bachelorarbeit Hitzeinseln Zürich.");
  });

  it("still never a dream: a goal whose title holds the whole dream title, or a sensitive one, stays unnamed", () => {
    const withDream = [...goals, { id: "g-x", title: "Training: Mit dem Velo von Zürich ans Meer", kind: "goal", status: "active" }];
    expect(evening({ goals: withDream, goalTime: [{ goal_id: "g-x", minutes: 60 }] })[0][0].body).toBe("Heute 1 Stunde für dein Ziel.");
    expect(safeLabel("Physio nach der OP", goals, "g-ba")).toBeNull();
  });
});

// ---------- Jonas F3, Lea F1, Mia F1: no Wochenblick for a week before her first day ----------

describe("Jonas, Lea, Mia: on her second day no Wochenblick for the week before she began", () => {
  const review = { week: null, declines: 0, wanted: null };
  const day2 = (o: { now: string; spoke: string; startDay: string | null }) =>
    dailySituation({
      day: "2026-11-17",
      now: at(o.now),
      tz: TZ,
      lastSeenDay: "2026-11-16",
      // the answer to the first greeting after the Kennenlernen, in the day thread of her first day
      lastSpoke: { thread: "2026-11-16", created_at: iso(o.spoke) },
      startDay: o.startDay,
      todayMood: null,
      recentDays: [],
      review,
      hasPlanGoal: true,
    });

  it("Tue 17.11 (Jonas 09:39, Lea 09:39, Mia 07:06), all three began on Monday 16.11: none (it would look back on 9.–15.11)", () => {
    expect(addDays(reviewWeek("2026-11-17", 9 * 60), -7)).toBe("2026-11-09");
    expect(day2({ now: "2026-11-17T09:39:00", spoke: "2026-11-16T21:39:00", startDay: "2026-11-16" }).review).toBeNull(); // Jonas
    expect(day2({ now: "2026-11-17T09:39:00", spoke: "2026-11-16T20:50:00", startDay: "2026-11-16" }).review).toBeNull(); // Lea
    expect(day2({ now: "2026-11-17T07:06:00", spoke: "2026-11-16T21:06:00", startDay: "2026-11-16" }).review).toBeNull(); // Mia
    // so the day's one Anstoss is not spent on it
    const s = day2({ now: "2026-11-17T07:06:00", spoke: "2026-11-16T21:06:00", startDay: "2026-11-16" });
    const nudge = dailyNudge({ today: "2026-11-17", heavy: s.heavy, pause: s.pause, review: s.review, lastDay: null, startDay: "2026-11-16", no: {}, entriesToday: 1, goals: [], dreams: [], experiment: false });
    expect(nudge?.kind).not.toBe("wochenblick");
  });

  it("someone with the app for weeks: as before (K9: a talk without it leaves it due)", () => {
    expect(day2({ now: "2026-11-17T09:39:00", spoke: "2026-11-16T21:39:00", startDay: "2026-10-01" }).review).toBe("anbieten");
    // the start unknown: only her earlier talk decides, as before
    expect(day2({ now: "2026-11-17T09:39:00", spoke: "2026-11-16T21:39:00", startDay: null }).review).toBe("anbieten");
  });

  it("her first own week: from Sunday 22.11 at 16:00 it looks back on 16.–22.11", () => {
    const sunday = dailySituation({
      day: "2026-11-22",
      now: at("2026-11-22T17:00:00"),
      tz: TZ,
      lastSeenDay: "2026-11-21",
      lastSpoke: { thread: "2026-11-21", created_at: iso("2026-11-21T19:00:00") },
      startDay: "2026-11-16",
      todayMood: null,
      recentDays: [],
      review,
      hasPlanGoal: true,
    });
    expect(sunday.review).toBe("anbieten");
  });

  it("begun on a Sunday: none on Monday for the week that ended that day; begun on Saturday: on Sunday from 16:00", () => {
    const monday = dailySituation({
      day: "2026-11-16",
      now: at("2026-11-16T07:40:00"),
      tz: TZ,
      lastSeenDay: "2026-11-15",
      lastSpoke: { thread: "2026-11-15", created_at: iso("2026-11-15T18:00:00") },
      startDay: "2026-11-15",
      todayMood: null,
      recentDays: [],
      review,
      hasPlanGoal: true,
    });
    expect(monday.review).toBeNull();
    const sunday = dailySituation({
      day: "2026-11-15",
      now: at("2026-11-15T17:00:00"),
      tz: TZ,
      lastSeenDay: "2026-11-14",
      lastSpoke: { thread: "2026-11-14", created_at: iso("2026-11-14T18:00:00") },
      startDay: "2026-11-14",
      todayMood: null,
      recentDays: [],
      review,
      hasPlanGoal: true,
    });
    expect(sunday.review).toBe("anbieten");
  });

  it("the coach hands her first day (profiles.created_at, read already) to dailySituation", () => {
    const source = read("../supabase/functions/coach/index.ts");
    expect(source).toContain('startDay: typeof startedAt === "string" && Number.isFinite(Date.parse(startedAt)) ? localDay(startedAt, tz) : null,');
  });
});

// ---------- Mia F2: the reminder she asked for on a rhythm of blocks keeps its mark ----------

describe("Mia: a rhythm whose reminder she asked for carries the mark to its days", () => {
  const rule = (extra: Partial<SeriesRule> = {}): SeriesRule => ({
    id: "s-dehnen",
    goal_id: "g-hm",
    kind: "block",
    title: "10 Minuten dehnen",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    start_time: "21:30",
    duration_minutes: 10,
    location: null,
    reminder_minutes: 0,
    time_zone: TZ,
    start_date: "2026-11-22",
    until_date: null,
    active: true,
    skip_days: [],
    ...extra,
  });
  const user = (s: SeriesRule) => ({
    events: [] as never[],
    goals: [{ id: "g-hm", status: "active", target_date: "2027-04-30" }] as never[],
    goal_time: [] as never[],
    series: [s],
  });
  const now = Date.parse("2026-11-22T12:00:00Z");

  it("the demo, like series_fill and series_sync: asked → every day reminder_asked; taken back → none; a day changed on its own keeps hers", () => {
    const u = user(rule({ reminder_asked: true }));
    syncDemoSeries(u as never, now);
    const days = u.events as unknown as { reminder_asked: boolean; series_day: string; series_exception?: boolean }[];
    expect(days.length).toBeGreaterThan(30);
    expect(days.every((e) => e.reminder_asked === true)).toBe(true);
    // without her ask: a block's own reminder (it rests after a few days away)
    const plain = user(rule());
    syncDemoSeries(plain as never, now);
    expect((plain.events as unknown as { reminder_asked: boolean }[]).some((e) => e.reminder_asked)).toBe(false);
    // taken back for the rhythm; one day she asked for herself stays
    days[3].series_exception = true;
    u.series[0] = { ...u.series[0], reminder_asked: false };
    syncDemoSeries(u as never, now);
    expect(days.filter((e) => e.reminder_asked).map((e) => e.series_day)).toEqual([days[3].series_day]);
  });

  it("so on 27.11 at 21:15, two days after she last opened the app, the 21:30 stretch still reminds her", () => {
    const e: ReminderEvent = { id: "e29c8041", title: "10 Minuten dehnen", starts_at: iso("2026-11-27T21:30:00"), ends_at: iso("2026-11-27T21:40:00"), all_day: false, kind: "block", goal_id: "g-hm", source: "coach", reminder_minutes: 0, reminder_asked: true };
    const goals: PushGoal[] = [{ id: "g-hm", title: "Halbmarathon", kind: "goal", status: "active" }];
    const facts = { events: [e], answered: new Set<string>(), sentToday: 0, activity: { lastOpen: iso("2026-11-25T21:14:00"), lastTalk: iso("2026-11-25T21:14:00") }, goals };
    expect(dueReminders(facts, at("2026-11-27T21:15:00")).map((x) => x.id)).toEqual(["e29c8041"]);
  });

  it("the coach writes the mark (create_series, update_series «erinnern») and the database carries it (new migration)", () => {
    const source = read("../supabase/functions/coach/index.ts");
    expect(source).toContain("...(asked && reminder !== null ? { reminder_asked: true } : {}),");
    expect(source).toContain('erinnern: { type: "boolean", description: "true, wenn sie um eine Erinnerung an seine Tage bittet; false nimmt sie zurück." },');
    expect(source).toContain("patch.reminder_asked = asked;");
    const sql = read("../supabase/migrations/20261126000600_series_reminder_asked.sql");
    expect(sql).toContain("add column if not exists reminder_asked boolean not null default false");
    expect(sql).toContain("s.reminder_minutes is not null and (termin or s.reminder_asked)");
    expect(sql).toContain("asked := s.reminder_minutes is not null and (termin or s.reminder_asked);");
    expect(sql).toContain("new.reminder_minutes, new.reminder_asked, new.kind");
    expect(sql).toMatch(/update of goal_id, kind, title, weekdays, start_time, duration_minutes, location, reminder_minutes,\s+reminder_asked,/);
    // the reviewed round-3 migration stays as it was
    expect(read("../supabase/migrations/20261126000500_termin_series.sql")).toContain("s.reminder_minutes, termin and s.reminder_minutes is not null, s.source");
  });
});

// ---------- Mia F3: an all-day entry she asked a reminder for ----------

describe("Mia: an all-day entry she asked a reminder for reminds her (counted from its midnight)", () => {
  const exam: ReminderEvent = {
    id: "e-bio",
    title: "Bio-Prüfung",
    starts_at: iso("2026-11-26T00:00:00"),
    ends_at: null,
    all_day: true,
    kind: "termin",
    goal_id: null,
    source: "coach",
    reminder_minutes: 360,
    reminder_asked: true,
  };
  const goals: PushGoal[] = [];
  const facts = (e: ReminderEvent) => ({ events: [e], answered: new Set<string>(), sentToday: 0, activity: { lastOpen: iso("2026-11-25T07:00:00"), lastTalk: null }, goals });

  it("«360 = 18 Uhr am Vortag»: at 18:00 on 25.11, in the 17:45 run, as «Morgen | Bio-Prüfung.»", () => {
    expect(reminderAt(exam)).toBe(at("2026-11-25T18:00:00").getTime());
    expect(dueReminders(facts(exam), at("2026-11-25T17:46:00")).map((e) => e.id)).toEqual(["e-bio"]);
    expect(reminderMessage(exam, goals, at("2026-11-25T17:46:00"), TZ)).toMatchObject({ title: "Morgen", body: "Bio-Prüfung.", template: "r.asked" });
  });

  it("the default of an all-day entry (-480 = 08:00 on the day) comes that morning, «Heute»; never once the day is over", () => {
    const day = { ...exam, reminder_minutes: -480 };
    expect(reminderAt(day)).toBe(at("2026-11-26T08:00:00").getTime());
    expect(reminderInRun(day, at("2026-11-26T07:46:00").getTime())).toBe(true);
    expect(reminderMessage(day, goals, at("2026-11-26T07:46:00"), TZ).title).toBe("Heute");
    expect(reminderInRun({ ...exam, reminder_minutes: -1439 }, at("2026-11-27T00:05:00").getTime())).toBe(false);
  });

  it("not asked (her exams as recorded: the coach had volunteered the promise): nothing", () => {
    expect(reminderAt({ ...exam, reminder_asked: false })).toBeNull();
    expect(reminderAt({ ...exam, reminder_asked: null })).toBeNull();
  });

  it("the morning leaves an all-day entry out while its own reminder comes within the hour", () => {
    const ev: PushEvent = { id: "e-bio", title: "Bio-Prüfung", starts_at: iso("2026-11-26T00:00:00"), ends_at: null, all_day: true, kind: "termin" };
    expect(morningCandidates({ events: [ev], dueSteps: [], goals }, at("2026-11-26T07:30:00"), TZ)[0][0].body).toBe("Heute: Bio-Prüfung.");
    expect(morningCandidates({ events: [ev], dueSteps: [], goals, remindSoon: new Set(["e-bio"]) }, at("2026-11-26T07:30:00"), TZ)).toEqual([]);
  });
});

// ---------- Mia F6, Sara F1: her normal week is a weekly rhythm; a training rhythm gets its goal ----------

describe("Mia, Sara: the fixed times of her normal week stand every week, and a training counts for its goal", () => {
  const steps = MODE_ONBOARDING.split("\n");
  const s4 = steps.find((l) => l.startsWith("4."))!;

  it("Kennenlernen question 4: what is the same every week goes in as a weekly rhythm, changing shifts as this week's termine", () => {
    expect(s4).toContain("Was jede Woche gleich ist, etwa Vorlesungen, Trainings oder der Job, trägst du gleich als Wochenrhythmus mit kind termin ein, wechselnde Schichten als Termine dieser Woche.");
    expect(s4).not.toContain("trägst du gleich als Termine ein");
  });

  it("the rule names her normal week, not only «immer», «jeden Donnerstag», «jede Woche»; single termine only for this week", () => {
    expect(PERSONA).toContain(
      "Was jede Woche gleich ist, ob sie „immer“, „jeden Donnerstag“ oder „jede Woche“ sagt oder ihre normale Woche beschreibt, legst du ohne Rückfrage als Wochenrhythmus mit kind termin an",
    );
    expect(PERSONA).toContain("einzelne Termine nur für diese Woche und für wechselnde Schichten.");
  });

  it("a fixed training made before its goal (Kennenlernen step 4 before step 5) is linked later with update_series", () => {
    expect(PERSONA).toContain("Ein fester Termin, der einem Ziel dient, etwa ein Training, bekommt dessen goal_id, auch nachträglich mit update_series.");
  });

  it("Swiss High German, and the prompt stays lean (5726 words before, at most 40 more)", () => {
    for (const p of [PERSONA, MODE_ONBOARDING]) expect(p.replace("statt „ß“", "")).not.toContain("ß");
    const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
    expect(words(PERSONA) + words(MODE_ONBOARDING)).toBeLessThanOrEqual(3616 + 415 + 40);
  });
});

// ---------- Peter F1: the morning tick is not the ride home ----------

describe("Peter: his morning tick of «Italienisch im Bus» does not answer the 18:10 ride home", () => {
  const GOAL = "g-garda";
  const habit = { id: "11111111-2222-4333-8444-555555555555", title: "Italienisch im Bus", goal_id: GOAL, minutes: 15 };
  const evening = {
    id: "ser-2026-12-03",
    title: "Italienisch im Bus heimwärts",
    goal_id: GOAL,
    kind: "block",
    starts_at: iso("2026-12-03T18:10:00"),
    ends_at: iso("2026-12-03T18:25:00"),
    all_day: false,
    source: "coach",
  };
  const tick = (local: string) => habitTimeRow(habit, "2026-12-03", { blocks: [{ ...evening, answered: false }], times: [], dayOfIso: zurich, now: at(local).getTime() });

  it("12:17 «heute Morgen auch»: his own 15 minutes, the block stays open (K6: it counts once he says so)", () => {
    expect(habitMatchesBlock(habit, evening)).toBe(true); // the same thing by its words
    expect(tick("2026-12-03T12:17:00")).toMatchObject({ minutes: 15, event_id: null, source: "habit" });
  });

  it("so his report on Friday («Eine Viertelstunde») is the block's own answer: Thursday counts 30", () => {
    const rows = [
      { day: "2026-12-03", minutes: 15 }, // the tick
      { day: "2026-12-03", minutes: 15 }, // log_time with the block's event_id
    ];
    expect(goalDayMinutes(rows, [evening], new Set([evening.id]), at("2026-12-04T07:20:00"), zurich).total["2026-12-03"]).toBe(30);
  });

  it("a tick once the block began (Mia: «Dehnen» after the stretch at 21:30) still answers it, counted once", () => {
    expect(tick("2026-12-03T18:30:00")?.event_id).toBe("ser-2026-12-03");
    const mia = { id: "h-dehnen", title: "10 Minuten dehnen", goal_id: "g-hm", minutes: 10 };
    const block = { id: "b-dehnen", title: "Dehnen", goal_id: "g-hm", kind: "block", starts_at: iso("2026-12-03T21:30:00"), ends_at: iso("2026-12-03T21:40:00"), answered: false };
    expect(habitTimeRow(mia, "2026-12-03", { blocks: [block], times: [], dayOfIso: zurich, now: at("2026-12-03T21:45:00").getTime() })?.event_id).toBe("b-dehnen");
    // a tick for yesterday, made today: every block of that day has begun
    expect(habitTimeRow(mia, "2026-12-03", { blocks: [block], times: [], dayOfIso: zurich, now: at("2026-12-04T08:00:00").getTime() })?.event_id).toBe("b-dehnen");
  });

  it("all three callers pass the moment of the tick", () => {
    expect(read("../supabase/functions/coach/index.ts")).toContain("now: Date.now(),\n    });");
    expect(read("../src/lib/supabaseBackend.ts")).toContain("now: Date.now(),");
    expect(read("../src/lib/demoBackend.ts")).toContain("now: Date.now(),");
  });
});

// ---------- Sara F2: a Mo/Di/Do rhythm is no entry of every day ----------

describe("Sara: a weekly rhythm on Monday, Tuesday and Thursday is named on Thursday", () => {
  const entry = (day: string, title: string, hhmm = "08:00"): PushEvent => ({
    id: `${title}-${day}`,
    title,
    starts_at: iso(`${day}T${hhmm}:00`),
    ends_at: new Date(at(`${day}T${hhmm}:00`).getTime() + 270 * 60000).toISOString(),
    all_day: false,
    kind: "termin",
  });
  const week = (title: string, days: string[]) => days.map((d) => entry(d, title));

  it("Thursday 26.11 (its first week) and 3.12: not «every day», so the morning names «Büro Gemeinde»", () => {
    const ev = week("Büro Gemeinde", ["2026-11-23", "2026-11-24", "2026-11-26", "2026-11-30", "2026-12-01", "2026-12-03"]);
    expect(dailyTitles(ev, "2026-11-26", TZ).size).toBe(0);
    expect(dailyTitles(ev, "2026-12-03", TZ).size).toBe(0);
    const named = { [fingerprint("Büro Gemeinde")]: 2 };
    expect(morningCandidates({ events: ev, dueSteps: [], goals: [], named }, at("2026-11-26T07:30:00"), TZ)[0][0].body).toBe("Heute: 08:00 Büro Gemeinde.");
  });

  it("Monday to Friday is no entry of every day either (from its second week on)", () => {
    const days: string[] = [];
    for (let d = "2026-11-23"; d <= "2026-12-04"; d = addDays(d, 1)) if (![5, 6].includes((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7)) days.push(d);
    const ev = week("Training", days);
    expect(["2026-12-03", "2026-12-04", "2026-12-01"].map((d) => dailyTitles(ev, d, TZ).size)).toEqual([0, 0, 0]);
  });

  it("an entry of every day still is one (Mia's «10 Minuten dehnen»): from its third day, a week back too", () => {
    const days = Array.from({ length: 10 }, (_, i) => addDays("2026-11-16", i));
    const ev = days.map((d) => entry(d, "10 Minuten dehnen", "21:30"));
    expect(dailyTitles(ev, "2026-11-17", TZ).size).toBe(0);
    expect(dailyTitles(ev, "2026-11-18", TZ)).toEqual(new Set(["10 minuten dehnen"]));
    expect(dailyTitles(ev, "2026-11-25", TZ)).toEqual(new Set(["10 minuten dehnen"]));
  });
});
