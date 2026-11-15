import { describe, expect, it } from "vitest";
import nodeCrypto from "node:crypto";
import {
  addDays,
  appReturnUrl,
  asleepMinutes,
  authorizeUrl,
  bounded,
  CONFIRM_CODE_RE,
  confirmOutcome,
  dayAt,
  dayWindow,
  extractUserId,
  hashConfirmCode,
  hoursMinutes,
  keepFrom,
  needsReconnect,
  openStoredToken,
  openToken,
  parseOffset,
  parseRetryAfter,
  parseTokenResponse,
  parseWebhookEvent,
  randomConfirmCode,
  randomState,
  recordDay,
  type RefreshClaim,
  safeEqual,
  sealToken,
  summarizeDays,
  syncWindow,
  tokenRequestBody,
  type TokenSet,
  validAccessToken,
  verifyWhoopSignature,
  WHOOP_ATTRIBUTION,
  WHOOP_AUTHORIZE_URL,
  WHOOP_COACH_RULE,
  type WhoopCycle,
  whoopClient,
  whoopCoachLine,
  type WhoopDay,
  WhoopError,
  whoopErrorMessage,
  whoopForCoach,
  type WhoopRecovery,
  whoopSignature,
  type WhoopSleep,
  type WhoopWorkout,
} from "../supabase/functions/_shared/whoop";

// ---------- fixtures, shaped like the WHOOP v2 schemas (made-up ids and values, no real data) ----------

const TZ = "Europe/Zurich";
const USER = 10129;
const SLEEP_SAT = "6f1a5c9e-3b2d-4e8f-9a1c-2d3e4f5a6b7c"; // night Fri 13 → Sat 14 Nov
const SLEEP_FRI = "0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e"; // night Thu 12 → Fri 13 Nov
const NAP_SAT = "aa11bb22-cc33-4d44-8e55-ff6677889900";

const stages = (light: number, deep: number, rem: number, awake = 1_980_000) => ({
  total_in_bed_time_milli: light + deep + rem + awake,
  total_awake_time_milli: awake,
  total_no_data_time_milli: 0,
  total_light_sleep_time_milli: light,
  total_slow_wave_sleep_time_milli: deep,
  total_rem_sleep_time_milli: rem,
  sleep_cycle_count: 4,
  disturbance_count: 11,
});

const sleeps: WhoopSleep[] = [
  {
    id: SLEEP_SAT,
    cycle_id: 93846,
    user_id: USER,
    start: "2026-11-13T22:31:00.000Z", // 23:31 local
    end: "2026-11-14T06:12:00.000Z", // 07:12 local, Saturday
    timezone_offset: "+01:00",
    nap: false,
    score_state: "SCORED",
    score: {
      stage_summary: stages(13_200_000, 6_000_000, 6_600_000), // 430 min asleep = 7 Std 10
      sleep_needed: {
        baseline_milli: 27_000_000,
        need_from_sleep_debt_milli: 1_200_000,
        need_from_recent_strain_milli: 600_000,
        need_from_recent_nap_milli: -1_200_000,
      }, // 460 min
      respiratory_rate: 15.84375,
      sleep_performance_percentage: 88,
      sleep_consistency_percentage: 79,
      sleep_efficiency_percentage: 92.8,
    },
  },
  {
    id: NAP_SAT,
    cycle_id: 93846,
    user_id: USER,
    start: "2026-11-14T12:40:00.000Z",
    end: "2026-11-14T13:05:00.000Z",
    timezone_offset: "+01:00",
    nap: true,
    score_state: "SCORED",
    score: { stage_summary: stages(1_200_000, 0, 300_000, 0), respiratory_rate: 15.1, sleep_performance_percentage: 100 },
  },
  {
    id: SLEEP_FRI,
    cycle_id: 93845,
    user_id: USER,
    start: "2026-11-12T23:10:00.000Z",
    end: "2026-11-13T05:40:00.000Z",
    timezone_offset: "+01:00",
    nap: false,
    score_state: "SCORED",
    score: { stage_summary: stages(12_000_000, 5_400_000, 4_800_000), sleep_performance_percentage: 74, respiratory_rate: 16.2 },
  },
];

const cycles: WhoopCycle[] = [
  {
    id: 93846, // current cycle: no end yet
    user_id: USER,
    start: "2026-11-13T22:31:00.000Z",
    timezone_offset: "+01:00",
    score_state: "SCORED",
    score: { strain: 5.9811, kilojoule: 4120.7, average_heart_rate: 61, max_heart_rate: 128 },
  },
  {
    id: 93845,
    user_id: USER,
    start: "2026-11-12T23:10:00.000Z",
    end: "2026-11-13T22:31:00.000Z",
    timezone_offset: "+01:00",
    score_state: "SCORED",
    score: { strain: 12.4371, kilojoule: 9876.2, average_heart_rate: 72, max_heart_rate: 176, step_count: 11234 },
  },
  {
    id: 93844, // outside the window used below
    user_id: USER,
    start: "2026-11-11T22:50:00.000Z",
    end: "2026-11-12T23:10:00.000Z",
    timezone_offset: "+01:00",
    score_state: "SCORED",
    score: { strain: 9.1, kilojoule: 8000 },
  },
];

const recoveries: WhoopRecovery[] = [
  {
    cycle_id: 93846,
    sleep_id: SLEEP_SAT,
    user_id: USER,
    created_at: "2026-11-14T06:20:00.000Z",
    updated_at: "2026-11-14T06:21:00.000Z",
    score_state: "SCORED",
    score: { user_calibrating: false, recovery_score: 72, resting_heart_rate: 48, hrv_rmssd_milli: 64.3271, spo2_percentage: 96.4375, skin_temp_celsius: 33.7123 },
  },
  {
    cycle_id: 93845,
    sleep_id: SLEEP_FRI,
    user_id: USER,
    created_at: "2026-11-13T05:50:00.000Z",
    updated_at: "2026-11-13T05:50:00.000Z",
    score_state: "SCORED",
    // a WHOOP 3.0: no SpO2, no skin temperature
    score: { user_calibrating: false, recovery_score: 41, resting_heart_rate: 53, hrv_rmssd_milli: 47.9 },
  },
];

const workouts: WhoopWorkout[] = [
  {
    id: "c0ffee00-1111-4222-8333-444455556666",
    user_id: USER,
    start: "2026-11-13T16:30:00.000Z", // 17:30 local, Friday
    end: "2026-11-13T17:25:00.000Z",
    timezone_offset: "+01:00",
    sport_name: "running",
    score_state: "SCORED",
    score: { strain: 10.2, kilojoule: 2600, zone_durations: { zone_two_milli: 1_800_000 } },
  },
  {
    id: "c0ffee00-7777-4888-9999-aaaabbbbcccc",
    user_id: USER,
    start: "2026-11-13T22:50:00.000Z", // 23:50 local Friday, ends after midnight: still Friday
    end: "2026-11-13T23:20:00.000Z",
    timezone_offset: "+01:00",
    sport_name: "yoga",
    score_state: "SCORED",
    score: { strain: 2.1, kilojoule: 300 },
  },
];

const day = (d: string, v: Partial<WhoopDay> = {}): WhoopDay => ({
  day: d,
  recovery_score: null,
  hrv_ms: null,
  resting_hr: null,
  sleep_minutes: null,
  sleep_performance: null,
  day_strain: null,
  workout_count: 0,
  workout_minutes: 0,
  ...v,
});

// ---------- time ----------

describe("local days", () => {
  it("parses WHOOP's UTC offsets", () => {
    expect(parseOffset("+01:00")).toBe(60);
    expect(parseOffset("-05:00")).toBe(-300);
    expect(parseOffset("+0530")).toBe(330);
    expect(parseOffset("Z")).toBe(0);
    expect(parseOffset("+25:00")).toBeNull();
    expect(parseOffset("Europe/Zurich")).toBeNull();
    expect(parseOffset(undefined)).toBeNull();
  });
  it("uses the record's own offset for the local day", () => {
    expect(dayAt("2026-11-14T22:30:00.000Z", "+01:00", TZ)).toBe("2026-11-14");
    expect(dayAt("2026-11-14T22:30:00.000Z", "+02:00", TZ)).toBe("2026-11-15");
    expect(dayAt("2026-11-15T03:00:00.000Z", "-05:00", TZ)).toBe("2026-11-14"); // New York evening
  });
  it("falls back to the person's time zone without an offset", () => {
    expect(dayAt("2026-11-14T23:30:00.000Z", null, TZ)).toBe("2026-11-15");
    expect(dayAt("2026-07-14T22:30:00.000Z", undefined, TZ)).toBe("2026-07-15"); // summer time
    expect(dayAt("not a date", "+01:00", TZ)).toBeNull();
  });
  it("counts sleep on the wake-up day and workouts on the start day", () => {
    expect(recordDay("sleep", sleeps[0], TZ)).toBe("2026-11-14");
    expect(recordDay("workout", workouts[1], TZ)).toBe("2026-11-13");
    expect(recordDay("sleep", null, TZ)).toBeNull();
  });
});

// ---------- daily summaries ----------

describe("daily summaries", () => {
  const days = summarizeDays({ cycles, recoveries, sleeps, workouts }, { tz: TZ, from: "2026-11-13", to: "2026-11-14" });
  const byDay = Object.fromEntries(days.map((d) => [d.day, d]));

  it("makes one row per local day inside the window", () => {
    expect(days.map((d) => d.day)).toEqual(["2026-11-13", "2026-11-14"]);
  });
  it("puts recovery, sleep and the cycle that follows the night on the wake-up day", () => {
    expect(byDay["2026-11-14"]).toEqual({
      day: "2026-11-14",
      recovery_score: 72,
      hrv_ms: 64.3,
      resting_hr: 48,
      sleep_minutes: 430, // nap left out
      sleep_performance: 88,
      day_strain: 6, // current cycle, so far
      workout_count: 0,
      workout_minutes: 0,
    });
  });
  it("keeps only counts and minutes of workouts (no sport, no per-workout strain)", () => {
    const fri = byDay["2026-11-13"];
    expect(fri.workout_count).toBe(2);
    expect(fri.workout_minutes).toBe(55 + 30);
    expect(fri.day_strain).toBe(12.4);
    expect(JSON.stringify(days)).not.toMatch(/running|yoga|sport/);
  });
  it("keeps only what the app shows or the coach reads (no SpO2, skin temperature, breathing, energy, steps or sleep need)", () => {
    for (const d of days) {
      expect(Object.keys(d).sort()).toEqual(
        ["day", "day_strain", "hrv_ms", "recovery_score", "resting_hr", "sleep_minutes", "sleep_performance", "workout_count", "workout_minutes"],
      );
    }
    expect(byDay["2026-11-13"].recovery_score).toBe(41);
  });
  it("ignores pending and unscorable records", () => {
    const pending = summarizeDays(
      {
        cycles: [{ ...cycles[0], score_state: "PENDING_SCORE", score: null }],
        recoveries: [{ ...recoveries[0], score_state: "PENDING_SCORE", score: null }],
        sleeps: [{ ...sleeps[0], score_state: "UNSCORABLE", score: null }],
        workouts: [],
      },
      { tz: TZ, from: "2026-11-14", to: "2026-11-14" },
    );
    expect(pending).toEqual([]);
  });
  it("finds the day of a recovery through its cycle when the sleep is not in the batch", () => {
    const only = summarizeDays({ cycles: [cycles[0]], recoveries: [recoveries[0]], sleeps: [], workouts: [] }, { tz: TZ, from: "2026-11-14", to: "2026-11-14" });
    expect(only[0].recovery_score).toBe(72);
    expect(only[0].day_strain).toBe(6);
  });
  it("drops values outside the plausible range instead of failing the database checks", () => {
    expect(bounded(21.04, 0, 21, 1)).toBe(21);
    expect(bounded(23, 0, 21, 1)).toBeNull();
    expect(bounded(Number.NaN, 0, 100)).toBeNull();
    expect(bounded("72", 0, 100)).toBeNull();
    const odd = summarizeDays(
      { cycles: [], recoveries: [{ ...recoveries[0], score: { recovery_score: 140, resting_heart_rate: 48 } }], sleeps: [sleeps[0]], workouts: [] },
      { tz: TZ, from: "2026-11-14", to: "2026-11-14" },
    );
    expect(odd[0].recovery_score).toBeNull();
    expect(odd[0].resting_hr).toBe(48);
  });
  it("adds split main sleeps and takes the scores from the longest", () => {
    const second: WhoopSleep = {
      ...sleeps[0],
      id: "dd00ee11-2222-4333-8444-555566667777",
      start: "2026-11-14T08:00:00.000Z",
      end: "2026-11-14T09:00:00.000Z",
      score: { stage_summary: stages(2_400_000, 600_000, 600_000, 0), sleep_performance_percentage: 20 },
    };
    const d = summarizeDays({ cycles: [], recoveries: [], sleeps: [sleeps[0], second], workouts: [] }, { tz: TZ, from: "2026-11-14", to: "2026-11-14" });
    expect(d[0].sleep_minutes).toBe(430 + 60);
    expect(d[0].sleep_performance).toBe(88);
  });
  it("computes minutes asleep from the stages, else from time in bed", () => {
    expect(asleepMinutes(stages(13_200_000, 6_000_000, 6_600_000))).toBe(430);
    expect(asleepMinutes({ total_in_bed_time_milli: 28_800_000, total_awake_time_milli: 1_800_000 })).toBe(450);
    expect(asleepMinutes(null)).toBeNull();
  });
});

// ---------- windows ----------

describe("sync windows", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  it("keeps today and the 13 days before", () => {
    expect(keepFrom("2026-11-14")).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("reads all 14 days on the first run or after a gap, else the last 3 days", () => {
    expect(syncWindow("2026-11-14", null, now)).toMatchObject({ from: "2026-11-01", to: "2026-11-14", start: "2026-10-30T00:00:00.000Z", end: null });
    expect(syncWindow("2026-11-14", "2026-11-14T09:00:00Z", now).from).toBe("2026-11-12");
    expect(syncWindow("2026-11-14", "2026-11-10T09:00:00Z", now).from).toBe("2026-11-01");
    expect(syncWindow("2026-11-14", "2026-11-14T09:00:00Z", now, { full: true }).from).toBe("2026-11-01");
  });
  it("recomputes a single day for a webhook, with margin around it", () => {
    expect(dayWindow("2026-11-10", "2026-11-14", now)).toEqual({ from: "2026-11-10", to: "2026-11-10", start: "2026-11-08T00:00:00.000Z", end: "2026-11-12T00:00:00.000Z" });
    expect(dayWindow("2026-11-14", "2026-11-14", now)?.end).toBeNull();
    expect(dayWindow("2026-10-20", "2026-11-14", now)).toBeNull(); // older than what is kept
  });
});

// ---------- coach line ----------

describe("coach line", () => {
  const today = "2026-11-14";
  const week = [
    day("2026-11-08", { recovery_score: 55, hrv_ms: 58, sleep_minutes: 400 }),
    day("2026-11-09", { recovery_score: 50, hrv_ms: 57, sleep_minutes: 410 }),
    day("2026-11-10", { recovery_score: 60, hrv_ms: 60, sleep_minutes: 420 }),
    day("2026-11-11", { recovery_score: 58, hrv_ms: 59, sleep_minutes: 415 }),
    day("2026-11-12", { recovery_score: 70, hrv_ms: 62, sleep_minutes: 440 }),
    day("2026-11-13", { recovery_score: 75, hrv_ms: 61, sleep_minutes: 425, day_strain: 12.4 }),
    day("2026-11-14", { recovery_score: 72, hrv_ms: 64.3, resting_hr: 48, sleep_minutes: 430, sleep_performance: 88, day_strain: 6 }),
  ];

  it("summarises today and the week in one short German line", () => {
    expect(whoopCoachLine(week, today)).toBe(
      "WHOOP (heute): Erholung 72 %, HRV 64 ms, Ruhepuls 48; Schlaf 7 Std 10 (Leistung 88 %); gestern Belastung 12.4. " +
        "7 Tage: Erholung Ø 63 % (steigend), HRV stabil, Schlaf Ø 7 Std 00.",
    );
  });
  it("falls back to yesterday when today has no night yet", () => {
    const line = whoopCoachLine(week.slice(0, 6), today)!;
    expect(line.startsWith("WHOOP (gestern): Erholung 75 %, HRV 61 ms; Schlaf 7 Std 05; gestern Belastung 12.4.")).toBe(true);
  });
  it("mentions yesterday's workouts with the strain", () => {
    const line = whoopCoachLine([day("2026-11-13", { day_strain: 14.25, workout_count: 2, workout_minutes: 95 })], today);
    expect(line).toBe("WHOOP: gestern Belastung 14.3 (2 Trainings, 1 Std 35).");
  });
  it("names a falling trend and skips trends with too few days", () => {
    const falling = [70, 72, 69, 71, 50, 45, 48].map((r, i) => day(addDays("2026-11-08", i), { recovery_score: r }));
    expect(whoopCoachLine(falling, today)).toContain("Erholung Ø 61 % (sinkend)");
    const short = whoopCoachLine([day("2026-11-14", { recovery_score: 80 })], today);
    expect(short).toBe("WHOOP (heute): Erholung 80 %.");
  });
  it("ignores days older than a week and returns null without data", () => {
    expect(whoopCoachLine([day("2026-11-01", { recovery_score: 80 })], today)).toBeNull();
    expect(whoopCoachLine([], today)).toBeNull();
    expect(whoopCoachLine([day("2026-11-14")], today)).toBeNull();
  });
  it("stays factual: no advice, no diagnosis", () => {
    const line = whoopCoachLine(week, today)!;
    expect(line.length).toBeLessThan(220);
    expect(line).not.toMatch(/krank|Arzt|Diagnose|solltest|musst|Therapie/i);
    expect(line).not.toMatch(/ß/);
    expect(WHOOP_COACH_RULE).toMatch(/Keine medizinischen Aussagen/);
    expect(WHOOP_ATTRIBUTION).toBe("Daten von WHOOP");
  });
  it("reaches the coach only with consent and an active connection", () => {
    expect(whoopForCoach({ consent_ai: false, status: "connected" }, week, today)).toBeNull();
    expect(whoopForCoach({ consent_ai: true, status: "needs_reconnect" }, week, today)).toBeNull();
    expect(whoopForCoach(null, week, today)).toBeNull();
    expect(whoopForCoach({ consent_ai: true, status: "connected" }, week, today)).toBe(whoopCoachLine(week, today));
  });
  it("formats hours like the app", () => {
    expect(hoursMinutes(430)).toBe("7 Std 10");
    expect(hoursMinutes(425)).toBe("7 Std 05");
    expect(hoursMinutes(45)).toBe("45 Min");
  });
});

// ---------- OAuth ----------

describe("OAuth", () => {
  it("draws exactly 8 URL-safe characters for the state", () => {
    for (let i = 0; i < 50; i++) expect(randomState()).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(randomState(() => new Uint8Array([0, 1, 62, 63, 64, 127, 255, 26]))).toBe("AB-_A__a");
  });
  it("builds the consent URL with space-separated scopes", () => {
    const url = new URL(authorizeUrl({ clientId: "client-123", redirectUri: "https://example.supabase.co/functions/v1/whoop-callback", state: "Ab3_x-9Z" }));
    expect(url.origin + url.pathname).toBe(WHOOP_AUTHORIZE_URL);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("Ab3_x-9Z");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.supabase.co/functions/v1/whoop-callback");
    expect(url.searchParams.get("scope")).toBe("offline read:recovery read:cycles read:sleep read:workout read:profile");
    expect(url.search).toContain("scope=offline%20read%3Arecovery");
  });
  it("sends client_secret_post form bodies", () => {
    const code = tokenRequestBody({ grant: "authorization_code", code: "abc", redirectUri: "https://x/cb", clientId: "id", clientSecret: "sec" });
    expect(Object.fromEntries(code)).toEqual({ grant_type: "authorization_code", code: "abc", redirect_uri: "https://x/cb", client_id: "id", client_secret: "sec" });
    const refresh = tokenRequestBody({ grant: "refresh_token", refreshToken: "r1", clientId: "id", clientSecret: "sec" });
    expect(Object.fromEntries(refresh)).toEqual({ grant_type: "refresh_token", refresh_token: "r1", scope: "offline", client_id: "id", client_secret: "sec" });
  });
  it("reads the token response with its real lifetime", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    expect(parseTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "offline read:sleep", token_type: "bearer" }, now)).toEqual({
      access_token: "a",
      refresh_token: "r",
      expires_at: "2026-11-14T11:00:00.000Z",
      scope: "offline read:sleep",
    });
    expect(parseTokenResponse({ access_token: "a" }, now)?.refresh_token).toBeNull();
    expect(parseTokenResponse({ error: "invalid_grant" })).toBeNull();
  });
  it("keeps every digit of the int64 user id", () => {
    expect(extractUserId('{"user_id": 9007199254740993, "email": "x@example.org"}')).toBe("9007199254740993");
    expect(extractUserId('{"user_id":10129}')).toBe("10129");
    expect(extractUserId('{"id":1}')).toBeNull();
  });
});

// ---------- tokens ----------

describe("token encryption", () => {
  const key = "k".repeat(16) + "-test-key-0123456789";
  it("round-trips and never stores the plain token", async () => {
    const sealed = await sealToken("access-token-xyz", key, "user-1:access");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("access-token-xyz");
    expect(await openToken(sealed, key, "user-1:access")).toBe("access-token-xyz");
    expect(await sealToken("access-token-xyz", key, "user-1:access")).not.toBe(sealed); // fresh IV
  });
  it("refuses another key, another person or another token kind", async () => {
    const sealed = await sealToken("refresh-1", key, "user-1:refresh");
    await expect(openToken(sealed, "another-key-another-key-another-key", "user-1:refresh")).rejects.toThrow();
    await expect(openToken(sealed, key, "user-2:refresh")).rejects.toThrow();
    await expect(openToken(sealed, key, "user-1:access")).rejects.toThrow();
    await expect(openToken("plain", key, "user-1:access")).rejects.toThrow();
  });
});

describe("single-flight refresh", () => {
  // In-memory twin of whoop_tokens + whoop_claim_refresh, and a WHOOP that rotates refresh tokens and
  // rejects a refresh token used twice.
  function setup(expiresAt: string) {
    const db = { access: "old-access", refresh: "r0", expiresAt, lock: null as string | null };
    let issued = 0;
    const exchanges: string[] = [];
    const whoop = async (refresh: string): Promise<TokenSet> => {
      exchanges.push(refresh);
      await new Promise((r) => setTimeout(r, 20));
      if (refresh !== `r${issued}`) throw new WhoopError(400, "invalid_grant");
      issued++;
      return { access_token: `access-${issued}`, refresh_token: `r${issued}`, expires_at: new Date(Date.now() + 3600_000).toISOString(), scope: null };
    };
    const store = {
      read: async () => ({ access: db.access, expiresAt: db.expiresAt }),
      claim: async (): Promise<RefreshClaim> => {
        if (db.lock) return { state: "busy" };
        db.lock = `lock-${Math.random()}`;
        return { state: "claimed", lock: db.lock, refresh: db.refresh };
      },
      save: async (_lock: string, t: TokenSet) => {
        db.access = t.access_token;
        db.refresh = t.refresh_token ?? db.refresh;
        db.expiresAt = t.expires_at;
        db.lock = null;
      },
      release: async (lock: string) => {
        if (db.lock === lock) db.lock = null;
      },
      exchange: whoop,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 5))),
    };
    return { db, store, exchanges };
  }

  it("uses the stored token while it is valid", async () => {
    const { store, exchanges } = setup(new Date(Date.now() + 30 * 60_000).toISOString());
    expect(await validAccessToken(store)).toBe("old-access");
    expect(exchanges).toEqual([]);
  });
  it("refreshes once for many parallel callers and saves the rotated refresh token", async () => {
    const { db, store, exchanges } = setup(new Date(Date.now() - 1000).toISOString());
    const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => validAccessToken(store, { pollMs: 5, waitMs: 2000 })));
    expect(new Set(tokens)).toEqual(new Set(["access-1"]));
    expect(exchanges).toEqual(["r0"]);
    expect(db.refresh).toBe("r1");
    expect(db.lock).toBeNull();
  });
  it("releases the lock when WHOOP refuses, and reports that a reconnect is needed", async () => {
    const { db, store } = setup(new Date(Date.now() - 1000).toISOString());
    db.refresh = "stale";
    const err = await validAccessToken(store).catch((e) => e);
    expect(err).toBeInstanceOf(WhoopError);
    expect(needsReconnect(err)).toBe(true);
    expect(db.lock).toBeNull();
  });
  it("gives up waiting when the other refresh never finishes", async () => {
    const { db, store } = setup(new Date(Date.now() - 1000).toISOString());
    db.lock = "someone-else";
    const err = await validAccessToken(store, { pollMs: 5, waitMs: 20 }).catch((e) => e);
    expect(err).toMatchObject({ status: 503, code: "refresh_busy" });
  });
  it("needs a reconnect without refresh token or connection", async () => {
    const base = setup(new Date(Date.now() - 1000).toISOString()).store;
    expect(needsReconnect(await validAccessToken({ ...base, claim: async () => ({ state: "no_refresh" }) }).catch((e) => e))).toBe(true);
    expect(needsReconnect(await validAccessToken({ ...base, read: async () => null }).catch((e) => e))).toBe(true);
  });
  it("re-checks the stored token after the claim: another worker's fresh token is used, not refreshed again", async () => {
    // worker A read the expired token; worker B refreshed and released the lock before A claimed
    const { db, store, exchanges } = setup(new Date(Date.now() - 1000).toISOString());
    const later = new Date(Date.now() + 3600_000).toISOString();
    const claim = async (): Promise<RefreshClaim> => {
      db.access = "access-from-b"; // B's save landed between A's read and A's claim
      db.expiresAt = later;
      db.lock = "lock-a";
      return { state: "claimed", lock: "lock-a", refresh: db.refresh, current: { access: db.access, expiresAt: db.expiresAt } };
    };
    expect(await validAccessToken({ ...store, claim })).toBe("access-from-b");
    expect(exchanges).toEqual([]); // no second rotation
    expect(db.lock).toBeNull(); // the lease was released
  });
  it("still refreshes when the stored token is the same old one, or the new one is about to run out", async () => {
    const { db, store, exchanges } = setup(new Date(Date.now() - 1000).toISOString());
    const same = async (): Promise<RefreshClaim> => {
      db.lock = "l1";
      return { state: "claimed", lock: "l1", refresh: db.refresh, current: { access: db.access, expiresAt: db.expiresAt } };
    };
    expect(await validAccessToken({ ...store, claim: same })).toBe("access-1");
    expect(exchanges).toEqual(["r0"]);
    // a forced refresh after a 401: a token that changed but expires within the skew is not trusted
    const soon = async (): Promise<RefreshClaim> => {
      db.lock = "l2";
      return { state: "claimed", lock: "l2", refresh: db.refresh, current: { access: "other", expiresAt: new Date(Date.now() + 10_000).toISOString() } };
    };
    expect(await validAccessToken({ ...store, claim: soon }, { force: true })).toBe("access-2");
  });
  it("a token sealed with another key needs a reconnect instead of failing on every sync", async () => {
    const sealed = await sealToken("access-1", "the-old-key-the-old-key-the-old-key", "u:access");
    const err = await openStoredToken(sealed, "the-new-key-the-new-key-the-new-key", "u:access").catch((e) => e);
    expect(err).toBeInstanceOf(WhoopError);
    expect(err).toMatchObject({ status: 401, code: "token_unreadable" });
    expect(needsReconnect(err)).toBe(true);
    expect(whoopErrorMessage(err)).toBe("Die Verbindung zu WHOOP muss neu eingerichtet werden. Bitte verbinde WHOOP neu.");
    expect(await openStoredToken(sealed, "the-old-key-the-old-key-the-old-key", "u:access")).toBe("access-1");
    await expect(openStoredToken("garbage", "k".repeat(40), "u:access")).rejects.toMatchObject({ code: "token_unreadable" });
  });
});

// ---------- link confirmation (CSRF fix) ----------

describe("link confirmation", () => {
  it("draws a 43-character URL-safe code from 32 random bytes", () => {
    const code = randomConfirmCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(CONFIRM_CODE_RE.test(code)).toBe(true);
    expect(randomConfirmCode()).not.toBe(code);
    expect(randomConfirmCode(() => new Uint8Array(32).fill(255))).toBe("_".repeat(42) + "8");
    expect(() => randomConfirmCode(() => new Uint8Array(8))).toThrow();
  });
  it("stores only a hash of the code (SHA-256, base64url)", async () => {
    expect(await hashConfirmCode("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
    const code = randomConfirmCode();
    const hash = await hashConfirmCode(code);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toBe(code);
    expect(await hashConfirmCode(code)).toBe(hash);
  });
  it("accepts 32 to 512 URL-safe characters like the app", () => {
    expect(CONFIRM_CODE_RE.test("a".repeat(31))).toBe(false);
    expect(CONFIRM_CODE_RE.test("a".repeat(512))).toBe(true);
    expect(CONFIRM_CODE_RE.test("a".repeat(513))).toBe(false);
    expect(CONFIRM_CODE_RE.test("a".repeat(40) + "=")).toBe(false);
  });
  it("sends the browser back to the app with the code, never with 'connected'", () => {
    const app = "https://mapius55.github.io/App-ich/";
    expect(appReturnUrl(app, "confirm", "Ab-_9".repeat(9))).toBe(`${app}#du/verbindungen?whoop=confirm&code=${"Ab-_9".repeat(9)}`);
    expect(appReturnUrl(app, "error")).toBe(`${app}#du/verbindungen?whoop=error`);
    expect(appReturnUrl(app, "denied")).toBe(`${app}#du/verbindungen?whoop=denied`);
    expect(appReturnUrl(app, "taken")).toBe(`${app}#du/verbindungen?whoop=taken`);
    expect(appReturnUrl(app, "confirm")).toBe(`${app}#du/verbindungen?whoop=error`); // no code, no confirm
    expect(appReturnUrl(`${app}#jetzt`, "error")).toBe(`${app}#du/verbindungen?whoop=error`);
  });
  it("connects only the caller's own pending link, in time", () => {
    const now = Date.parse("2026-11-15T10:00:00Z");
    const until = "2026-11-15T10:05:00Z";
    const past = "2026-11-15T09:59:59Z";
    expect(confirmOutcome({ user_id: "me", status: "pending", confirm_until: until }, "me", true, now)).toEqual({ outcome: "connect" });
    expect(confirmOutcome({ user_id: "me", status: "pending", confirm_until: past }, "me", true, now)).toEqual({ outcome: "expired", remove: "me" });
    expect(confirmOutcome({ user_id: "me", status: "pending", confirm_until: null }, "me", true, now)).toEqual({ outcome: "expired", remove: "me" });
    // the same request twice (e.g. a reload): the status, no second sync
    expect(confirmOutcome({ user_id: "me", status: "connected", confirm_until: until }, "me", false, now)).toEqual({ outcome: "already" });
    expect(confirmOutcome({ user_id: "me", status: "connected", confirm_until: past }, "me", false, now)).toEqual({ outcome: "expired", remove: null });
  });
  it("a foreign code removes that other pending link; a confirmed link is never removed", () => {
    const now = Date.parse("2026-11-15T10:00:00Z");
    const until = "2026-11-15T10:05:00Z";
    // the attack: someone else started the link, the victim's app sends the code
    expect(confirmOutcome({ user_id: "attacker", status: "pending", confirm_until: until }, "victim", false, now)).toEqual({ outcome: "mismatch", remove: "attacker" });
    expect(confirmOutcome({ user_id: "other", status: "connected", confirm_until: until }, "me", true, now)).toEqual({ outcome: "mismatch", remove: null });
    // an unknown code removes the caller's own pending link (it can't be confirmed any more)
    expect(confirmOutcome(null, "me", true, now)).toEqual({ outcome: "mismatch", remove: "me" });
    expect(confirmOutcome(null, "me", false, now)).toEqual({ outcome: "mismatch", remove: null });
    expect(confirmOutcome({ user_id: "me", status: "needs_reconnect", confirm_until: until }, "me", false, now)).toEqual({ outcome: "mismatch", remove: null });
  });
});

// ---------- webhooks ----------

describe("webhooks", () => {
  const secret = "whoop-client-secret-for-tests";
  const body = JSON.stringify({ user_id: 10129, id: SLEEP_SAT, type: "recovery.updated", trace_id: "d3c4b5a6-trace-0001" });
  const now = Date.parse("2026-11-14T06:30:00Z");
  const ts = String(now);
  const reference = nodeCrypto.createHmac("sha256", secret).update(ts + body).digest("base64");

  it("signs like WHOOP: base64(HMAC-SHA256(timestamp + body))", async () => {
    expect(await whoopSignature(body, ts, secret)).toBe(reference);
  });
  it("accepts a valid signature and refuses tampering", async () => {
    expect(await verifyWhoopSignature(body, ts, reference, secret, { now })).toBe(true);
    expect(await verifyWhoopSignature(body.replace("10129", "10130"), ts, reference, secret, { now })).toBe(false);
    expect(await verifyWhoopSignature(body, String(now + 1), reference, secret, { now })).toBe(false);
    expect(await verifyWhoopSignature(body, ts, reference, "other-secret", { now })).toBe(false);
    expect(await verifyWhoopSignature(body, null, reference, secret, { now })).toBe(false);
    expect(await verifyWhoopSignature(body, ts, null, secret, { now })).toBe(false);
    expect(await verifyWhoopSignature(body, ts, reference, "", { now })).toBe(false);
  });
  it("refuses old timestamps (seconds or milliseconds)", async () => {
    const oldTs = String(now - 2 * 86_400_000);
    const oldSig = nodeCrypto.createHmac("sha256", secret).update(oldTs + body).digest("base64");
    expect(await verifyWhoopSignature(body, oldTs, oldSig, secret, { now })).toBe(false);
    const secTs = String(Math.floor(now / 1000));
    const secSig = nodeCrypto.createHmac("sha256", secret).update(secTs + body).digest("base64");
    expect(await verifyWhoopSignature(body, secTs, secSig, secret, { now })).toBe(true);
  });
  it("parses the event and keeps the user id exact", () => {
    expect(parseWebhookEvent(body)).toEqual({ userId: "10129", id: SLEEP_SAT, type: "recovery.updated", traceId: "d3c4b5a6-trace-0001" });
    expect(parseWebhookEvent(JSON.stringify({ user_id: 1, id: "x", type: "cycle.updated", trace_id: "t" }))).toBeNull();
    expect(parseWebhookEvent(JSON.stringify({ user_id: 1, id: "../etc", type: "sleep.updated", trace_id: "t" }))).toBeNull();
    expect(parseWebhookEvent("not json")).toBeNull();
    expect(parseWebhookEvent(JSON.stringify({ id: "x", type: "sleep.deleted", trace_id: "t" }))).toBeNull();
  });
  it("compares in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

// ---------- API client ----------

describe("API client", () => {
  type Call = { url: URL; auth: string | null; method: string };
  function fakeFetch(handler: (c: Call, n: number) => Response) {
    const calls: Call[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const c = { url: new URL(String(input)), auth: new Headers(init?.headers).get("Authorization"), method: init?.method ?? "GET" };
      calls.push(c);
      return handler(c, calls.length);
    }) as typeof fetch;
    return { f, calls };
  }
  const page = (records: unknown[], next?: string) => new Response(JSON.stringify({ records, next_token: next ?? null }), { status: 200 });
  const noWait = async () => {};

  it("follows nextToken with the maximum page size", async () => {
    const { f, calls } = fakeFetch((c) => (c.url.searchParams.get("nextToken") ? page([{ id: 2 }]) : page([{ id: 1 }], "tok-2")));
    const api = whoopClient({ fetch: f, token: async () => "t1", sleep: noWait });
    const res = await api.list<{ id: number }>("/v2/cycle", { start: "2026-11-01T00:00:00.000Z" });
    expect(res).toEqual({ items: [{ id: 1 }, { id: 2 }], truncated: false });
    expect(calls[0].url.pathname).toBe("/developer/v2/cycle");
    expect(calls[0].url.searchParams.get("limit")).toBe("25");
    expect(calls[0].url.searchParams.get("start")).toBe("2026-11-01T00:00:00.000Z");
    expect(calls[1].url.searchParams.get("nextToken")).toBe("tok-2");
    expect(calls[0].auth).toBe("Bearer t1");
  });
  it("marks a list as truncated when the pages run out", async () => {
    const { f } = fakeFetch(() => page([{ id: 1 }], "more"));
    const res = await whoopClient({ fetch: f, token: async () => "t", sleep: noWait }).list("/v2/activity/sleep", {}, 2);
    expect(res.truncated).toBe(true);
    expect(res.items).toHaveLength(2);
  });
  it("refreshes once after a 401 and shares the new token between parallel requests", async () => {
    let refreshes = 0;
    const { f, calls } = fakeFetch((c) => (c.auth === "Bearer old" ? new Response("", { status: 401 }) : page([])));
    const api = whoopClient({ fetch: f, token: async () => "old", onUnauthorized: async () => (refreshes++, "new"), sleep: noWait });
    await Promise.all([api.list("/v2/cycle", {}), api.list("/v2/recovery", {}), api.list("/v2/activity/sleep", {})]);
    expect(refreshes).toBe(1);
    expect(calls.filter((c) => c.auth === "Bearer new")).toHaveLength(3);
  });
  it("gives up with 401 when the access is gone", async () => {
    const { f } = fakeFetch(() => new Response("", { status: 401 }));
    const err = await whoopClient({ fetch: f, token: async () => "t", onUnauthorized: async () => "t2", sleep: noWait }).get("/v2/cycle").catch((e) => e);
    expect(err).toMatchObject({ status: 401 });
    expect(needsReconnect(err)).toBe(true);
  });
  it("waits for a short Retry-After and reports a long one", async () => {
    const waits: number[] = [];
    const short = fakeFetch((_c, n) => (n === 1 ? new Response("", { status: 429, headers: { "Retry-After": "2" } }) : page([{ id: 1 }])));
    const ok = await whoopClient({ fetch: short.f, token: async () => "t", sleep: async (ms) => void waits.push(ms) }).list("/v2/cycle", {});
    expect(ok.items).toHaveLength(1);
    expect(waits).toEqual([2000]);

    const long = fakeFetch(() => new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    const err = await whoopClient({ fetch: long.f, token: async () => "t", sleep: noWait }).get("/v2/cycle").catch((e) => e);
    expect(err).toMatchObject({ status: 429, retryAfter: 120 });
    expect(whoopErrorMessage(err)).toMatch(/zu viele Anfragen/);
  });
  it("returns null for a record that no longer exists, and revokes with DELETE", async () => {
    const { f, calls } = fakeFetch((c) => new Response(null, { status: c.method === "DELETE" ? 204 : 404 }));
    const api = whoopClient({ fetch: f, token: async () => "t", sleep: noWait });
    expect(await api.get(`/v2/activity/sleep/${SLEEP_SAT}`)).toBeNull();
    expect(await api.revoke()).toBe(true);
    expect(calls[1]).toMatchObject({ method: "DELETE" });
    expect(calls[1].url.pathname).toBe("/developer/v2/user/access");
  });
  it("reads Retry-After as seconds or HTTP date", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    expect(parseRetryAfter("7", now)).toBe(7);
    expect(parseRetryAfter("Sat, 14 Nov 2026 10:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter(null, now)).toBe(60);
    expect(parseRetryAfter("99999", now)).toBe(3600);
  });
  it("has German messages without sharp s", () => {
    for (const e of [new WhoopError(401), new WhoopError(429), new WhoopError(503), new WhoopError(0, "network"), new Error("x")]) {
      expect(whoopErrorMessage(e)).not.toMatch(/ß/);
    }
  });
});
