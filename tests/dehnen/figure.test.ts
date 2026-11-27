import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BASES } from "../../dehnen/src/figure/bases.ts";
import { checkAnim, checkBody } from "../../dehnen/src/figure/check.ts";
import type { JointName } from "../../dehnen/src/figure/pose.ts";
import { animIds, animOf, stageOf } from "../../dehnen/src/figure/registry.ts";
import { fitStage, frame, svg, viewOf } from "../../dehnen/src/figure/render.ts";
import { mirrorAnim, mirrorPose, sample, solvePose, timeline } from "../../dehnen/src/figure/solve.ts";

const root = resolve(__dirname, "../..");
const textDir = join(root, "dehnen/src/data/text");
const texts: { id: string; kind: string; tempo?: number }[] = readdirSync(textDir)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => JSON.parse(readFileSync(join(textDir, f), "utf8")));
const textIds = new Set(texts.map((t) => t.id));

describe("Grundhaltungen", () => {
  for (const [name, pose] of Object.entries(BASES)) {
    it(`${name} steht sauber auf dem Boden`, () => {
      const sk = solvePose(pose, name === "chairSit" ? [{ type: "box", at: [0, -0.04], size: [0.46, 0.43, 0.44] }] : []);
      for (const p of Object.values(sk.p)) for (const n of p) expect(Number.isFinite(n)).toBe(true);
      const hard = checkBody(sk, []).filter((f) => /not a number|inside the floor|floats/.test(f.text));
      if (name !== "chairSit") expect(hard).toEqual([]);
    });
  }

  it("gespiegelt ist jede Haltung das Spiegelbild", () => {
    for (const pose of Object.values(BASES)) {
      const a = solvePose(pose);
      const b = solvePose(mirrorPose(pose));
      for (const j of Object.keys(a.p) as JointName[]) {
        const m = (j.endsWith("L") ? `${j.slice(0, -1)}R` : j.endsWith("R") ? `${j.slice(0, -1)}L` : j) as JointName;
        expect(b.p[m][0]).toBeCloseTo(-a.p[j][0], 5);
        expect(b.p[m][1]).toBeCloseTo(a.p[j][1], 5);
        expect(b.p[m][2]).toBeCloseTo(a.p[j][2], 5);
      }
    }
  });
});

describe("Animationen", () => {
  const ids = animIds();

  it("es gibt Animationen, und jede gehört zu einer Übung", () => {
    expect(ids.length).toBeGreaterThan(4);
    expect(ids.filter((id) => !textIds.has(id))).toEqual([]);
  });

  it("jede Animation lässt sich lösen, zeichnen und spiegeln", () => {
    const broken: string[] = [];
    for (const id of ids) {
      const anim = animOf(id)!;
      try {
        for (const a of [anim, mirrorAnim(anim)]) {
          const tl = timeline(a);
          expect(tl.total).toBeGreaterThan(0);
          for (let i = 0; i < 12; i++) {
            const { sk } = sample(tl, (i / 12) * tl.total);
            for (const p of Object.values(sk.p)) for (const n of p) if (!Number.isFinite(n)) throw new Error("keine Zahl");
          }
        }
        for (const side of ["L", "R"] as const) {
          const st = stageOf(id, side)!;
          const view = viewOf(st.anim.camera);
          const out = svg(frame(st, st.mainTime, view, fitStage(st, view, 200, 200)), 200, 200, "t");
          if (out.includes("NaN") || out.includes("Infinity")) throw new Error("Zeichnung enthält keine Zahl");
        }
        const hard = checkAnim(anim).filter((w) => /not a number|no frames|no length/.test(w));
        if (hard.length) throw new Error(hard.join("; "));
      } catch (err) {
        broken.push(`${id}: ${(err as Error).message}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("der Körper schwebt nicht und steckt nicht im Boden", () => {
    const bad: string[] = [];
    for (const id of ids) {
      const w = checkAnim(animOf(id)!).filter((t) => /^frame \d+: the body (floats|is \d+ cm inside)/.test(t));
      if (w.length) bad.push(`${id}: ${w[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it("dynamische Übungen laufen im Tempo der Übung", () => {
    const off: string[] = [];
    for (const t of texts) {
      const anim = animOf(t.id);
      if (!anim || t.kind === "statisch" || !t.tempo) continue;
      const total = timeline(anim).total;
      // one round, or a whole number of rounds (left and right in one loop)
      const rounds = total / t.tempo;
      if (Math.abs(rounds - Math.round(rounds)) > 0.15 && Math.abs(1 / rounds - Math.round(1 / rounds)) > 0.15) off.push(`${t.id}: Schleife ${total.toFixed(1)} s, Tempo ${t.tempo} s`);
    }
    expect(off).toEqual([]);
  });
});

describe("Kein Ton", () => {
  it("die App fasst nie die Tonausgabe an (Musik läuft weiter)", () => {
    const forbidden = /new Audio\(|<audio|<video|AudioContext|speechSynthesis|SpeechSynthesisUtterance|mediaSession|getUserMedia|createMediaElement|\.mp3|\.wav|\.ogg/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|css|html)$/.test(f)) {
          const lines = readFileSync(p, "utf8").split("\n");
          lines.forEach((line, i) => {
            if (forbidden.test(line) && !/^\s*(\/\/|\/?\*)/.test(line)) hits.push(`${p}:${i + 1}`);
          });
        }
      }
    };
    walk(join(root, "dehnen/src"));
    try {
      if (forbidden.test(readFileSync(join(root, "dehnen/index.html"), "utf8"))) hits.push("dehnen/index.html");
    } catch {
      // index.html is checked once it exists
    }
    expect(hits).toEqual([]);
  });
});
