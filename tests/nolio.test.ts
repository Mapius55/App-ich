import { describe, expect, it } from "vitest";
import {
  deviceAttribution,
  diffEvents,
  diffGoalTime,
  type ExistingEvent,
  type ExistingGoalTime,
  type GoalForMapping,
  goalTimeFor,
  isRestricted,
  mapToGoal,
  missingSports,
  NolioError,
  nolioClient,
  nolioErrorMessage,
  type NolioPlannedEvent,
  type NolioRealEvent,
  normalizeSport,
  parseRealEvent,
  parseRetryAfter,
  plannedToEvent,
  safeEqual,
  sportIndex,
  sportKeys,
  syncWindow,
  toKm,
  toSeconds,
  trainingsForCoach,
  volumeLabel,
} from "../supabase/functions/_shared/nolio";

// ---------- fixtures, shaped like the Nolio v2 schemas (made-up ids, no real data) ----------

const TZ = "Europe/Zurich";
const RUN = "spt_o9Qqbid1vRktj";
const TRAIL = "spt_T7rLq2Wd9Kx1a";
const RUN_ALL = "spt_P4rEnt0RunAll"; // parent sport: not listed in the catalogue
const ROW = "spt_R0wAv1r0nZq3b";
const SWIM = "spt_Sw1mNat4ti0nX";

const sports = sportIndex([
  { id: RUN, name: "Course à pied", slug: "course-a-pied", sport_base: RUN_ALL },
  { id: TRAIL, name: "Trail", slug: "trail", sport_base: RUN_ALL },
  { id: ROW, name: "Aviron", slug: "aviron", sport_base: null },
  { id: SWIM, name: "Natation", slug: "natation", sport_base: null },
]);

const garminRun: NolioRealEvent = {
  id: "trn_9aK2xQ7bLm4Fw",
  name: "Intervals 30/30",
  date_start: "2026-11-10",
  hour_start: "10:30:00",
  sport: RUN,
  duration: { value: 3600, unit: "s" }, // first part only
  total_duration: { value: 5400, unit: "s" }, // whole workout
  distance: { value: 12, unit: "km" },
  total_distance: { value: 16.4567, unit: "km" },
  load: { coggan: 78.44, foster: 450 },
  debrief: { rpe: 8, feeling: 4 },
  source: "garmin",
  device_name: "edge_520_plus",
  planned: "ptrn_4Lq8vN2cXe7Rt",
  restriction: null,
};

const stravaRide: NolioRealEvent = {
  id: "trn_Str4vaR1deX01",
  name: "Morning Ride",
  date_start: "2026-11-11",
  hour_start: null,
  sport: ROW,
  duration: null,
  total_duration: null,
  distance: null,
  total_distance: null,
  load: { coggan: null, foster: null },
  debrief: { rpe: 6, feeling: 3 },
  source: "strava",
  device_name: null,
  planned: null,
  restriction: {
    code: "connector_terms",
    source: "strava",
    message: "Measurements from this connector stay in Nolio.",
    fields: ["duration", "distance", "elevation_gain", "elevation_loss", "total_duration", "total_distance"],
  },
};

const goal = (over: Partial<GoalForMapping> & { id: string }): GoalForMapping => ({
  status: "active",
  sports: null,
  effort_hours: null,
  target_date: null,
  created_day: "2026-01-01",
  ...over,
});

// ---------- units ----------

describe("quantities", () => {
  it("reads seconds and kilometres, also in write units", () => {
    expect(toSeconds({ value: 5400, unit: "s" })).toBe(5400);
    expect(toSeconds({ value: 90, unit: "min" })).toBe(5400);
    expect(toSeconds({ value: 1.5, unit: "h" })).toBe(5400);
    expect(toSeconds({ value: null, unit: "s" })).toBeNull();
    expect(toSeconds(null)).toBeNull();
    expect(toKm({ value: 12, unit: "km" })).toBe(12);
    expect(toKm({ value: 1500, unit: "m" })).toBe(1.5);
    expect(toKm({ value: 1, unit: "mi" })).toBeCloseTo(1.609, 3);
    expect(toKm({ value: 3, unit: "parsec" })).toBeNull();
  });
  it("labels a planned volume", () => {
    expect(volumeLabel(5400, 16.45)).toBe("1:30 h · 16,5 km");
    expect(volumeLabel(2700, null)).toBe("45 min");
    expect(volumeLabel(null, null)).toBeNull();
  });
});

// ---------- completed trainings ----------

describe("parseRealEvent", () => {
  it("maps a Garmin training: whole workout, local start, load, debrief, device", () => {
    expect(parseRealEvent(garminRun, { tz: TZ, sports })).toEqual({
      id: "trn_9aK2xQ7bLm4Fw",
      kind: "training",
      day: "2026-11-10",
      started_at: "2026-11-10T09:30:00.000Z", // 10:30 in Zurich (winter time)
      sport: RUN,
      sport_name: "Course à pied",
      minutes: 90, // total_duration, not the first part's 60
      distance_km: 16.457,
      load: 78.4,
      rpe: 8,
      feeling: 4,
      source: "garmin",
      device_name: "edge_520_plus",
      restricted: false,
      raw_name: "Intervals 30/30",
      planned_id: "ptrn_4Lq8vN2cXe7Rt",
    });
  });

  it("keeps a Strava row only as a flagged stub: no name, no measurements, no debrief", () => {
    const r = parseRealEvent(stravaRide, { tz: TZ, sports })!;
    expect(r.restricted).toBe(true);
    expect(r).toMatchObject({ id: "trn_Str4vaR1deX01", day: "2026-11-11", sport: ROW, source: "strava" });
    expect([r.raw_name, r.minutes, r.distance_km, r.load, r.rpe, r.feeling, r.started_at, r.device_name]).toEqual([null, null, null, null, null, null, null, null]);
  });

  it("treats WHOOP and Strava as restricted even without a restriction marker", () => {
    expect(isRestricted({ source: "whoop", restriction: null })).toBe(true);
    expect(isRestricted({ source: "Strava", restriction: null })).toBe(true);
    expect(isRestricted({ source: "garmin", restriction: null })).toBe(false);
    expect(isRestricted({ source: "coros", restriction: { code: "connector_terms", source: "coros" } })).toBe(true);
    const whoop = parseRealEvent({ ...garminRun, id: "trn_Wh00pX", source: "whoop" }, { tz: TZ, sports })!;
    expect(whoop.restricted).toBe(true);
    expect(whoop.minutes).toBeNull();
  });

  it("handles a manual entry without time, with Foster load only and a summer date", () => {
    const r = parseRealEvent(
      {
        id: "trn_Man0alEntry1",
        name: "  Schwimmen  ",
        date_start: "2026-07-14",
        hour_start: "07:05:00",
        sport: SWIM,
        duration: { value: 2700, unit: "s" },
        total_duration: null,
        distance: { value: 2.5, unit: "km" },
        total_distance: null,
        load: { coggan: null, foster: 225 },
        debrief: { rpe: 0, feeling: null },
        source: "manual",
        device_name: null,
        restriction: null,
      },
      { tz: TZ, sports },
    )!;
    expect(r).toMatchObject({ minutes: 45, distance_km: 2.5, load: 225, rpe: null, feeling: null, raw_name: "Schwimmen", started_at: "2026-07-14T05:05:00.000Z" });
    expect(parseRealEvent({ ...garminRun, hour_start: null }, { tz: TZ, sports })!.started_at).toBeNull();
  });

  it("marks races and drops unusable rows", () => {
    expect(parseRealEvent({ ...garminRun, id: "cmp_R4ceX" }, { tz: TZ, sports, kind: "competition" })!.kind).toBe("competition");
    expect(parseRealEvent({ ...garminRun, id: "" }, { tz: TZ, sports })).toBeNull();
    expect(parseRealEvent({ ...garminRun, date_start: "10.11.2026" }, { tz: TZ, sports })).toBeNull();
  });
});

// ---------- goals ----------

describe("mapToGoal", () => {
  const keys = (sport: string) => sportKeys(sport, sports);

  it("matches a goal's sports by id, name, slug or parent sport", () => {
    const byId = [goal({ id: "g1", sports: [RUN] })];
    expect(mapToGoal(keys(RUN), "2026-11-10", byId)).toBe("g1");
    expect(mapToGoal(keys(TRAIL), "2026-11-10", byId)).toBeNull();
    expect(mapToGoal(keys(RUN), "2026-11-10", [goal({ id: "g2", sports: ["course a pied"] })])).toBe("g2");
    expect(mapToGoal(keys(ROW), "2026-11-10", [goal({ id: "g3", sports: ["AVIRON"] })])).toBe("g3");
    expect(mapToGoal(keys(TRAIL), "2026-11-10", [goal({ id: "g4", sports: [RUN_ALL] })])).toBe("g4");
    expect(normalizeSport("Course-à_Pied ")).toBe("course a pied");
  });

  it("with several matching goals takes the one due first", () => {
    const goals = [
      goal({ id: "later", sports: [RUN], target_date: "2027-09-01" }),
      goal({ id: "open", sports: [RUN], target_date: null }),
      goal({ id: "soon", sports: [RUN, TRAIL], target_date: "2027-03-15" }),
    ];
    expect(mapToGoal(keys(RUN), "2026-11-10", goals)).toBe("soon");
  });

  it("counts only from the day a goal was created up to its target date", () => {
    const goals = [goal({ id: "g", sports: [RUN], created_day: "2026-11-12", target_date: "2026-12-06" })];
    expect(mapToGoal(keys(RUN), "2026-11-11", goals)).toBeNull();
    expect(mapToGoal(keys(RUN), "2026-11-12", goals)).toBe("g");
    expect(mapToGoal(keys(RUN), "2026-12-06", goals)).toBe("g");
    expect(mapToGoal(keys(RUN), "2026-12-07", goals)).toBeNull();
  });

  it("ignores goals that are not active", () => {
    const goals = [goal({ id: "done", sports: [RUN], status: "done" }), goal({ id: "paused", sports: [RUN], status: "paused" })];
    expect(mapToGoal(keys(RUN), "2026-11-10", goals)).toBeNull();
  });

  it("without any sports set: the single goal with an effort estimate takes every training", () => {
    const one = [goal({ id: "ironman", effort_hours: 400 }), goal({ id: "buch" })];
    expect(mapToGoal(keys(ROW), "2026-11-10", one)).toBe("ironman");
    const two = [goal({ id: "a", effort_hours: 400 }), goal({ id: "b", effort_hours: 60 })];
    expect(mapToGoal(keys(ROW), "2026-11-10", two)).toBeNull();
    expect(mapToGoal(keys(ROW), "2026-11-10", [goal({ id: "z", effort_hours: 0 })])).toBeNull();
    expect(mapToGoal(keys(ROW), "2026-11-10", [])).toBeNull();
  });

  it("once any active goal has sports, there is no fallback", () => {
    const goals = [goal({ id: "run", sports: [RUN] }), goal({ id: "big", effort_hours: 500 })];
    expect(mapToGoal(keys(ROW), "2026-11-10", goals)).toBeNull();
    expect(mapToGoal(keys(RUN), "2026-11-10", goals)).toBe("run");
  });

  it("lists sports to look up: unknown ids and unlisted parents", () => {
    expect(missingSports([RUN, TRAIL, "spt_Unkn0wn", null, "not-an-id"], sports).sort()).toEqual([RUN_ALL, "spt_Unkn0wn"].sort());
  });
});

describe("goal time", () => {
  const goals = [goal({ id: "ironman", sports: [RUN, SWIM] })];
  const rows = [
    parseRealEvent(garminRun, { tz: TZ, sports })!,
    parseRealEvent(stravaRide, { tz: TZ, sports })!,
    parseRealEvent({ ...garminRun, id: "trn_Sh0rt", total_duration: { value: 20, unit: "s" } }, { tz: TZ, sports })!,
    parseRealEvent({ ...garminRun, id: "trn_Ultr4", total_duration: { value: 30 * 3600, unit: "s" } }, { tz: TZ, sports })!,
    parseRealEvent({ ...garminRun, id: "trn_R0w", sport: ROW }, { tz: TZ, sports })!,
  ];

  it("counts mapped trainings with at least a minute, never restricted ones, at most a day", () => {
    expect(goalTimeFor(rows, goals, sports)).toEqual([
      { external_id: "trn_9aK2xQ7bLm4Fw", goal_id: "ironman", day: "2026-11-10", minutes: 90 },
      { external_id: "trn_Ultr4", goal_id: "ironman", day: "2026-11-10", minutes: 1440 },
    ]);
  });

  it("restricted rows never count, even when the mapping would take them", () => {
    const fallback = [goal({ id: "only", effort_hours: 100 })];
    expect(goalTimeFor([parseRealEvent(stravaRide, { tz: TZ, sports })!], fallback, sports)).toEqual([]);
  });

  it("diffs against stored rows: new, moved, unmapped, gone, and finished goals keep their hours", () => {
    const trainings = [
      { id: "trn_new", day: "2026-11-12", minutes: 60, restricted: false },
      { id: "trn_moved", day: "2026-11-10", minutes: 45, restricted: false },
      { id: "trn_unmapped", day: "2026-11-09", minutes: 30, restricted: false },
      { id: "trn_done_goal", day: "2026-10-01", minutes: 80, restricted: false },
      { id: "trn_same", day: "2026-11-08", minutes: 50, restricted: false },
      { id: "trn_now_restricted", day: "2026-11-07", minutes: null, restricted: true },
    ];
    const desired = [
      { external_id: "trn_new", goal_id: "ironman", day: "2026-11-12", minutes: 60 },
      { external_id: "trn_moved", goal_id: "marathon", day: "2026-11-10", minutes: 45 },
      { external_id: "trn_same", goal_id: "ironman", day: "2026-11-08", minutes: 50 },
    ];
    const existing: ExistingGoalTime[] = [
      { id: "gt1", external_id: "trn_moved", goal_id: "ironman", day: "2026-11-10", minutes: 45 },
      { id: "gt2", external_id: "trn_unmapped", goal_id: "ironman", day: "2026-11-09", minutes: 30 },
      { id: "gt3", external_id: "trn_done_goal", goal_id: "halbmarathon", day: "2026-10-01", minutes: 75 },
      { id: "gt4", external_id: "trn_same", goal_id: "ironman", day: "2026-11-08", minutes: 50 },
      { id: "gt5", external_id: "trn_deleted_in_nolio", goal_id: "ironman", day: "2026-11-01", minutes: 40 },
      { id: "gt6", external_id: "trn_now_restricted", goal_id: "ironman", day: "2026-11-07", minutes: 40 },
    ];
    const status = new Map([
      ["ironman", "active"],
      ["marathon", "active"],
      ["halbmarathon", "done"],
    ]);
    const { upserts, deletes } = diffGoalTime(existing, desired, trainings, status);
    expect(deletes.sort()).toEqual(["gt2", "gt5", "gt6"]);
    expect(upserts).toEqual([
      { external_id: "trn_moved", goal_id: "marathon", day: "2026-11-10", minutes: 45 },
      // the finished goal keeps the training, with the corrected minutes
      { external_id: "trn_done_goal", goal_id: "halbmarathon", day: "2026-10-01", minutes: 80 },
      { external_id: "trn_new", goal_id: "ironman", day: "2026-11-12", minutes: 60 },
    ]);
  });
});

// ---------- the trainer's plan ----------

describe("plannedToEvent", () => {
  const goals = [goal({ id: "ironman", sports: [SWIM, RUN] })];
  const opts = { tz: TZ, sports, goals, kind: "training" as const };

  const swim: NolioPlannedEvent = {
    id: "ptrn_9aK2xQ7bLm4Fw",
    name: "Wasser 1h30",
    date_start: "2026-11-18",
    time: "18:15",
    moment: null,
    sport: SWIM,
    description: "  4x400 locker, dazwischen 1' Pause.\n\nTechnik: Wasserlage.  ",
    duration: { value: 3600, unit: "s" },
    total_duration: { value: 5400, unit: "s" },
    distance: { value: 3.2, unit: "km" },
    total_distance: null,
  };

  it("makes a timed block with the trainer's name, end from the planned duration and the goal", () => {
    expect(plannedToEvent(swim, opts)).toEqual({
      external_id: "ptrn_9aK2xQ7bLm4Fw",
      title: "Wasser 1h30",
      kind: "block",
      starts_at: "2026-11-18T17:15:00.000Z",
      ends_at: "2026-11-18T18:45:00.000Z",
      all_day: false,
      notes: "Geplant: 1:30 h · 3,2 km\n\n4x400 locker, dazwischen 1' Pause.\n\nTechnik: Wasserlage.",
      location: null,
      goal_id: "ironman",
      reminder_minutes: 30,
    });
  });

  it("without a time: all-day, part of the day in the notes, reminder at 08:00", () => {
    const e = plannedToEvent({ ...swim, time: null, moment: "morning", description: "", total_duration: null, duration: null, distance: null }, opts)!;
    expect(e).toMatchObject({ all_day: true, starts_at: "2026-11-17T23:00:00.000Z", ends_at: null, reminder_minutes: -480, notes: "Tageszeit: morgens" });
  });

  it("keeps notes at 2000 characters and falls back to a title", () => {
    const e = plannedToEvent({ ...swim, name: "   ", description: "x".repeat(5000) }, opts)!;
    expect(e.notes!.length).toBe(2000);
    expect(e.notes!.endsWith("…")).toBe(true);
    expect(e.title).toBe("Training Natation");
    expect(plannedToEvent({ ...swim, name: null, sport: null }, opts)!.title).toBe("Training");
    expect(plannedToEvent({ ...swim, name: "y".repeat(300) }, opts)!.title.length).toBe(200);
    expect(plannedToEvent({ ...swim, date_start: "morgen" }, opts)).toBeNull();
  });

  it("a planned race is an all-day appointment with place, goal level and start time", () => {
    const race: NolioPlannedEvent = {
      id: "pcmp_9aK2xQ7bLm4Fw",
      name: "Marathon of the city",
      date_start: "2027-04-25",
      time: "09:00",
      moment: null,
      sport: RUN,
      description: "Goal race of the season.",
      duration: null,
      distance: { value: 42.195, unit: "km" },
      event: "City Marathon",
      location: "Lyon",
      goal_type: "a",
    };
    expect(plannedToEvent(race, { ...opts, kind: "competition" })).toEqual({
      external_id: "pcmp_9aK2xQ7bLm4Fw",
      title: "Marathon of the city",
      kind: "termin",
      starts_at: "2027-04-24T22:00:00.000Z", // local midnight, summer time
      ends_at: null,
      all_day: true,
      notes: "City Marathon\nA-Wettkampf (Hauptziel)\nStart: 09:00\nGeplant: 42,2 km\n\nGoal race of the season.",
      location: "Lyon",
      goal_id: "ironman",
      reminder_minutes: -480,
    });
  });
});

describe("diffEvents", () => {
  const goals = [goal({ id: "ironman", sports: [SWIM] })];
  const plan = (p: Partial<NolioPlannedEvent> & { id: string }) =>
    plannedToEvent({ name: "Wasser", date_start: "2026-11-18", time: "18:00", sport: SWIM, duration: { value: 3600, unit: "s" }, ...p }, { tz: TZ, sports, goals, kind: "training" })!;
  const stored = (d: ReturnType<typeof plan>, id: string, over: Partial<ExistingEvent> = {}): ExistingEvent => {
    const { reminder_minutes: _r, ...rest } = d;
    // as PostgREST returns timestamps
    return { ...rest, id, starts_at: rest.starts_at.replace(".000Z", "+00:00"), ends_at: rest.ends_at?.replace(".000Z", "+00:00") ?? null, ...over };
  };
  const fromIso = "2026-11-14T23:00:00.000Z"; // today 2026-11-15 in Zurich

  it("inserts new, updates changed, leaves unchanged alone and removes what is no longer planned", () => {
    const same = plan({ id: "ptrn_same" });
    const moved = plan({ id: "ptrn_moved", time: "07:00" });
    const fresh = plan({ id: "ptrn_new", date_start: "2026-11-20" });
    const existing = [
      stored(same, "e1"),
      stored(plan({ id: "ptrn_moved" }), "e2"),
      stored(plan({ id: "ptrn_cancelled", date_start: "2026-11-19" }), "e3"),
      stored(plan({ id: "ptrn_yesterday", date_start: "2026-11-14" }), "e4"),
    ];
    const r = diffEvents(existing, [same, moved, fresh], { block: true, termin: true }, fromIso);
    expect(r.inserts.map((e) => e.external_id)).toEqual(["ptrn_new"]);
    expect(r.updates).toEqual([{ id: "e2", patch: { starts_at: moved.starts_at, ends_at: moved.ends_at } }]);
    expect(r.deletes).toEqual(["e3"]); // the past entry stays as history
  });

  it("keeps the reminder the person chose, and deletes nothing of a kind whose list was cut off", () => {
    const same = plan({ id: "ptrn_same" });
    const existing = [stored(same, "e1"), stored(plan({ id: "ptrn_cancelled" }), "e2")];
    const r = diffEvents(existing, [same], { block: false, termin: true }, fromIso);
    expect(r).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it("a change between timed and all-day resets the reminder", () => {
    const allDay = plan({ id: "ptrn_x", time: null });
    const r = diffEvents([stored(plan({ id: "ptrn_x" }), "e1")], [allDay], { block: true, termin: true }, fromIso);
    expect(r.updates[0].patch).toMatchObject({ all_day: true, ends_at: null, reminder_minutes: -480 });
  });

  it("removes duplicate stored entries", () => {
    const same = plan({ id: "ptrn_same" });
    const r = diffEvents([stored(same, "e1"), stored(same, "e2")], [same], { block: true, termin: true }, fromIso);
    expect(r.deletes).toEqual(["e2"]);
  });
});

// ---------- windows ----------

describe("syncWindow", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  it("reads 120 days on the first run", () => {
    expect(syncWindow(null, now, TZ)).toEqual({ today: "2026-11-15", from: "2026-07-18", to: "2026-11-16", planTo: "2026-12-13", competitionTo: "2027-11-15" });
  });
  it("later runs start three days before the last one", () => {
    expect(syncWindow("2026-11-15T07:17:00Z", now, TZ).from).toBe("2026-11-12");
    expect(syncWindow("2025-01-01T00:00:00Z", now, TZ).from).toBe("2025-11-14"); // at most a year back
  });
  it("uses the Nolio user's local day", () => {
    expect(syncWindow(null, new Date("2026-11-15T23:30:00Z"), TZ).today).toBe("2026-11-16");
    expect(syncWindow(null, new Date("2026-11-15T23:30:00Z"), "America/New_York").today).toBe("2026-11-15");
  });
});

// ---------- API client ----------

type Call = { url: URL; auth: string | null };
function fakeFetch(responses: ((url: URL) => Response)[]) {
  const calls: Call[] = [];
  let i = 0;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    const r = responses[Math.min(i++, responses.length - 1)];
    return r(url);
  }) as typeof fetch;
  return { f, calls };
}
const ok = (body: unknown, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
const fail = (status: number, code: string, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify({ error: { code, message: "…" } }), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("nolioClient", () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);

  it("sends the key, keeps the trailing slash and follows starting_after until has_more is false", async () => {
    const { f, calls } = fakeFetch([
      ok({ data: [{ id: "trn_3" }, { id: "trn_2" }], has_more: true }),
      ok({ data: [{ id: "trn_1" }], has_more: false }),
    ]);
    const api = nolioClient({ key: "nolio_sk_test", fetch: f, sleep });
    const r = await api.list<{ id: string }>("/api/v2/real/trainings/", { date_from: "2026-07-18", date_to: "2026-11-16" });
    expect(r).toEqual({ items: [{ id: "trn_3" }, { id: "trn_2" }, { id: "trn_1" }], truncated: false });
    expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://www.nolio.io/api/v2/real/trainings/");
    expect(calls[0].auth).toBe("Bearer nolio_sk_test");
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ date_from: "2026-07-18", date_to: "2026-11-16", limit: "100" });
    expect(calls[1].url.searchParams.get("starting_after")).toBe("trn_2");
  });

  it("stops at the page cap and says so", async () => {
    let n = 0;
    const { f } = fakeFetch([() => new Response(JSON.stringify({ data: [{ id: `trn_${n++}` }], has_more: true }))]);
    const r = await nolioClient({ key: "k", fetch: f, sleep }).list("/api/v2/sports/", {}, 3);
    expect(r.items).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it("waits for a short Retry-After once, then gives up with the wait time", async () => {
    sleeps.length = 0;
    const short = fakeFetch([fail(429, "throttled", { "Retry-After": "2" }), ok({ id: "usr_1", timezone: TZ })]);
    expect(await nolioClient({ key: "k", fetch: short.f, sleep }).get("/api/v2/me/")).toMatchObject({ timezone: TZ });
    expect(sleeps).toEqual([2000]);

    const long = fakeFetch([fail(429, "throttled", { "Retry-After": "3600" })]);
    const e = await nolioClient({ key: "k", fetch: long.f, sleep }).get("/api/v2/me/").catch((x) => x);
    expect(e).toBeInstanceOf(NolioError);
    expect(e).toMatchObject({ status: 429, code: "throttled", retryAfter: 3600 });
    expect(long.calls).toHaveLength(1);
  });

  it("reports 401 and 403 with Nolio's error code, retries a 503 once", async () => {
    const e401 = await nolioClient({ key: "k", fetch: fakeFetch([fail(401, "not_authenticated")]).f, sleep }).get("/api/v2/app/").catch((x) => x);
    expect(e401).toMatchObject({ status: 401, code: "not_authenticated" });
    const e403 = await nolioClient({ key: "k", fetch: fakeFetch([fail(403, "subscription_required")]).f, sleep }).get("/api/v2/app/").catch((x) => x);
    expect(e403).toMatchObject({ status: 403, code: "subscription_required" });
    const flaky = fakeFetch([fail(503, "unavailable"), ok({ scopes: ["real:read"] })]);
    expect(await nolioClient({ key: "k", fetch: flaky.f, sleep }).get("/api/v2/app/")).toEqual({ scopes: ["real:read"] });
  });

  it("refuses paths outside the v2 API or without the trailing slash", async () => {
    const api = nolioClient({ key: "k", fetch: fakeFetch([ok({})]).f, sleep });
    await expect(api.get("/api/v2/me")).rejects.toThrow();
    await expect(api.get("https://example.com/api/v2/me/")).rejects.toThrow();
  });
});

describe("errors and helpers", () => {
  it("explains errors in German", () => {
    expect(nolioErrorMessage(new NolioError(401, "not_authenticated"))).toContain("Schlüssel ab");
    expect(nolioErrorMessage(new NolioError(403, "subscription_required"))).toContain("bezahltes Nolio-Abo");
    expect(nolioErrorMessage(new NolioError(403, "api_access_denied"))).toContain("bezahltes Nolio-Abo");
    expect(nolioErrorMessage(new NolioError(403, "missing_scope"))).toContain("real:read");
    expect(nolioErrorMessage(new NolioError(429, "throttled", 1800), TZ, Date.parse("2026-11-15T10:00:00Z"))).toBe("Nolio-Limit erreicht. Nächster Versuch ab 11:30 Uhr.");
    expect(nolioErrorMessage(new NolioError(0, "network"))).toContain("nicht erreichbar");
    expect(nolioErrorMessage(new Error("db"))).toContain("fehlgeschlagen");
  });
  it("reads Retry-After as seconds or a date", () => {
    expect(parseRetryAfter("120")).toBe(120);
    expect(parseRetryAfter("Sun, 15 Nov 2026 10:05:00 GMT", Date.parse("2026-11-15T10:00:00Z"))).toBe(300);
    expect(parseRetryAfter(null)).toBe(60);
  });
  it("names Garmin devices for the attribution", () => {
    expect(deviceAttribution("garmin", "edge_520_plus")).toBe("Garmin Edge 520 Plus");
    expect(deviceAttribution("garmin", "Garmin forerunner-965")).toBe("Garmin Forerunner 965");
    expect(deviceAttribution("garmin", null)).toBe("Garmin");
    expect(deviceAttribution("coros", "pace_3")).toBeNull();
  });
  it("hands the coach only unrestricted trainings", () => {
    const rows = [parseRealEvent(garminRun, { tz: TZ, sports })!, parseRealEvent(stravaRide, { tz: TZ, sports })!, { ...parseRealEvent(garminRun, { tz: TZ, sports })!, source: "whoop" }];
    expect(trainingsForCoach(rows).map((r) => r.id)).toEqual(["trn_9aK2xQ7bLm4Fw"]);
  });
  it("compares secrets", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
