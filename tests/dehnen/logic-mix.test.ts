import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, REGIONS } from "../../dehnen/src/types.ts";
import type { ExerciseText, HistoryEntry, Position, Region, RoutineItem, Settings } from "../../dehnen/src/types.ts";
import { MAX_OVER, REGION_SHORT, TITLE_WHOLE_BODY, mix, mixSeed } from "../../dehnen/src/logic/mix.ts";
import type { MixOptions } from "../../dehnen/src/logic/mix.ts";
import { exerciseSeconds, planSeconds } from "../../dehnen/src/logic/plan.ts";

function ex(id: string, over: Partial<ExerciseText> = {}): ExerciseText {
  return {
    id,
    name: id,
    family: id,
    variant: null,
    kind: "statisch",
    position: "stehend",
    regions: ["huefte_seitlich"],
    equipment: [],
    unilateral: false,
    level: 1,
    seconds: 30,
    tags: [],
    intro: "",
    steps: [],
    cues: [],
    avoid: "",
    feel: "",
    slalom: "",
    motion: "",
    ...over,
  };
}

const POSITIONS: Position[] = ["stehend", "kniend", "sitzend", "rueckenlage", "vierfuessler", "seitlage", "bauchlage", "hocke"];
const LEVEL: Record<Position, number> = { stehend: 0, kniend: 1, vierfuessler: 1, hocke: 1, sitzend: 2, seitlage: 3, bauchlage: 3, rueckenlage: 3 };

/** 13 regions x 8 exercises: half of them mobilising, half unilateral, all positions, every exercise its own family */
function makePool(): ExerciseText[] {
  const list: ExerciseText[] = [];
  REGIONS.forEach((region, r) => {
    for (let i = 0; i < 8; i++) {
      list.push(
        ex(`${region}-${i}`, {
          regions: [region],
          kind: i === 5 ? "aktiv" : i % 3 === 0 ? "dynamisch" : "statisch",
          position: POSITIONS[(r + i) % POSITIONS.length],
          unilateral: i % 2 === 0,
          seconds: 30 + (i % 4) * 10,
          level: ((i % 3) + 1) as 1 | 2 | 3,
        }),
      );
    }
  });
  return list;
}

const POOL = makePool();
const byId = new Map(POOL.map((e) => [e.id, e]));
const lookup = (id: string): ExerciseText | undefined => byId.get(id);
const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
const DAY = "2026-11-26";
const opts = (over: Partial<MixOptions> = {}): MixOptions => ({ minutes: 15, settings: settings(), exercises: POOL, seed: mixSeed(DAY, 0), ...over });
const picked = (items: RoutineItem[], find: (id: string) => ExerciseText | undefined = lookup): ExerciseText[] => items.map((i) => find(i.exercise)!);
const seeds = (count: number): string[] => Array.from({ length: count }, (_, i) => mixSeed(DAY, i));

function shareOf(list: ExerciseText[], s: Settings, test: (e: ExerciseText) => boolean): number {
  let all = 0;
  let part = 0;
  for (const e of list) {
    const t = exerciseSeconds(e, { exercise: e.id }, s);
    all += t;
    if (test(e)) part += t;
  }
  return all > 0 ? part / all : 0;
}

describe("mixSeed", () => {
  it("is stable per day and number", () => {
    expect(mixSeed("2026-11-26", 0)).toBe("2026-11-26#0");
    expect(mixSeed("2026-11-26", 3)).toBe(mixSeed("2026-11-26", 3));
    expect(mixSeed("2026-11-26", 1)).not.toBe(mixSeed("2026-11-26", 2));
    expect(mixSeed("2026-11-26", 1)).not.toBe(mixSeed("2026-11-27", 1));
  });
});

describe("mix: determinism and variety", () => {
  it("the same input gives the same session", () => {
    const a = mix(opts());
    const b = mix(opts());
    expect(b).toEqual(a);
    expect(a.items.length).toBeGreaterThan(3);
  });

  it("does not depend on the order the catalogue is loaded in", () => {
    const a = mix(opts());
    const b = mix(opts({ exercises: [...POOL].reverse() }));
    expect(b).toEqual(a);
  });

  it("a different seed gives a visibly different session", () => {
    const sessions = seeds(12).map((seed) => mix(opts({ seed })).items.map((i) => i.exercise));
    expect(new Set(sessions.map((s) => s.join(","))).size).toBe(12);
    // and not just the order: two neighbouring seeds share less than half of their exercises
    for (let i = 1; i < sessions.length; i++) {
      const common = sessions[i].filter((id) => sessions[i - 1].includes(id)).length;
      expect(common).toBeLessThan(Math.min(sessions[i].length, sessions[i - 1].length) / 2);
    }
  });

  it("items are plain routine items of known exercises, each only once", () => {
    const r = mix(opts());
    for (const item of r.items) {
      expect(Object.keys(item)).toEqual(["exercise"]);
      expect(byId.has(item.exercise)).toBe(true);
    }
    expect(new Set(r.items.map((i) => i.exercise)).size).toBe(r.items.length);
  });
});

describe("mix: fills the time", () => {
  const longest = (s: Settings): number => Math.max(...POOL.map((e) => exerciseSeconds(e, { exercise: e.id }, s))) + s.transitionSeconds;

  it("within about one exercise of the wished minutes and never more than 10 % over", () => {
    const variants = [settings(), settings({ holdSeconds: 60, moveSeconds: 30 }), settings({ uniform: false }), settings({ holdSeconds: 30, moveSeconds: 30, transitionSeconds: 12, switchSeconds: 4 })];
    for (const s of variants) {
      for (const minutes of [3, 5, 8, 10, 12, 15, 20, 30, 45]) {
        for (const seed of seeds(10)) {
          const r = mix(opts({ minutes, settings: s, seed }));
          const total = planSeconds(r.items, s, lookup);
          const target = minutes * 60;
          expect(total).toBeLessThanOrEqual(target * MAX_OVER);
          expect(total).toBeGreaterThanOrEqual(target - longest(s));
        }
      }
    }
  });

  it("usually lands close: on average within 20 seconds at 15 minutes", () => {
    const s = settings();
    const off = seeds(40).map((seed) => Math.abs(planSeconds(mix(opts({ seed })).items, s, lookup) - 900));
    expect(off.reduce((a, b) => a + b, 0) / off.length).toBeLessThan(20);
  });

  it("a wish shorter than any exercise still gives one exercise, the shortest", () => {
    const s = settings({ holdSeconds: 120, moveSeconds: 120 });
    const r = mix(opts({ minutes: 1, settings: s }));
    expect(r.items).toHaveLength(1);
    expect(picked(r.items)[0].unilateral).toBe(false);
  });

  it("no time or no exercises gives an empty session", () => {
    expect(mix(opts({ minutes: 0 })).items).toEqual([]);
    expect(mix(opts({ exercises: [] }))).toEqual({ title: TITLE_WHOLE_BODY, items: [], regions: [] });
    expect(mix(opts({ minutes: Number.NaN })).items).toEqual([]);
  });

  it("a small catalogue is used up without repeating anything", () => {
    const few = POOL.slice(0, 5);
    const r = mix(opts({ minutes: 60, exercises: few }));
    expect(r.items.map((i) => i.exercise).sort()).toEqual(few.map((e) => e.id).sort());
  });
});

describe("mix: filters", () => {
  it("at most one exercise per variation family", () => {
    // every region has 4 families with 2 variations each
    const families = POOL.map((e, i) => ({ ...e, family: `${e.regions[0]}-f${Math.floor((i % 8) / 2)}`, variant: i % 2 === 0 ? null : "Variante" }));
    const find = (id: string): ExerciseText | undefined => families.find((e) => e.id === id);
    for (const minutes of [10, 30, 60]) {
      for (const seed of seeds(8)) {
        const r = mix(opts({ minutes, exercises: families, seed }));
        const used = picked(r.items, find).map((e) => e.family);
        expect(new Set(used).size).toBe(used.length);
      }
    }
    // an hour needs more than there are families: every family once, then it stops
    const all = mix(opts({ minutes: 120, exercises: families }));
    expect(all.items).toHaveLength(52);
  });

  it("only exercises whose equipment is at hand", () => {
    const withGear = POOL.map((e, i) => (i % 3 === 0 ? { ...e, equipment: ["rolle" as const] } : i % 3 === 1 ? { ...e, equipment: ["wand" as const, "band" as const] } : { ...e, equipment: ["wand" as const] }));
    const find = (id: string): ExerciseText | undefined => withGear.find((e) => e.id === id);
    let sawWall = false;
    for (const seed of seeds(10)) {
      const r = mix(opts({ minutes: 20, exercises: withGear, seed }));
      expect(r.items.length).toBeGreaterThan(0);
      for (const e of picked(r.items, find)) {
        expect(e.equipment).toEqual(["wand"]);
        sawWall = true;
      }
    }
    expect(sawWall).toBe(true);
    // with the roll at hand, exercises with it appear
    const more = seeds(10).flatMap((seed) => picked(mix(opts({ minutes: 20, exercises: withGear, seed, settings: settings({ equipment: ["wand", "rolle"] }) })).items, find));
    expect(more.some((e) => e.equipment.includes("rolle"))).toBe(true);
    expect(more.some((e) => e.equipment.includes("band"))).toBe(false);
    // nothing at hand: nothing that needs anything
    expect(mix(opts({ exercises: withGear, settings: settings({ equipment: [] }) })).items).toEqual([]);
  });

  it("nothing above the highest level", () => {
    for (const maxLevel of [1, 2] as const) {
      for (const seed of seeds(10)) {
        const r = mix(opts({ minutes: 20, seed, settings: settings({ maxLevel }) }));
        expect(r.items.length).toBeGreaterThan(0);
        for (const e of picked(r.items)) expect(e.level).toBeLessThanOrEqual(maxLevel);
      }
    }
    const all = seeds(10).flatMap((seed) => picked(mix(opts({ minutes: 20, seed })).items));
    expect(all.some((e) => e.level === 3)).toBe(true);
  });

  it("hidden exercises never appear", () => {
    const hidden = POOL.filter((e) => e.regions[0] === "huefte_seitlich" || e.id.endsWith("-1")).map((e) => e.id);
    for (const seed of seeds(10)) {
      const r = mix(opts({ minutes: 20, seed, hidden }));
      for (const item of r.items) expect(hidden).not.toContain(item.exercise);
    }
  });

  it("only the wanted kinds", () => {
    for (const seed of seeds(6)) {
      const holds = picked(mix(opts({ seed, kinds: ["statisch"] })).items);
      expect(holds.length).toBeGreaterThan(0);
      expect(holds.every((e) => e.kind === "statisch")).toBe(true);
      const moves = picked(mix(opts({ seed, kinds: ["dynamisch", "aktiv"] })).items);
      expect(moves.length).toBeGreaterThan(0);
      expect(moves.every((e) => e.kind !== "statisch")).toBe(true);
    }
    // an empty list means mixed
    expect(mix(opts({ kinds: [] }))).toEqual(mix(opts()));
  });
});

describe("mix: kinds and order", () => {
  it("mixed by default: starts mobilising, ends holding, never back", () => {
    for (const minutes of [5, 10, 20, 30]) {
      for (const seed of seeds(10)) {
        const list = picked(mix(opts({ minutes, seed })).items);
        const kinds = list.map((e) => (e.kind === "statisch" ? "hold" : "move"));
        expect(kinds[0]).toBe("move");
        expect(kinds[kinds.length - 1]).toBe("hold");
        const firstHold = kinds.indexOf("hold");
        expect(kinds.slice(firstHold).every((k) => k === "hold")).toBe(true);
      }
    }
  });

  it("mobilising takes a good third of a mixed session", () => {
    const s = settings();
    const shares = seeds(20).map((seed) => shareOf(picked(mix(opts({ minutes: 20, seed })).items), s, (e) => e.kind !== "statisch"));
    for (const share of shares) {
      expect(share).toBeGreaterThan(0.2);
      expect(share).toBeLessThan(0.6);
    }
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    expect(mean).toBeGreaterThan(0.32);
    expect(mean).toBeLessThan(0.48);
  });

  it("no needless changes of position: each part is grouped, the holds go from standing down to lying", () => {
    for (const minutes of [10, 20, 40]) {
      for (const seed of seeds(10)) {
        const list = picked(mix(opts({ minutes, seed })).items);
        const moves = list.filter((e) => e.kind !== "statisch");
        const holds = list.filter((e) => e.kind === "statisch");
        for (const part of [moves, holds]) {
          // every position appears as one block
          const blocks = part.map((e) => e.position).filter((p, i, all) => i === 0 || all[i - 1] !== p);
          expect(new Set(blocks).size).toBe(blocks.length);
        }
        const holdLevels = holds.map((e) => LEVEL[e.position]);
        expect(holdLevels).toEqual([...holdLevels].sort((a, b) => a - b));
        // the mobilising part runs in one direction too, down or up
        const moveLevels = moves.map((e) => LEVEL[e.position]);
        const down = [...moveLevels].sort((a, b) => a - b);
        const up = [...down].reverse();
        expect([down.join(), up.join()]).toContain(moveLevels.join());
        // and it meets the first hold on the shorter way
        const jump = Math.abs(moveLevels[moveLevels.length - 1] - holdLevels[0]);
        const other = Math.abs(moveLevels[0] - holdLevels[0]);
        expect(jump).toBeLessThanOrEqual(other);
      }
    }
  });

  it("a session of one kind simply goes from standing down to lying", () => {
    for (const seed of seeds(10)) {
      const list = picked(mix(opts({ minutes: 20, seed, kinds: ["statisch"] })).items);
      const order = list.map((e) => ["stehend", "kniend", "vierfuessler", "hocke", "sitzend", "seitlage", "bauchlage", "rueckenlage"].indexOf(e.position));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });
});

describe("mix: regions", () => {
  const focusShare = (r: { items: RoutineItem[] }, s: Settings, focus: Region[]): number => shareOf(picked(r.items), s, (e) => focus.includes(e.regions[0]));

  it("the focus regions get roughly half of the time", () => {
    const s = settings();
    for (const minutes of [10, 15, 20, 30]) {
      const shares = seeds(20).map((seed) => focusShare(mix(opts({ minutes, seed })), s, s.focus));
      for (const share of shares) {
        expect(share).toBeGreaterThanOrEqual(0.35);
        expect(share).toBeLessThanOrEqual(0.7);
      }
      const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
      expect(mean).toBeGreaterThan(0.44);
      expect(mean).toBeLessThan(0.6);
    }
  });

  it("a focus given for this session replaces the one from the settings", () => {
    const s = settings();
    const shares = seeds(20).map((seed) => focusShare(mix(opts({ minutes: 20, seed, focus: ["nacken", "brust"] })), s, ["nacken", "brust"]));
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    expect(mean).toBeGreaterThan(0.44);
    expect(mean).toBeLessThan(0.6);
    const old = seeds(20).map((seed) => focusShare(mix(opts({ minutes: 20, seed, focus: ["nacken", "brust"] })), s, s.focus));
    expect(old.reduce((a, b) => a + b, 0) / old.length).toBeLessThan(0.25);
  });

  it("the share can be turned up to only the focus", () => {
    for (const seed of seeds(10)) {
      const list = picked(mix(opts({ minutes: 12, seed, focus: ["schulter_lat", "bws_rotation"], focusShare: 1 })).items);
      expect(list.length).toBeGreaterThan(3);
      expect(list.every((e) => e.regions[0] === "schulter_lat" || e.regions[0] === "bws_rotation")).toBe(true);
    }
  });

  it("the rest spreads over the other regions", () => {
    const s = settings();
    for (const seed of seeds(10)) {
      const list = picked(mix(opts({ minutes: 30, seed })).items);
      const others = list.map((e) => e.regions[0]).filter((r) => !s.focus.includes(r));
      // 30 minutes hold about 9 exercises outside the focus: at least 6 different regions
      expect(new Set(others).size).toBeGreaterThanOrEqual(6);
    }
  });

  it("without a focus the whole body gets its turn", () => {
    for (const seed of seeds(10)) {
      const r = mix(opts({ minutes: 30, seed, focus: [] }));
      expect(new Set(picked(r.items).map((e) => e.regions[0])).size).toBeGreaterThanOrEqual(10);
      expect(r.title).toBe(TITLE_WHOLE_BODY);
    }
  });

  it("regions that got little time in the last 14 days come first", () => {
    const entry = (day: string, regions: Partial<Record<Region, number>>): HistoryEntry => ({ id: day, at: `${day}T18:00:00.000Z`, day, source: "mix", title: "x", seconds: 900, completed: true, exercises: [], regions });
    // a lot of chest and neck lately, nothing for calves and forearms
    const history = ["2026-11-20", "2026-11-22", "2026-11-24", "2026-11-25"].map((day) => entry(day, { brust: 400, nacken: 400, huefte_seitlich: 300 }));
    const count = (h: HistoryEntry[] | undefined, regions: Region[]): number =>
      seeds(60)
        .flatMap((seed) => picked(mix(opts({ minutes: 15, seed, history: h })).items))
        .filter((e) => regions.includes(e.regions[0])).length;
    const fed: Region[] = ["brust", "nacken"];
    const hungry: Region[] = ["waden_sprunggelenk", "unterarm_handgelenk"];
    expect(count(history, fed)).toBeLessThan(count(undefined, fed) * 0.75);
    expect(count(history, hungry)).toBeGreaterThan(count(history, fed) * 1.5);
    expect(count(history, hungry)).toBeGreaterThan(count(undefined, hungry));
  });

  it("history older than 14 days does not count", () => {
    const old: HistoryEntry[] = [{ id: "a", at: "2026-11-12T18:00:00.000Z", day: "2026-11-12", source: "mix", title: "x", seconds: 900, completed: true, exercises: [{ id: "brust-1", seconds: 90 }], regions: { brust: 900 } }];
    for (const seed of seeds(5)) {
      expect(mix(opts({ seed, history: old }))).toEqual(mix(opts({ seed })));
    }
    // 13 days back still counts (today is taken from the seed, or given)
    const recent = old.map((h) => ({ ...h, day: "2026-11-13" }));
    const changed = seeds(20).filter((seed) => JSON.stringify(mix(opts({ seed, history: recent }))) !== JSON.stringify(mix(opts({ seed }))));
    expect(changed.length).toBeGreaterThan(0);
    const later = seeds(5).map((seed) => mix(opts({ seed, history: recent, today: "2026-11-27" })));
    expect(later).toEqual(seeds(5).map((seed) => mix(opts({ seed }))));
  });

  it("exercises done lately make room for others", () => {
    const done = POOL.filter((e) => e.id.endsWith("-1") || e.id.endsWith("-2")).map((e) => ({ id: e.id, seconds: 45 }));
    const history: HistoryEntry[] = ["2026-11-23", "2026-11-24", "2026-11-25"].map((day) => ({ id: day, at: `${day}T18:00:00.000Z`, day, source: "mix", title: "x", seconds: 900, completed: true, exercises: done, regions: {} }));
    const count = (h?: HistoryEntry[]): number =>
      seeds(60)
        .flatMap((seed) => mix(opts({ seed, history: h, kinds: ["statisch"] })).items)
        .filter((i) => i.exercise.endsWith("-1") || i.exercise.endsWith("-2")).length;
    expect(count(history)).toBeLessThan(count() * 0.75);
  });
});

describe("mix: boat and favourites", () => {
  // two twins in one region: a single pick per session, so the weights show directly
  const twins = (tagged: Partial<ExerciseText>): ExerciseText[] => [ex("zwilling-a", tagged), ex("zwilling-b")];
  const firstPicks = (over: Partial<MixOptions>, count = 400): string[] => seeds(count).map((seed) => mix(opts({ minutes: 1, seed, ...over })).items[0].exercise);
  const part = (list: string[], id: string): number => list.filter((x) => x === id).length / list.length;

  it("one minute holds exactly one of the twins, evenly without a reason to prefer one", () => {
    const picks = firstPicks({ exercises: twins({}) });
    expect(part(picks, "zwilling-a")).toBeGreaterThan(0.44);
    expect(part(picks, "zwilling-a")).toBeLessThan(0.56);
    expect(mix(opts({ minutes: 1, exercises: twins({}) })).items).toHaveLength(1);
  });

  it("exercises for the own boat get a bonus", () => {
    const k1 = part(firstPicks({ exercises: twins({ tags: ["k1"] }), settings: settings({ discipline: "k1" }) }), "zwilling-a");
    expect(k1).toBeGreaterThan(0.56);
    expect(k1).toBeLessThan(0.68);
    const c1 = part(firstPicks({ exercises: twins({ tags: ["c1"] }), settings: settings({ discipline: "c1" }) }), "zwilling-a");
    expect(c1).toBeGreaterThan(0.56);
    const both = part(firstPicks({ exercises: twins({ tags: ["c1"] }), settings: settings({ discipline: "beide" }) }), "zwilling-a");
    expect(both).toBeGreaterThan(0.56);
    const shared = part(firstPicks({ exercises: twins({ tags: ["k1", "c1"] }), settings: settings({ discipline: "c1" }) }), "zwilling-a");
    expect(shared).toBeGreaterThan(0.56);
  });

  it("exercises only for the other boat are avoided while there is anything else", () => {
    const picks = firstPicks({ exercises: twins({ tags: ["c1"] }), settings: settings({ discipline: "k1" }) });
    expect(part(picks, "zwilling-a")).toBe(0);
    // in a full catalogue too
    const tagged = POOL.map((e, i) => (i % 4 === 0 ? { ...e, tags: ["c1" as const] } : e));
    const find = (id: string): ExerciseText | undefined => tagged.find((e) => e.id === id);
    for (const seed of seeds(15)) {
      const list = picked(mix(opts({ minutes: 30, seed, exercises: tagged, settings: settings({ discipline: "k1" }) })).items, find);
      expect(list.some((e) => e.tags.includes("c1"))).toBe(false);
    }
    // but they are better than nothing
    const only = mix(opts({ minutes: 1, exercises: [ex("nur-c1", { tags: ["c1"] })], settings: settings({ discipline: "k1" }) }));
    expect(only.items).toEqual([{ exercise: "nur-c1" }]);
  });

  it("favourites get a small bonus", () => {
    const p = part(firstPicks({ exercises: twins({}), favorites: ["zwilling-a"] }, 600), "zwilling-a");
    expect(p).toBeGreaterThan(0.52);
    expect(p).toBeLessThan(0.64);
  });
});

describe("mix: title and regions", () => {
  it("regions are the main regions covered, most time first", () => {
    const s = settings();
    for (const seed of seeds(10)) {
      const r = mix(opts({ minutes: 20, seed }));
      const time = new Map<Region, number>();
      for (const e of picked(r.items)) time.set(e.regions[0], (time.get(e.regions[0]) ?? 0) + exerciseSeconds(e, { exercise: e.id }, s));
      expect([...r.regions].sort()).toEqual([...time.keys()].sort());
      const seconds = r.regions.map((region) => time.get(region)!);
      expect(seconds).toEqual([...seconds].sort((a, b) => b - a));
    }
  });

  it("the title names the leading focus regions", () => {
    const names = (regions: Region[]): string[] => regions.map((r) => REGION_SHORT[r]);
    for (const seed of seeds(10)) {
      const r = mix(opts({ minutes: 15, seed, focus: ["huefte_seitlich", "lws_ql"] }));
      expect(["Seitliche Hüfte und Flanke", "Flanke und Seitliche Hüfte"]).toContain(r.title);
      const three = mix(opts({ minutes: 15, seed }));
      const parts = three.title.split(" und ");
      expect(parts).toHaveLength(2);
      for (const p of parts) expect(names(DEFAULT_SETTINGS.focus)).toContain(p);
    }
    const one = mix(opts({ minutes: 15, focus: ["schulter_lat"] }));
    expect(one.title).toBe("Schultern");
    expect(one.regions[0]).toBe("schulter_lat");
  });

  it("a catalogue of one region is named after it", () => {
    const hips = POOL.filter((e) => e.regions[0] === "adduktoren");
    const r = mix(opts({ minutes: 5, exercises: hips, focus: [] }));
    expect(r.title).toBe("Adduktoren");
    expect(r.regions).toEqual(["adduktoren"]);
    const two = mix(opts({ minutes: 8, exercises: POOL.filter((e) => e.regions[0] === "adduktoren" || e.regions[0] === "hamstrings"), focus: [] }));
    expect(["Adduktoren und Beinrückseite", "Beinrückseite und Adduktoren"]).toContain(two.title);
  });

  it("titles are Swiss German without sharp s, dashes or exclamation marks", () => {
    const titles = [...Object.values(REGION_SHORT), TITLE_WHOLE_BODY, ...seeds(20).map((seed) => mix(opts({ seed })).title)];
    for (const t of titles) {
      expect(t).not.toMatch(/[ß–—!]/);
      expect(t.length).toBeLessThanOrEqual(36);
    }
  });
});
