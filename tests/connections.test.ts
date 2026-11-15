import { beforeEach, describe, expect, it } from "vitest";
import {
  agoLabel,
  average,
  canSyncNow,
  connectionsValue,
  latest,
  nolioRowKind,
  parseWhoopHash,
  readWhoopReturn,
  sleepLabel,
  SPORT_GROUPS,
  sportGroupsOn,
  strainLabel,
  toggleSportGroup,
  unavailableReason,
  WHOOP_RETURN_TTL_MS,
  whoopRowKind,
  whoopStrip,
} from "../src/lib/connections";
import { captureWhoopReturn, peekWhoopReturn, setWhoopFrom, takeWhoopReturn } from "../src/lib/whoopReturn";
import { DemoBackend, demoWhoopDay, demoWhoopDays } from "../src/lib/demoBackend";
import { addDays, dayOf } from "../src/lib/plan";
import { mapToGoal, sportKeys, type NolioSport } from "../supabase/functions/_shared/nolio";
import type { CoachEvent, CoachRequest, NolioStatus, WhoopDay, WhoopStatus } from "../src/lib/types";

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

const CODE = "a".repeat(20) + "B-c_D".repeat(4); // 40 URL-safe characters
const NOW = Date.parse("2026-11-15T10:00:00Z");

describe("the return from WHOOP (hash)", () => {
  it("reads a confirm with its code and keeps #du/verbindungen", () => {
    expect(parseWhoopHash(`#du/verbindungen?whoop=confirm&code=${CODE}`, NOW)).toEqual({
      ret: { result: "confirm", code: CODE, at: NOW },
      hash: "#du/verbindungen",
    });
  });
  it("knows error, denied and the older 'connected'", () => {
    expect(parseWhoopHash("#du/verbindungen?whoop=error", NOW)?.ret).toEqual({ result: "error", code: null, at: NOW });
    expect(parseWhoopHash("#du/verbindungen?whoop=denied", NOW)?.ret.result).toBe("denied");
    expect(parseWhoopHash("#du/verbindungen?whoop=connected", NOW)?.ret.result).toBe("connected");
    expect(parseWhoopHash("#du/verbindungen?whoop=something", NOW)?.ret.result).toBe("error");
  });
  it("treats a confirm without a valid code as an error", () => {
    expect(parseWhoopHash("#du/verbindungen?whoop=confirm", NOW)?.ret).toEqual({ result: "error", code: null, at: NOW });
    expect(parseWhoopHash("#du/verbindungen?whoop=confirm&code=short", NOW)?.ret.result).toBe("error");
    expect(parseWhoopHash(`#du/verbindungen?whoop=confirm&code=${CODE}%3Cscript%3E`, NOW)?.ret.result).toBe("error");
  });
  it("ignores hashes without a whoop parameter", () => {
    expect(parseWhoopHash("#du/verbindungen", NOW)).toBeNull();
    expect(parseWhoopHash("#tag/2026-11-15", NOW)).toBeNull();
    expect(parseWhoopHash("#du/verbindungen?x=1", NOW)).toBeNull();
    expect(parseWhoopHash("", NOW)).toBeNull();
  });
  it("drops an empty base to no hash at all", () => {
    expect(parseWhoopHash("#?whoop=denied", NOW)?.hash).toBe("");
  });
  it("accepts a stored return only while it's fresh and well-formed", () => {
    const ok = JSON.stringify({ result: "confirm", code: CODE, at: NOW });
    expect(readWhoopReturn(ok, NOW + 60_000)).toEqual({ result: "confirm", code: CODE, at: NOW });
    expect(readWhoopReturn(ok, NOW + WHOOP_RETURN_TTL_MS + 1)).toBeNull();
    expect(readWhoopReturn(JSON.stringify({ result: "confirm", code: "x", at: NOW }), NOW)).toBeNull();
    expect(readWhoopReturn(JSON.stringify({ result: "boom", at: NOW }), NOW)).toBeNull();
    expect(readWhoopReturn("{not json", NOW)).toBeNull();
    expect(readWhoopReturn(null, NOW)).toBeNull();
    expect(readWhoopReturn(JSON.stringify({ result: "denied", code: CODE, at: NOW }), NOW)).toEqual({ result: "denied", code: null, at: NOW });
  });
});

describe("whoopReturn: capture at page load", () => {
  const fakeWindow = (hash: string) => {
    const calls: string[] = [];
    const win = {
      location: { hash, pathname: "/App-ich/", search: "?space=1" },
      history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => calls.push(url) },
    } as unknown as Window;
    return { win, calls };
  };
  beforeEach(() => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage();
    takeWhoopReturn();
    setWhoopFrom(null);
  });

  it("stores the return and removes the query, keeping #du/verbindungen", () => {
    const { win, calls } = fakeWindow(`#du/verbindungen?whoop=confirm&code=${CODE}`);
    expect(captureWhoopReturn(win)).toBe(true);
    expect(calls).toEqual(["/App-ich/?space=1#du/verbindungen"]);
    expect(peekWhoopReturn()?.code).toBe(CODE);
    expect(takeWhoopReturn()?.result).toBe("confirm");
    expect(peekWhoopReturn()).toBeNull(); // used once
  });
  it("drops the hash entirely when onboarding started the flow", () => {
    setWhoopFrom("onboarding");
    const { win, calls } = fakeWindow("#du/verbindungen?whoop=denied");
    captureWhoopReturn(win);
    expect(calls).toEqual(["/App-ich/?space=1"]);
    expect(peekWhoopReturn()?.result).toBe("denied");
  });
  it("leaves other hashes alone", () => {
    const { win, calls } = fakeWindow("#tag/2026-11-15");
    expect(captureWhoopReturn(win)).toBe(false);
    expect(calls).toEqual([]);
    expect(peekWhoopReturn()).toBeNull();
  });
});

const status = (o: Partial<WhoopStatus> = {}): WhoopStatus => ({
  available: true,
  connected: false,
  status: null,
  consent_ai: false,
  connected_at: null,
  last_sync_at: null,
  last_error: null,
  attribution: "Daten von WHOOP",
  days: [],
  ...o,
});
const nolio = (o: Partial<NolioStatus> = {}): NolioStatus => ({ available: true, connected: true, last_sync_at: "2026-11-15T08:00:00Z", last_error: null, running: false, counts: null, ...o });

describe("row states", () => {
  it("maps the WHOOP status to what its row shows", () => {
    expect(whoopRowKind(undefined)).toBe("loading");
    expect(whoopRowKind(null)).toBe("soon"); // not deployed or unreachable
    expect(whoopRowKind(status({ available: false }))).toBe("soon"); // no secrets yet
    expect(whoopRowKind(status())).toBe("connect");
    expect(whoopRowKind(status({ status: "pending" }))).toBe("pending");
    expect(whoopRowKind(status({ status: "needs_reconnect" }))).toBe("reconnect");
    expect(whoopRowKind(status({ status: "connected", connected: true }))).toBe("connected");
    expect(whoopRowKind(status({ available: false, status: "connected", connected: true }))).toBe("connected");
    expect(whoopRowKind(status(), true)).toBe("unreachable");
    expect(whoopRowKind(undefined, true)).toBe("unreachable");
  });
  it("shows Nolio only where it is available (the owner)", () => {
    expect(nolioRowKind(undefined)).toBe("loading");
    expect(nolioRowKind(null)).toBe("soon");
    expect(nolioRowKind(nolio({ available: false, connected: false }))).toBe("soon");
    expect(nolioRowKind(nolio())).toBe("ready");
    expect(nolioRowKind(nolio(), true)).toBe("unreachable");
  });
  it("names what is connected", () => {
    expect(connectionsValue(status({ connected: true, status: "connected" }), nolio())).toBe("WHOOP · Nolio");
    expect(connectionsValue(status(), nolio({ available: false }))).toBeNull();
    expect(connectionsValue(null, nolio())).toBe("Nolio");
  });
  it("gives a one-line reason for services that can't be connected", () => {
    expect(unavailableReason("strava")).toContain("KI-Coach");
    expect(unavailableReason("garmin", { nolio: true })).toContain("über Nolio");
    expect(unavailableReason("garmin")).toContain("kommt bald");
    for (const k of ["whoop", "nolio", "polar", "garmin", "strava"] as const) expect(unavailableReason(k)).not.toMatch(/ß/);
  });
});

describe("labels", () => {
  it("says how long ago, in 24h-friendly words", () => {
    const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
    expect(agoLabel(null, NOW)).toBeNull();
    expect(agoLabel(at(0), NOW)).toBe("gerade eben");
    expect(agoLabel(at(5), NOW)).toBe("vor 5 Min");
    expect(agoLabel(at(125), NOW)).toBe("vor 2 Std");
    expect(agoLabel(at(26 * 60), NOW)).toBe("gestern");
    expect(agoLabel(at(3 * 24 * 60), NOW)).toBe("vor 3 Tagen");
    expect(agoLabel("2026-11-03T10:00:00Z", NOW)).toBe("am 3.11.");
  });
  it("formats sleep and strain", () => {
    expect(sleepLabel(430)).toBe("7:10");
    expect(sleepLabel(59)).toBe("0:59");
    expect(sleepLabel(null)).toBeNull();
    expect(strainLabel(12.44)).toBe("12.4");
    expect(strainLabel(8)).toBe("8.0");
  });
  it("lets 'Jetzt holen' run at most once a minute", () => {
    expect(canSyncNow(null, null, NOW)).toBe(true);
    expect(canSyncNow(new Date(NOW - 30_000).toISOString(), null, NOW)).toBe(false);
    expect(canSyncNow(new Date(NOW - 90_000).toISOString(), NOW - 10_000, NOW)).toBe(false);
    expect(canSyncNow(new Date(NOW - 90_000).toISOString(), NOW - 70_000, NOW)).toBe(true);
  });
});

describe("the 14-day strip", () => {
  const day = (d: string, o: Partial<WhoopDay> = {}): WhoopDay => ({ ...demoWhoopDay(d), ...o });
  it("lays the days out oldest first with gaps", () => {
    const today = "2026-11-15";
    const strip = whoopStrip([day(today, { recovery_score: 70 }), day("2026-11-13", { recovery_score: 40, day_strain: null })], today, 14);
    expect(strip).toHaveLength(14);
    expect(strip[0].day).toBe("2026-11-02");
    expect(strip[13]).toMatchObject({ day: today, recovery: 70 });
    expect(strip[12]).toEqual({ day: "2026-11-14", recovery: null, sleep: null, strain: null });
    expect(strip[11]).toMatchObject({ recovery: 40, strain: null });
    expect(latest(strip, "recovery")).toEqual({ day: today, value: 70 });
    expect(latest(strip, "strain")).toEqual({ day: today, value: strip[13].strain });
    expect(average(strip, "recovery")).toBe(55);
  });
  it("demo days are plausible and stable", () => {
    const d = demoWhoopDays("2026-11-15");
    expect(d).toHaveLength(14);
    expect(d[0].day).toBe("2026-11-15");
    expect(d[13].day).toBe("2026-11-02");
    for (const x of d) {
      expect(x.recovery_score).toBeGreaterThanOrEqual(34);
      expect(x.recovery_score).toBeLessThanOrEqual(92);
      expect(x.sleep_minutes).toBeGreaterThanOrEqual(330);
      expect(x.day_strain).toBeLessThanOrEqual(21);
    }
    expect(demoWhoopDay("2026-11-15")).toEqual(demoWhoopDay("2026-11-15"));
  });
});

describe("goal sports (goals.sports)", () => {
  it("switches groups on and off, keeping entries it doesn't know", () => {
    let s = toggleSportGroup(null, "laufen", true);
    expect(sportGroupsOn(s)).toEqual(new Set(["laufen"]));
    s = toggleSportGroup(["spt_abc", ...s!], "velo", true);
    expect(sportGroupsOn(s)).toEqual(new Set(["laufen", "velo"]));
    s = toggleSportGroup(s, "laufen", false);
    expect(sportGroupsOn(s)).toEqual(new Set(["velo"]));
    expect(s).toContain("spt_abc");
    expect(toggleSportGroup(SPORT_GROUPS[0].names, "laufen", false)).toBeNull();
  });
  it("recognises a group by any of its names, accents and case ignored", () => {
    expect(sportGroupsOn(["course a pied"])).toEqual(new Set(["laufen"]));
    expect(sportGroupsOn(["RANDONNEE"])).toEqual(new Set(["wandern"]));
    expect(sportGroupsOn(null)).toEqual(new Set());
  });
  it("stays within the 30 entries the database allows", () => {
    let s: string[] | null = null;
    for (const g of SPORT_GROUPS) s = toggleSportGroup(s, g.key, true);
    expect(s!.length).toBeLessThanOrEqual(30);
  });
  it("is what the Nolio sync matches on (French, English or German sport names)", () => {
    const index = new Map<string, NolioSport>([
      ["spt_run", { id: "spt_run", name: "Course à pied", slug: "course-a-pied" }],
      ["spt_trail", { id: "spt_trail", name: "Trail", slug: "trail", sport_base: "spt_run" }],
      ["spt_en", { id: "spt_en", name: "Running", slug: "running" }],
      ["spt_bike", { id: "spt_bike", name: "Cyclisme", slug: "cyclisme" }],
    ]);
    const goal = { id: "g1", status: "active", sports: toggleSportGroup(null, "laufen", true), effort_hours: null, target_date: null, created_day: null };
    const other = { id: "g2", status: "active", sports: toggleSportGroup(null, "velo", true), effort_hours: null, target_date: null, created_day: null };
    for (const id of ["spt_run", "spt_trail", "spt_en"]) expect(mapToGoal(sportKeys(id, index), "2026-11-15", [goal, other])).toBe("g1");
    expect(mapToGoal(sportKeys("spt_bike", index), "2026-11-15", [goal, other])).toBe("g2");
  });
});

// ---------- the demo backend: simulated WHOOP and Nolio ----------

describe("demo backend: connections", () => {
  let b: DemoBackend;
  const ctx: CoachRequest["context"] = { day: dayOf(), localTime: "", timezone: "Europe/Zurich", season: "Herbst", phase: "Tag", hasLocation: false };
  const users = () => JSON.parse(localStorage.getItem("ich.demo.users")!);
  const save = (u: unknown) => localStorage.setItem("ich.demo.users", JSON.stringify(u));

  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    b = new DemoBackend({ connections: true });
    await b.signUp("demo.conn", "geheim1234");
  });

  it("has no connections without the option (like functions that aren't deployed)", async () => {
    const plain = new DemoBackend();
    expect(await plain.whoopStatus()).toBeNull();
    expect(await plain.nolioStatus()).toBeNull();
    expect((await plain.listEvents()).filter((e) => e.source === "nolio")).toEqual([]);
  });

  it("connects WHOOP through a confirm and fills 14 days", async () => {
    expect(await b.whoopStatus()).toMatchObject({ available: true, connected: false, status: null, consent_ai: false, attribution: "Daten von WHOOP", days: [] });
    const { url } = await b.whoopStart();
    const found = parseWhoopHash(url)!;
    expect(found.ret.result).toBe("confirm");
    expect((await b.whoopStatus())!.status).toBe("pending");
    const res = await b.whoopConfirm(found.ret.code!);
    expect(res).toMatchObject({ ok: true, connected: true, status: "connected", consent_ai: false });
    if (res.ok === false) throw new Error("not connected");
    expect(res.days).toHaveLength(14);
    expect(res.days[0].day).toBe(dayOf());
    // the code is single-use
    expect(await b.whoopConfirm(found.ret.code!)).toEqual({ ok: false, reason: "mismatch" });
    expect((await b.whoopStatus())!.connected).toBe(true);
  }, 10000);

  it("removes the pending link on a wrong or an expired code", async () => {
    await b.whoopStart();
    expect(await b.whoopConfirm(CODE)).toEqual({ ok: false, reason: "mismatch" });
    expect((await b.whoopStatus())!.status).toBeNull();

    const { url } = await b.whoopStart();
    const u = users();
    u["demo.conn"].whoop.code_at = new Date(Date.now() - 11 * 60_000).toISOString();
    save(u);
    expect(await b.whoopConfirm(parseWhoopHash(url)!.ret.code!)).toEqual({ ok: false, reason: "expired" });
    expect((await b.whoopStatus())!.status).toBeNull();
  }, 10000);

  it("keeps the coach switch off by default and clears everything on disconnect", async () => {
    expect(await b.setWhoopConsent(true)).toBe(false); // not connected
    const { url } = await b.whoopStart();
    await b.whoopConfirm(parseWhoopHash(url)!.ret.code!);
    expect(await b.setWhoopConsent(true)).toBe(true);
    expect((await b.whoopStatus())!.consent_ai).toBe(true);
    expect(await b.whoopSync()).toMatchObject({ ok: true, skipped: "recent" }); // just connected
    await b.whoopDisconnect();
    expect(await b.whoopStatus()).toMatchObject({ connected: false, status: null, consent_ai: false, days: [] });
    expect(await b.whoopSync()).toMatchObject({ ok: false, connected: false });
  }, 10000);

  it("mirrors the trainer's plan as read-only entries: four ahead, one done", async () => {
    const events = await b.listEvents(new Date(Date.now() - 3 * 86400_000).toISOString(), new Date(Date.now() + 8 * 86400_000).toISOString());
    const nolioEvents = events.filter((e) => e.source === "nolio");
    const today = Date.parse(`${dayOf()}T00:00`);
    expect(nolioEvents.filter((e) => Date.parse(e.starts_at) >= today)).toHaveLength(4);
    expect(nolioEvents.filter((e) => Date.parse(e.starts_at) < today)).toHaveLength(1);
    for (const e of nolioEvents) expect(e).toMatchObject({ kind: "block", external_id: expect.stringMatching(/^ptrn_demo/) });
    const next = nolioEvents.find((e) => Date.parse(e.starts_at) >= today)!;
    // only the reminder may change
    await expect(b.updateEvent(next.id, { title: "Anders" })).rejects.toThrow(/Nolio/);
    await expect(b.deleteEvent(next.id)).rejects.toThrow(/Nolio/);
    const changed = await b.updateEvent(next.id, { reminder_minutes: 60 });
    expect(changed.reminder_minutes).toBe(60);
    // a later sync keeps the entry and its reminder
    const u = users();
    u["demo.conn"].nolio.last_sync_at = new Date(Date.now() - 4 * 3600_000).toISOString();
    save(u);
    await b.nolioSync();
    const again = (await b.listEvents()).find((e) => e.external_id === next.external_id)!;
    expect(again).toMatchObject({ id: next.id, reminder_minutes: 60 });
    expect(await b.nolioStatus()).toMatchObject({ available: true, connected: true, counts: { planned: 4, trainings: 1 }, garmin: "Garmin Forerunner 965" });
  }, 10000);

  it("counts the done session for the goal its sport maps to, never the planned block", async () => {
    const goal = await b.addGoal({ title: "Halbmarathon", sports: toggleSportGroup(null, "laufen", true) });
    // a goal collects time from the day it was created on: this one is a week old
    const u = users();
    u["demo.conn"].goals[0].created_at = new Date(Date.now() - 7 * 86400_000).toISOString();
    save(u);
    await b.nolioSync();
    const past = (await b.listEvents(new Date(Date.now() - 3 * 86400_000).toISOString())).find((e) => e.source === "nolio" && Date.parse(e.starts_at) < Date.parse(`${dayOf()}T00:00`))!;
    expect(past.goal_id).toBe(goal.id);
    await expect(b.setBlockDone(past.id, true)).rejects.toThrow(/automatisch/);
    const [g] = await b.listGoals();
    expect(g.time).toEqual({ logged_minutes: 55, block_minutes: 0 }); // the training, not the plan
    const log = await b.listGoalTime(addDays(dayOf(), -3), dayOf());
    expect(log).toEqual([expect.objectContaining({ goal_id: goal.id, minutes: 55, source: "nolio" })]);
    // a strength session maps to nothing for a running goal
    const kraft = (await b.listEvents()).find((e) => e.title === "Kraft und Stabi")!;
    expect(kraft.goal_id).toBeNull();
    expect((await b.updateGoal(goal.id, { sports: null })).sports ?? null).toBeNull();
  }, 10000);

  it("asks for connections in onboarding (once) and in the space's first greeting only once", async () => {
    // onboarding: the step after the goal question asks which apps and devices
    const u = users();
    u["demo.conn"].messages.onboarding = ["Mira", "Grafikerin", "Familie", "Morgen"].flatMap((content, i) => [
      { id: `u${i}`, role: "user", content, hidden: false, created_at: "" },
      { id: `a${i}`, role: "assistant", content: "…", hidden: false, created_at: "" },
    ]);
    save(u);
    const events: CoachEvent[] = [];
    await b.coach({ mode: "onboarding", thread: "onboarding", message: "Ein Halbmarathon im Frühling", context: ctx }, (e) => events.push(e));
    const text = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    expect(text).toContain("WHOOP");
    expect(events.some((e) => e.type === "request_connections")).toBe(true);
    expect((await b.getProfile()).connections_asked_at).toBeTruthy();

    // an existing account that was never asked: the greeting asks once, in the space only
    const v = users();
    v["demo.conn"].profile.connections_asked_at = null;
    save(v);
    const greet = async (view?: string) => {
      const evs: CoachEvent[] = [];
      await b.coach({ mode: "checkin", thread: `t-${view ?? "none"}-${Math.random()}`, context: { ...ctx, view } }, (e) => evs.push(e));
      return evs.some((e) => e.type === "request_connections");
    };
    expect(await greet()).toBe(false); // the old screens have no Verbindungen
    expect(await greet("Jetzt (Startseite mit dem Kreis)")).toBe(true);
    expect(await greet("Jetzt (Startseite mit dem Kreis)")).toBe(false);
  }, 20000);
});
