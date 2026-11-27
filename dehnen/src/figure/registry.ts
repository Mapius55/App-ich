// All animations by exercise id, from data/anim/*.ts (each file exports `anims`).
import type { Anim, AnimSet } from "./pose.ts";
import { stage, type Stage } from "./render.ts";
import { mirrorAnim } from "./solve.ts";

const files = import.meta.glob<{ anims?: AnimSet }>("../data/anim/*.ts", { eager: true });

const ANIMS = new Map<string, Anim>();
for (const mod of Object.values(files)) {
  if (!mod.anims) continue;
  for (const [id, anim] of Object.entries(mod.anims)) if (anim?.frames?.length) ANIMS.set(id, anim);
}

export function hasAnim(id: string): boolean {
  return ANIMS.has(id);
}

export function animIds(): string[] {
  return [...ANIMS.keys()];
}

export function animOf(id: string): Anim | undefined {
  return ANIMS.get(id);
}

const stages = new Map<string, Stage | null>();

/** The prepared animation of an exercise ("R" = mirrored for the right side), or null if there is none or it is broken. */
export function stageOf(id: string, side: "L" | "R" | null | undefined): Stage | null {
  const key = `${id}|${side === "R" ? "R" : "L"}`;
  const hit = stages.get(key);
  if (hit !== undefined) return hit;
  const anim = ANIMS.get(id);
  let st: Stage | null = null;
  if (anim) {
    try {
      st = stage(side === "R" ? mirrorAnim(anim) : anim);
    } catch {
      st = null;
    }
  }
  stages.set(key, st);
  return st;
}
