// Contact sheet for pose authors: draws every keyframe of an animation from several sides and prints a text check.
//
//   node scripts/dehnen/sheet.ts <group> [id ...] [--side R] [--film] [--out dir]
//   node scripts/dehnen/sheet.ts --bases [name ...]
//
// <group> is a file name in dehnen/src/data/anim/ without ".ts" (or a path to a .ts file that exports `anims`).
// Without ids: every animation of the file. Pictures go to .sheets/<id>.png (or --out).
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAnim, describe } from "../../dehnen/src/figure/check.ts";
import type { Anim } from "../../dehnen/src/figure/pose.ts";
import { fitStage, frame, stage, svg, viewOf, type View } from "../../dehnen/src/figure/render.ts";
import { mirrorAnim } from "../../dehnen/src/figure/solve.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const opt = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const film = flag("--film");
const overview = flag("--overview");
const bases = flag("--bases");
const side = opt("--side") ?? "L";
const outDir = resolve(opt("--out") ?? resolve(root, ".sheets"));

let anims: Record<string, Anim>;
let ids: string[];
if (bases) {
  const mod = await import(pathToFileURL(resolve(root, "dehnen/src/figure/bases.ts")).href);
  anims = Object.fromEntries(Object.entries(mod.BASES).map(([k, pose]) => [k, { frames: [{ pose }], camera: { az: k === "sideLying" ? -60 : 35 }, props: k === "chairSit" ? [mod.CHAIR] : [] } as Anim]));
  ids = argv.length ? argv : Object.keys(anims);
} else {
  const group = argv.shift();
  if (!group) {
    console.error("usage: node scripts/dehnen/sheet.ts <group> [id ...] [--side R] [--film] [--out dir]   |   --bases [name ...]");
    process.exit(2);
  }
  const file = existsSync(group) ? resolve(group) : resolve(root, "dehnen/src/data/anim", `${group}.ts`);
  const mod = await import(pathToFileURL(file).href);
  anims = mod.anims;
  if (!anims) {
    console.error(`${file} has no export "anims"`);
    process.exit(2);
  }
  ids = argv.length ? argv : Object.keys(anims);
}

const CELL = 280;
const VIEWS: { name: string; view: (a: Anim) => View }[] = [
  { name: "camera", view: (a) => viewOf(a.camera) },
  { name: "front (az 0)", view: () => ({ az: 0, el: 6 }) },
  { name: "left side (az 90)", view: () => ({ az: 90, el: 6 }) },
  { name: "top", view: () => ({ az: 0, el: 82 }) },
];

mkdirSync(outDir, { recursive: true });
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
let failed = 0;
const STYLE = `<style>body{margin:0;background:#0b1c20;font:11px system-ui;color:#9db4b3}.r{display:flex;flex-wrap:wrap}.c{position:relative;width:${CELL}px;height:${CELL}px;outline:1px solid #173339}.c.s{width:${CELL / 2}px;height:${CELL / 2}px}.c.o{width:220px;height:220px}.c span{position:absolute;left:6px;top:4px}h1{font-size:13px;margin:6px;color:#eaf4f2}#w{display:inline-block;max-width:1320px}</style>`;

if (overview) {
  // one picture: the main frame of every animation, camera view and a second view
  const cells: string[] = [];
  let n = 0;
  for (const id of ids) {
    const a0 = anims[id];
    if (!a0) continue;
    const anim = side === "R" ? mirrorAnim(a0) : a0;
    try {
      const st = stage(anim);
      const view = viewOf(anim.camera);
      const other = { az: view.az + 90, el: 8 };
      for (const [vn, v] of [["", view], [" +90", other]] as const) {
        const fit = fitStage(st, v, 220, 220);
        cells.push(`<div class="c o"><span>${id}${vn}</span>${svg(frame(st, st.mainTime, v, fit, { spots: true }), 220, 220, `o${n++}`)}</div>`);
      }
      const warn = checkAnim(anim);
      if (warn.length) console.log(`${id}: ${warn.length} warning(s)\n  ${warn.join("\n  ")}`);
    } catch (err) {
      console.log(`${id}: ERROR ${(err as Error).message}`);
      failed++;
    }
  }
  await page.setContent(`${STYLE}<div id="w"><div class="r">${cells.join("")}</div></div>`);
  const file = resolve(outDir, `overview${side === "R" ? "-R" : ""}.png`);
  await (await page.$("#w")).screenshot({ path: file });
  console.log(`picture: ${file}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}

for (const id of ids) {
  let anim = anims[id];
  if (!anim) {
    console.log(`\n=== ${id}: NOT FOUND in this file`);
    failed++;
    continue;
  }
  if (side === "R") anim = mirrorAnim(anim);
  let html = "";
  try {
    const st = stage(anim);
    console.log(`\n=== ${id}${side === "R" ? " (mirrored: right side)" : ""}   ${anim.frames.length} frame(s), loop ${st.tl.total.toFixed(1)} s, camera az ${anim.camera.az} el ${anim.camera.el ?? 12}, main frame ${st.main}`);
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < st.tl.keys.length; i++) {
      times.push(t + st.tl.hold[i] / 2);
      t += st.tl.hold[i] + st.tl.move[(i + 1) % st.tl.keys.length];
    }
    st.tl.keys.forEach((k, i) => {
      console.log(`frame ${i}${i === st.main ? " (main)" : ""}: move ${st.tl.move[i]} s, hold ${st.tl.hold[i]} s`);
      console.log(describe(k.sk, st.tl.props));
    });
    const between = checkAnim(anim).filter((w) => w.startsWith("moving"));
    for (const w of between) console.log(`  WARNING ${w}`);
    const rows = st.tl.keys.map((_, i) => {
      const cells = VIEWS.map((v, vi) => {
        const view = v.view(anim);
        const fit = fitStage(st, view, CELL, CELL);
        return `<div class="c"><span>f${i} ${v.name}</span>${svg(frame(st, times[i], view, fit, { spots: true }), CELL, CELL, `s${i}_${vi}`)}</div>`;
      });
      return `<div class="r">${cells.join("")}</div>`;
    });
    if (film && st.tl.keys.length > 1) {
      const n = 8;
      const view = viewOf(anim.camera);
      const fit = fitStage(st, view, CELL / 2, CELL / 2);
      const cells = Array.from({ length: n }, (_, i) => {
        const tt = (i / n) * st.tl.total;
        return `<div class="c s"><span>${tt.toFixed(1)}s</span>${svg(frame(st, tt, view, fit, { spots: true }), CELL / 2, CELL / 2, `m${i}`)}</div>`;
      });
      rows.push(`<div class="r">${cells.join("")}</div>`);
    }
    html = rows.join("");
  } catch (err) {
    console.log(`=== ${id}: ERROR ${(err as Error).stack}`);
    failed++;
    continue;
  }
  await page.setContent(`${STYLE}<div id="w"><h1>${id}${side === "R" ? " (R)" : ""}</h1>${html}</div>`);
  const el = await page.$("#w");
  const file = resolve(outDir, `${id}${side === "R" ? "-R" : ""}.png`);
  await el.screenshot({ path: file });
  console.log(`picture: ${file}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
