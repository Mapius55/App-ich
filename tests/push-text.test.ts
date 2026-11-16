// Notifications from the coach, «Morgens und abends, schlauer»: when they are due, when they stay out
// (she was already there, 14 quiet days), what they say (statements from her data, rotating, safe for
// the lock screen, never a dream). All pure, from supabase/functions/_shared/push_text.ts.
import { describe, expect, it } from "vitest";
import {
  addDays,
  chooseBody,
  dueSlot,
  eveningCandidates,
  fingerprint,
  isSensitive,
  localParts,
  mentionsDream,
  morningCandidates,
  pushTitle,
  safeLabel,
  skipReason,
  slotMinutes,
  weekendTime,
  zoneOr,
  type Candidate,
  type EveningFacts,
  type MorningFacts,
  type PushGoal,
  type SentBefore,
  type Slot,
} from "../supabase/functions/_shared/push_text";
import { notifyHint, NOTIFY_RULES } from "../src/places/NotificationsSection";

const TZ = "Europe/Zurich";
// Monday 16 Nov 2026 (CET, UTC+1); Saturday is the 21st
const at = (local: string) => new Date(`${local}+01:00`);
const MON = "2026-11-16";

const goals: PushGoal[] = [
  { id: "g-run", title: "Halbmarathon Zürich", kind: "goal", status: "active" },
  { id: "g-jp", title: "Japanisch lernen", kind: "goal", status: "active" },
  { id: "g-island", title: "Nordlichter in Island sehen", kind: "dream", status: "active" },
  { id: "g-weight", title: "5 kg abnehmen", kind: "goal", status: "active" },
];

const ev = (local: string, title: string, extra: Partial<MorningFacts["events"][number]> = {}) => ({
  title,
  starts_at: at(local).toISOString(),
  ends_at: null,
  all_day: false,
  kind: "termin",
  goal_id: null,
  ...extra,
});
const morning = (f: Partial<MorningFacts>, when = `${MON}T07:30:00`) => morningCandidates({ events: [], dueSteps: [], goals, ...f }, at(when), TZ);
const evening = (f: Partial<EveningFacts>, when = `${MON}T21:00:00`) => eveningCandidates({ goals, goalTime: [], milestones: [], habits: [], ...f }, at(when), TZ);
const first = (groups: Candidate[][]) => groups[0][0].body;
const all = (groups: Candidate[][]) => groups.flat().map((c) => c.body);

describe("time", () => {
  it("reads her local day, time and weekday", () => {
    expect(localParts(at(`${MON}T07:30:00`), TZ)).toEqual({ date: MON, minutes: 450, weekday: 0 });
    expect(localParts(new Date("2026-11-21T23:30:00Z"), TZ)).toEqual({ date: "2026-11-22", minutes: 30, weekday: 6 });
  });
  it("reads summer time (CEST) and the days the clocks change", () => {
    // Saturday 4 July 2026, 09:00 in Zurich = 07:00 UTC
    expect(localParts(new Date("2026-07-04T07:00:00Z"), TZ)).toEqual({ date: "2026-07-04", minutes: 540, weekday: 5 });
    // Sunday 29 March 2026: 02:00 becomes 03:00, so 09:00 is 07:00 UTC; just before the switch it's 01:59 CET
    expect(localParts(new Date("2026-03-29T07:00:00Z"), TZ)).toEqual({ date: "2026-03-29", minutes: 540, weekday: 6 });
    expect(localParts(new Date("2026-03-29T00:59:00Z"), TZ)).toEqual({ date: "2026-03-29", minutes: 119, weekday: 6 });
    // Sunday 25 October 2026: 03:00 becomes 02:00 again, so 09:00 is 08:00 UTC
    expect(localParts(new Date("2026-10-25T08:00:00Z"), TZ)).toEqual({ date: "2026-10-25", minutes: 540, weekday: 6 });
    // after midnight in summer: already the next local day while UTC is still the day before
    expect(localParts(new Date("2026-07-04T22:30:00Z"), TZ)).toEqual({ date: "2026-07-05", minutes: 30, weekday: 6 });
  });
  it("falls back to Zurich for a missing or unknown zone", () => {
    expect(zoneOr(null)).toBe(TZ);
    expect(zoneOr("Mars/Olympus")).toBe(TZ);
    expect(zoneOr("America/New_York")).toBe("America/New_York");
  });
  it("adds days across months", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays(MON, -7)).toBe("2026-11-09");
  });
});

describe("weekend: 90 minutes later, only at the default times", () => {
  it("shifts the default morning and evening on Saturday and Sunday", () => {
    expect(slotMinutes("morning", "07:30:00", 0)).toBe(450);
    expect(slotMinutes("morning", "07:30:00", 5)).toBe(540);
    expect(slotMinutes("morning", "07:30:00", 6)).toBe(540);
    expect(slotMinutes("evening", "21:00:00", 6)).toBe(22 * 60 + 30);
  });
  it("keeps a time she chose herself", () => {
    expect(slotMinutes("morning", "06:45:00", 5)).toBe(405);
    expect(slotMinutes("evening", "20:00:00", 6)).toBe(1200);
    expect(weekendTime("morning", "06:45")).toBeNull();
  });
  it("tells the settings the weekend time", () => {
    expect(weekendTime("morning", "07:30:00")).toBe("09:00");
    expect(notifyHint("morning", "07:30")).toBe("Was heute ansteht, am Wochenende um 09:00");
    expect(notifyHint("evening", "21:00")).toBe("Ein kurzer Blick auf deinen Tag, am Wochenende um 22:30");
    expect(notifyHint("morning", "06:45")).toBe("Was heute ansteht");
  });
});

describe("dueSlot", () => {
  const p = { notify_morning: "07:30:00", notify_evening: "21:00:00", last_morning_push: null, last_evening_push: null };
  const now = (local: string) => localParts(at(local), TZ);
  it("is due from its time on for an hour", () => {
    expect(dueSlot(p, now(`${MON}T07:29:00`))).toBeNull();
    expect(dueSlot(p, now(`${MON}T07:30:00`))).toBe("morning");
    expect(dueSlot(p, now(`${MON}T08:29:00`))).toBe("morning");
    expect(dueSlot(p, now(`${MON}T08:30:00`))).toBeNull();
    expect(dueSlot(p, now(`${MON}T21:10:00`))).toBe("evening");
  });
  it("is decided once a day", () => {
    expect(dueSlot({ ...p, last_morning_push: MON }, now(`${MON}T07:45:00`))).toBeNull();
    expect(dueSlot({ ...p, last_morning_push: "2026-11-15" }, now(`${MON}T07:45:00`))).toBe("morning");
  });
  it("comes later on the weekend at the default time", () => {
    expect(dueSlot(p, now("2026-11-21T07:45:00"))).toBeNull();
    expect(dueSlot(p, now("2026-11-21T09:05:00"))).toBe("morning");
    expect(dueSlot(p, now("2026-11-22T21:15:00"))).toBeNull();
    expect(dueSlot(p, now("2026-11-22T22:40:00"))).toBe("evening");
    expect(dueSlot({ ...p, notify_morning: "07:00:00" }, now("2026-11-21T07:10:00"))).toBe("morning");
  });
  it("comes at 09:00 local on a summer Saturday and on the day the clocks go forward", () => {
    const local = (utc: string) => localParts(new Date(utc), TZ);
    expect(dueSlot(p, local("2026-07-04T05:31:00Z"))).toBeNull(); // 07:31 CEST
    expect(dueSlot(p, local("2026-07-04T07:01:00Z"))).toBe("morning"); // 09:01 CEST
    // the day the clocks go forward: 09:59 CEST is due, 10:01 CEST is past the window (in CET both would be an hour earlier)
    expect(dueSlot(p, local("2026-03-29T07:59:00Z"))).toBe("morning");
    expect(dueSlot(p, local("2026-03-29T08:01:00Z"))).toBeNull();
    // the day they go back: 09:05 CET (it would be 10:05 in CEST)
    expect(dueSlot(p, local("2026-10-25T08:05:00Z"))).toBe("morning");
    expect(dueSlot(p, local("2026-07-06T05:35:00Z"))).toBe("morning"); // Monday 07:35 CEST
  });
  it("never when switched off", () => {
    expect(dueSlot({ ...p, notify_morning: null, notify_evening: null }, now(`${MON}T07:30:00`))).toBeNull();
  });
});

describe("skipReason", () => {
  const iso = (local: string) => at(local).toISOString();
  const skip = (slot: Slot, now: string, a: { lastOpen?: string | null; lastTalk?: string | null; since?: string | null }, time = slot === "morning" ? 450 : 1260) =>
    skipReason(slot, at(now), TZ, time, { lastOpen: a.lastOpen ?? null, lastTalk: a.lastTalk ?? null, since: a.since ?? null });

  it("morning: none once she opened the app today (the hidden opener counts)", () => {
    expect(skip("morning", `${MON}T07:30:00`, { lastOpen: iso(`${MON}T06:50:00`) })).toBe("opened_today");
    expect(skip("morning", `${MON}T07:30:00`, { lastOpen: iso(`${MON}T00:10:00`) })).toBe("opened_today");
  });
  it("morning: goes out when she was last there yesterday", () => {
    expect(skip("morning", `${MON}T07:30:00`, { lastOpen: iso("2026-11-15T23:50:00"), lastTalk: iso("2026-11-15T23:50:00") })).toBeNull();
  });
  it("evening: none when she talked in the last 3 hours", () => {
    expect(skip("evening", `${MON}T21:00:00`, { lastOpen: iso(`${MON}T18:30:00`), lastTalk: iso(`${MON}T18:30:00`) })).toBe("talked_recently");
    expect(skip("evening", `${MON}T21:00:00`, { lastOpen: iso(`${MON}T18:01:00`), lastTalk: iso(`${MON}T18:01:00`) })).toBe("talked_recently");
    // 3 h 01 min ago is not «recent», but it was this evening
    expect(skip("evening", `${MON}T21:00:00`, { lastOpen: iso(`${MON}T17:59:00`), lastTalk: iso(`${MON}T17:59:00`) })).toBe("this_evening");
    // an evening time just after midnight: a talk shortly before midnight still counts (3 hours on the clock, not the calendar day)
    expect(skip("evening", "2026-11-17T00:30:00", { lastOpen: iso(`${MON}T23:00:00`), lastTalk: iso(`${MON}T23:00:00`) }, 30)).toBe("talked_recently");
  });
  it("evening: none when the app already greeted her this evening", () => {
    // opened at 17:10 (only the hidden opener and the greeting), 3 h 50 min before the push
    expect(skip("evening", `${MON}T21:00:00`, { lastOpen: iso(`${MON}T17:10:00`), lastTalk: iso(`${MON}T08:00:00`) })).toBe("this_evening");
  });
  it("evening: goes out when she was there only during the day", () => {
    expect(skip("evening", `${MON}T21:00:00`, { lastOpen: iso(`${MON}T16:30:00`), lastTalk: iso(`${MON}T16:29:00`) })).toBeNull();
    expect(skip("evening", `${MON}T21:00:00`, { lastOpen: iso("2026-11-15T20:00:00"), lastTalk: iso("2026-11-15T20:00:00") })).toBeNull();
  });
  it("evening: an early evening time counts «this evening» from that time", () => {
    expect(skip("evening", `${MON}T16:20:00`, { lastOpen: iso(`${MON}T16:05:00`), lastTalk: iso(`${MON}T09:00:00`) }, 16 * 60)).toBe("this_evening");
    expect(skip("evening", `${MON}T16:20:00`, { lastOpen: iso(`${MON}T12:00:00`), lastTalk: iso(`${MON}T09:00:00`) }, 16 * 60)).toBeNull();
  });
  it("pauses silently after 14 days without opening the app, and resumes once she opens it", () => {
    const old = iso("2026-11-02T07:00:00"); // 14 days and a half hour before
    expect(skip("morning", `${MON}T07:30:00`, { lastOpen: old, lastTalk: old })).toBe("paused");
    expect(skip("evening", `${MON}T21:00:00`, { lastOpen: old, lastTalk: old })).toBe("paused");
    expect(skip("morning", `${MON}T07:30:00`, { lastOpen: iso("2026-11-03T08:00:00") })).toBeNull(); // 13 days
    // she opens the app again: the next morning goes out
    expect(skip("morning", "2026-11-17T07:30:00", { lastOpen: iso(`${MON}T12:00:00`) })).toBeNull();
  });
  it("counts the pause from her sign-up while she has no message yet", () => {
    expect(skip("morning", `${MON}T07:30:00`, { since: iso("2026-10-20T10:00:00") })).toBe("paused");
    expect(skip("morning", `${MON}T07:30:00`, { since: iso("2026-11-10T10:00:00") })).toBeNull();
    expect(skip("morning", `${MON}T07:30:00`, {})).toBeNull();
  });
});

describe("lock-screen safety", () => {
  it("knows words that don't belong on a lock screen", () => {
    for (const t of [
      "Psychotherapie", "Zahnarzttermin", "Termin bei Dr. Meier (Hausarzt)", "5 kg abnehmen", "Physio Knie", "OP-Vorbereitung", "Blutentnahme", "Paarberatung",
      "Betreibungsamt", "Schlaf tracken", "HRV messen", "Angst vor Prüfung", "Termin bei Dr. Keller", "Doktor Huber",
      "Operation", "Knie-Operation", "Knie operieren lassen", "Spitex", "Mammografie", "Mammographie", "Darmspiegelung", "Koloskopie", "Biopsie", "Bluttest",
      "Spritze", "Medis holen", "Gyn", "Selbsthilfegruppe", "Zahnkontrolle", "Wundkontrolle", "IV-Abklärung", "Kontrolltermin", "Ernährungsberatung buchen",
    ])
      expect(isSensitive(t), t).toBe(true);
  });
  it("leaves everyday titles alone", () => {
    for (const t of [
      "Vorlesung Statistik", "Lauftraining", "10 Kilometer laufen", "Oma besucht", "Kooperation mit Lena", "Kooperationspartner treffen", "Geburtstag Anna",
      "Impulsvortrag", "Langstreckenlauf", "1 Std Japanisch", "Doktorarbeit schreiben", "Teil IV lesen", "Archiv-Tag", "Oper besuchen", "Operatives Meeting", "Krafttraining",
    ])
      expect(isSensitive(t), t).toBe(false);
  });
  it("hides a title that serves a goal with a sensitive title", () => {
    expect(safeLabel("Krafttraining", goals, "g-weight")).toBeNull();
    expect(safeLabel("Krafttraining", goals, "g-run")).toBe("Krafttraining");
    expect(safeLabel("Krafttraining", goals)).toBe("Krafttraining");
  });
  it("shows no title at all when her goals could not be read (a dream could hide in any title)", () => {
    expect(safeLabel("Island-Reise buchen", null)).toBeNull();
    expect(safeLabel("Vorlesung Statistik", null)).toBeNull();
  });
  it("recognises her dreams in free text", () => {
    expect(mentionsDream("Island-Reise buchen", goals)).toBe(true);
    expect(mentionsDream("Nordlichter in Island sehen", goals)).toBe(true);
    expect(mentionsDream("Arzt sehen", goals)).toBe(false); // «sehen» alone doesn't point to the dream
    expect(mentionsDream("Lauftraining", goals)).toBe(false);
  });
  it("tidies and shortens her titles", () => {
    expect(safeLabel("  Vorlesung   Statistik. ", goals)).toBe("Vorlesung Statistik");
    expect(safeLabel("Präsentation für das Quartalsmeeting mit dem ganzen Team vorbereiten", goals)).toBe("Präsentation für das Quartalsmeeting mit…");
    expect(safeLabel("Psychotherapie", goals)).toBeNull();
    expect(safeLabel("Island planen", goals)).toBeNull();
    expect(safeLabel("", goals)).toBeNull();
    expect(safeLabel("…", goals)).toBeNull();
  });
});

describe("morning: what is on today", () => {
  it("names today's first entries with their times", () => {
    const g = morning({ events: [ev(`${MON}T17:30:00`, "Lauftraining", { kind: "block", goal_id: "g-run" }), ev(`${MON}T10:15:00`, "Vorlesung Statistik")] });
    expect(first(g)).toBe("Heute: 10:15 Vorlesung Statistik, 17:30 Lauftraining.");
    expect(g[0].map((c) => c.body)).toEqual([
      "Heute: 10:15 Vorlesung Statistik, 17:30 Lauftraining.",
      "Als Erstes heute: 10:15 Vorlesung Statistik. Danach 17:30 Lauftraining.",
      "Um 10:15 geht es los: Vorlesung Statistik. Später 17:30 Lauftraining.",
      "Montag: 10:15 Vorlesung Statistik, 17:30 Lauftraining.",
      "Heute zwei Einträge, der erste um 10:15.",
    ]);
  });
  it("counts what does not fit", () => {
    const g = morning({ events: [ev(`${MON}T09:00:00`, "A"), ev(`${MON}T11:00:00`, "B"), ev(`${MON}T14:00:00`, "C"), ev(`${MON}T16:00:00`, "D")] });
    expect(first(g)).toBe("Heute: 09:00 A, 11:00 B, dazu 2 weitere Einträge.");
  });
  it("shows a sensitive entry only by its time", () => {
    const g = morning({ events: [ev(`${MON}T10:15:00`, "Psychotherapie"), ev(`${MON}T18:00:00`, "Abnehmen: Waage", { kind: "block", goal_id: "g-weight" })] });
    expect(first(g)).toBe("Heute: 10:15 Termin, 18:00 Zeitblock.");
    expect(all(g).join(" ")).not.toMatch(/Psycho|Abnehm|Waage/);
  });
  it("never names a dream: its blocks are left out, entries naming it are shown by time only", () => {
    const g = morning({
      events: [ev(`${MON}T09:00:00`, "Island: Flüge vergleichen", { kind: "block", goal_id: "g-island" }), ev(`${MON}T12:00:00`, "Nordlichter-Doku schauen")],
    });
    expect(first(g)).toBe("Heute: 12:00 Termin.");
    expect(all(g).join(" ")).not.toMatch(/Island|Nordlicht/);
  });
  it("leaves out entries of an unknown goal when the goals could not be read", () => {
    const g = morningCandidates({ events: [ev(`${MON}T09:00:00`, "Etwas für ein Ziel", { kind: "block", goal_id: "g-run" })], dueSteps: [], goals: null }, at(`${MON}T07:30:00`), TZ);
    expect(all(g).join(" ")).not.toMatch(/Ziel/);
    expect(g[0][0].template).toMatch(/^m\.plain\./);
  });
  it("shows entries only by their time when the goals could not be read (no dream in a free title)", () => {
    const g = morningCandidates({ events: [ev(`${MON}T11:00:00`, "Island-Reise buchen")], dueSteps: [], goals: null }, at(`${MON}T07:30:00`), TZ);
    expect(first(g)).toBe("Heute: 11:00 Termin.");
    expect(all(g).join(" ")).not.toMatch(/Island/);
  });
  it("shows a block for a goal with a sensitive title only by its time", () => {
    expect(first(morning({ events: [ev(`${MON}T18:00:00`, "Krafttraining", { kind: "block", goal_id: "g-weight" })] }))).toBe("Heute: 18:00 Zeitblock.");
  });
  it("skips what is already over and what is not today", () => {
    const g = morning({ events: [ev(`${MON}T06:00:00`, "Frühsport"), ev("2026-11-17T09:00:00", "Morgen"), ev(`${MON}T19:00:00`, "Konzert")] });
    expect(first(g)).toBe("Heute: 19:00 Konzert.");
  });
  it("names a step due today when nothing is timed, never a dream's, a sensitive one only as «eine Etappe»", () => {
    expect(first(morning({ dueSteps: [{ title: "Anmeldung abschicken", goal_id: "g-run" }] }))).toBe("Heute an der Reihe: Anmeldung abschicken.");
    expect(first(morning({ dueSteps: [{ title: "Waage kaufen", goal_id: "g-weight" }] }))).toBe("Heute ist eine Etappe an der Reihe.");
    expect(first(morning({ dueSteps: [{ title: "A", goal_id: "g-run" }, { title: "B", goal_id: "g-jp" }] }))).toBe("Heute sind zwei Etappen an der Reihe.");
    const dream = morning({ dueSteps: [{ title: "Flüge vergleichen", goal_id: "g-island" }] });
    expect(dream[0][0].template).toMatch(/^m\.plain\./);
    expect(all(dream).join(" ")).not.toMatch(/Flüge|Etappe/);
    // timed entries come first
    expect(first(morning({ events: [ev(`${MON}T10:15:00`, "Vorlesung")], dueSteps: [{ title: "Anmeldung abschicken", goal_id: "g-run" }] }))).toBe("Heute: 10:15 Vorlesung.");
  });
  it("names all-day entries, also over several days", () => {
    const allDay = { all_day: true, starts_at: at("2026-11-15T00:00:00").toISOString(), ends_at: at("2026-11-17T00:00:00").toISOString() };
    expect(first(morning({ events: [{ ...ev(`${MON}T00:00:00`, "Ferien im Tessin"), ...allDay }] }))).toBe("Heute: Ferien im Tessin.");
  });
  it("without entries: a gentle plain line, never a claim about her day (the app doesn't see every calendar)", () => {
    const g = morning({});
    expect(g).toHaveLength(1);
    expect(first(g)).toBe("Einen guten Montag.");
    expect(all(g).join(" ")).not.toMatch(/nichts|leer|frei|ohne Termin|gehört dir|geplant|Kalender/i);
  });
});

describe("evening: one small win of today, else a gentle line", () => {
  const today = (local: string) => at(local).toISOString();
  it("a goal reached comes first", () => {
    const g = evening({
      goals: [...goals, { id: "g-done", title: "Bewerbung abschicken", kind: "goal", status: "done", done_at: today(`${MON}T15:00:00`) }],
      goalTime: [{ goal_id: "g-jp", minutes: 40, source: "person" }],
    });
    expect(first(g)).toBe("Heute erreicht: Bewerbung abschicken.");
  });
  it("then a step done today", () => {
    expect(first(evening({ milestones: [{ title: "Anmeldung abschicken", goal_id: "g-run", done_at: today(`${MON}T12:00:00`) }] }))).toBe("Heute erledigt: Anmeldung abschicken.");
    expect(first(evening({ milestones: [{ title: "Alt", goal_id: "g-run", done_at: today("2026-11-15T12:00:00") }] }))).toBe("Schönen Abend.");
  });
  it("then the time she confirmed for a goal", () => {
    expect(first(evening({ goalTime: [{ goal_id: "g-jp", minutes: 25, source: "person" }, { goal_id: "g-jp", minutes: 15, source: "block" }, { goal_id: "g-run", minutes: 30, source: "nolio" }] }))).toBe(
      "Heute 40 Minuten für Japanisch lernen.",
    );
    expect(first(evening({ goalTime: [{ goal_id: "g-run", minutes: 70, source: "nolio" }] }))).toBe("Heute 1 Std 10 Min für Halbmarathon Zürich.");
    expect(first(evening({ goalTime: [{ goal_id: "g-run", minutes: 120, source: "block" }] }))).toBe("Heute 2 Stunden für Halbmarathon Zürich.");
  });
  it("then a habit ticked today", () => {
    expect(first(evening({ habits: [{ title: "Meditieren" }, { title: "Lesen" }] }))).toBe("Heute abgehakt: Meditieren und Lesen.");
    expect(first(evening({ habits: [{ title: "A" }, { title: "B" }, { title: "C" }] }))).toBe("Heute drei Gewohnheiten abgehakt.");
  });
  it("hides sensitive names, never shows WHOOP time, never a dream", () => {
    expect(first(evening({ goalTime: [{ goal_id: "g-weight", minutes: 30, source: "person" }] }))).toBe("Heute 30 Minuten für dein Ziel.");
    expect(first(evening({ goalTime: [{ goal_id: "g-run", minutes: 45, source: "whoop" }] }))).toBe("Schönen Abend.");
    const dream = evening({
      goals: goals.map((g) => (g.id === "g-island" ? { ...g, status: "done", done_at: today(`${MON}T10:00:00`) } : g)),
      goalTime: [{ goal_id: "g-island", minutes: 60, source: "person" }],
      milestones: [{ title: "Flug buchen", goal_id: "g-island", done_at: today(`${MON}T11:00:00`) }],
      habits: [{ title: "Isländisch üben", goal_id: "g-island" }],
    });
    expect(first(dream)).toBe("Schönen Abend.");
    expect(all(dream).join(" ")).not.toMatch(/Island|Nordlicht|Flug/);
    expect(first(evening({ habits: [{ title: "Tabletten nehmen" }] }))).toBe("Heute eine Gewohnheit abgehakt.");
  });
  it("without a win: a gentle neutral line", () => {
    const g = evening({});
    expect(g).toHaveLength(1);
    expect(g[0].length).toBeGreaterThanOrEqual(8);
    expect(all(g)).toContain("Schönen Montagabend.");
  });
});

describe("every body", () => {
  const facts = [
    morning({ events: [ev(`${MON}T10:15:00`, "Vorlesung Statistik"), ev(`${MON}T17:30:00`, "Lauftraining")] }),
    morning({ events: [ev(`${MON}T10:15:00`, "Vorlesung")] }),
    morning({ dueSteps: [{ title: "Kapitel 2", goal_id: "g-jp" }] }),
    morning({ dueSteps: [{ title: "A", goal_id: "g-jp" }, { title: "B", goal_id: "g-jp" }] }),
    morning({}),
    morning({}, "2026-11-21T09:00:00"),
    evening({ goals: [...goals, { id: "d", title: "Umzug", kind: "goal", status: "done", done_at: at(`${MON}T09:00:00`).toISOString() }] }),
    evening({ milestones: [{ title: "Schritt", goal_id: "g-run", done_at: at(`${MON}T09:00:00`).toISOString() }] }),
    evening({ milestones: [1, 2].map(() => ({ title: "Schritt", goal_id: "g-run", done_at: at(`${MON}T09:00:00`).toISOString() })) }),
    evening({ goalTime: [{ goal_id: "g-jp", minutes: 40 }] }),
    evening({ goalTime: [{ goal_id: "g-weight", minutes: 40 }] }),
    evening({ habits: [{ title: "Lesen" }] }),
    evening({ habits: [{ title: "A" }, { title: "B" }, { title: "C" }] }),
    evening({}),
  ];
  const bodies = facts.flatMap(all);
  it("is a statement: no question, no «Erzähl», no pressure", () => {
    for (const b of bodies) {
      expect(b, b).not.toMatch(/\?/);
      expect(b, b).not.toMatch(/Erzähl|vergiss nicht|du musst|du solltest|vermiss|Wie geht|Wie war/i);
      expect(b, b).toMatch(/[.…]$/);
    }
  });
  it("is Swiss High German (ss, never ß) and short", () => {
    for (const b of bodies) {
      expect(b, b).not.toMatch(/ß/);
      expect(b.length, b).toBeLessThanOrEqual(120);
    }
  });
  it("has its own template id and keeps no text in it", () => {
    for (const g of facts) {
      const ids = g.flat().map((c) => c.template);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9.]{1,40}$/);
    }
  });
  it("the settings text explains the pause and the skips, without a question or ß", () => {
    expect(NOTIFY_RULES).toMatch(/zwei Wochen/);
    // the evening also stays out after a bare open this evening (skipReason «this_evening»)
    expect(NOTIFY_RULES).toMatch(/am Abend schon in der App warst/);
    expect(NOTIFY_RULES).toMatch(/kurz vorher mit dem Coach gesprochen/);
    expect(NOTIFY_RULES).toMatch(/Einstellungen bleiben/);
    expect(NOTIFY_RULES).not.toMatch(/[?ß]/);
  });
  it("keeps the stable greeting as the title", () => {
    expect(pushTitle("morning", "Marius")).toBe("Guten Morgen, Marius");
    expect(pushTitle("evening", null)).toBe("Guten Abend");
    expect(pushTitle("evening", "  ")).toBe("Guten Abend");
  });
});

describe("rotation: no identical body within 7 days", () => {
  /** runs the slot for `days` days with the same facts, keeping a log like the Edge Function */
  function run(slot: Slot, days: number, groupsFor: (day: string) => Candidate[][], start = MON) {
    const log: SentBefore[] = [];
    const sent: { day: string; template: string; body: string }[] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(start, i);
      const c = chooseBody(groupsFor(day), log, day, slot);
      expect(c, day).not.toBeNull();
      log.push({ day, slot, status: "sent", template: c!.template, fingerprint: fingerprint(c!.body) });
      sent.push({ day, template: c!.template, body: c!.body });
    }
    return sent;
  }
  const noRepeatWithin7 = (sent: { day: string; body: string }[]) => {
    for (let i = 0; i < sent.length; i++) for (let j = i + 1; j < sent.length && j - i < 7; j++) expect(sent[j].body, `${sent[i].day} / ${sent[j].day}`).not.toBe(sent[i].body);
  };

  it("an empty calendar every day for a month", () => {
    const sent = run("morning", 30, (day) => morning({}, `${day}T07:30:00`));
    noRepeatWithin7(sent);
    expect(new Set(sent.slice(0, 7).map((s) => s.template)).size).toBe(7);
  });
  it("the same entry every day: the templates rotate and stay with the data", () => {
    const sent = run("morning", 21, (day) => morning({ events: [ev(`${day}T08:00:00`, "Arbeit")] }, `${day}T07:30:00`));
    noRepeatWithin7(sent);
    expect(sent.every((s) => s.body.includes("08:00"))).toBe(true);
    expect(sent.slice(0, 5).map((s) => s.template)).toEqual(["m.day.1", "m.day.2", "m.day.3", "m.day.4", "m.day.5"]);
  });
  it("the same small win every evening: named every evening, never the same line within 7 days", () => {
    const cases: [Partial<EveningFacts>, RegExp][] = [
      [{ habits: [{ title: "Lesen" }] }, /Lesen|Gewohnheit/],
      [{ habits: [{ title: "Lesen" }, { title: "Meditieren" }] }, /Lesen und Meditieren|Gewohnheiten/],
      [{ habits: [{ title: "A" }, { title: "B" }, { title: "C" }] }, /drei Gewohnheiten/i],
      [{ goalTime: [{ goal_id: "g-jp", minutes: 30, source: "person" }] }, /30 Minuten für (Japanisch lernen|dein Ziel)/],
      [{ goalTime: [{ goal_id: "g-weight", minutes: 30, source: "person" }] }, /30 Minuten für dein Ziel/],
    ];
    for (const [f, win] of cases) {
      const sent = run("evening", 21, (day) => evening(f, `${day}T21:00:00`));
      noRepeatWithin7(sent);
      for (const s of sent) expect(s.body, `${s.day} ${s.template}`).toMatch(win);
    }
  });
  it("evenings without a win", () => {
    noRepeatWithin7(run("evening", 30, (day) => evening({}, `${day}T21:00:00`)));
  });
  it("falls back to the next group when a body was already sent", () => {
    const g = morning({ dueSteps: [{ title: "Kapitel 2", goal_id: "g-jp" }] });
    const log: SentBefore[] = g[0].map((c, i) => ({ day: addDays(MON, -1 - i), slot: "morning", status: "sent", template: c.template, fingerprint: fingerprint(c.body) }));
    expect(chooseBody(g, log, MON, "morning")?.template).toMatch(/^m\.plain\./);
  });
  it("forgets what was sent 7 or more days ago, and ignores skipped days", () => {
    const g = morning({});
    const old: SentBefore[] = [{ day: addDays(MON, -7), slot: "morning", status: "sent", template: g[0][0].template, fingerprint: fingerprint(g[0][0].body) }];
    expect(chooseBody(g, old, MON, "morning")?.body).toBe(g[0][0].body);
    const skipped: SentBefore[] = [{ day: addDays(MON, -1), slot: "morning", status: "skipped", template: null, fingerprint: null }];
    expect(chooseBody(g, skipped, MON, "morning")?.body).toBe(g[0][0].body);
  });
  it("prefers the template used longest ago once all were used", () => {
    const g: Candidate[][] = [
      [
        { template: "a", body: "Eins neu." },
        { template: "b", body: "Zwei neu." },
      ],
    ];
    const log: SentBefore[] = [
      { day: addDays(MON, -1), slot: "morning", status: "sent", template: "a", fingerprint: fingerprint("Eins alt.") },
      { day: addDays(MON, -3), slot: "morning", status: "sent", template: "b", fingerprint: fingerprint("Zwei alt.") },
    ];
    expect(chooseBody(g, log, MON, "morning")?.template).toBe("b");
  });
  it("returns null only when every line was sent", () => {
    const g: Candidate[][] = [[{ template: "a", body: "Eins." }]];
    expect(chooseBody(g, [{ day: MON, slot: "evening", status: "sent", template: "x", fingerprint: fingerprint("eins.") }], MON, "morning")).toBeNull();
  });
  it("fingerprints ignore case and spacing and are 8 hex digits", () => {
    expect(fingerprint("Heute: 10:15  Vorlesung.")).toBe(fingerprint("heute: 10:15 vorlesung."));
    expect(fingerprint("Heute: 10:15 Vorlesung.")).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint("A")).not.toBe(fingerprint("B"));
  });
});
