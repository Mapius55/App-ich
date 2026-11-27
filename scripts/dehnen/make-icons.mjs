// Draws the Kehrwasser icon and renders every size the app needs into dehnen/public/.
// The drawing lives here (one source): a line that runs through two slalom gate poles and curls into the eddy.
// Usage: node scripts/dehnen/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../dehnen/public");

const BG = "#061214";
const ACCENT = "#5fd4c4";
const POLE = "#eaf4f2";
const WARM = "#ffc857";

const f = (n) => Number(n.toFixed(1));

/** The line of the boat: down through the gate, then winding anticlockwise into the eddy. */
function eddyPath() {
  const cx = 288;
  const cy = 336;
  const rOuter = 112;
  const rInner = 36;
  const turns = 1.3;
  const steps = 120;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // starts at the left edge of the eddy, heading down
    const phi = Math.PI - t * turns * 2 * Math.PI;
    const r = rOuter - (rOuter - rInner) * Math.pow(t, 0.95);
    pts.push([cx + r * Math.cos(phi), cy + r * Math.sin(phi)]);
  }
  const start = pts[0];
  const dir = [pts[1][0] - start[0], pts[1][1] - start[1]];
  const len = Math.hypot(dir[0], dir[1]);
  const u = [dir[0] / len, dir[1] / len];
  // the current: from the top, between the poles, into the first point of the spiral without a kink
  let d = `M${f(start[0] + 14)} 56C${f(start[0] + 14)} 150 ${f(start[0] - u[0] * 96)} ${f(start[1] - u[1] * 96)} ${f(start[0])} ${f(start[1])}`;
  // Catmull-Rom to cubic Bézier, for a smooth line with few numbers
  const k = 5;
  for (let i = 0; i < pts.length - 1; i += k) {
    const p0 = pts[Math.max(0, i - k)];
    const p1 = pts[i];
    const p2 = pts[Math.min(pts.length - 1, i + k)];
    const p3 = pts[Math.min(pts.length - 1, i + 2 * k)];
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3;
    const c1 = i === 0 ? [p1[0] + u[0] * seg, p1[1] + u[1] * seg] : [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** The artwork on a 512 x 512 field, without background. */
function art() {
  return [
    `<path d="${eddyPath()}" fill="none" stroke="${ACCENT}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>`,
    // the gate: two poles hanging over the water, left and right of the line
    `<path d="M112 56V184M262 56V184" fill="none" stroke="${POLE}" stroke-width="14" stroke-linecap="round"/>`,
    `<path d="M112 140V184M262 140V184" fill="none" stroke="${WARM}" stroke-width="14" stroke-linecap="round"/>`,
  ].join("");
}

/** @param {{ radius?: number, scale?: number }} o */
function svg({ radius = 0, scale = 1 } = {}) {
  const t = scale === 1 ? "" : ` transform="translate(${f(256 * (1 - scale))} ${f(256 * (1 - scale))}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${BG}"/><g${t}>${art()}</g></svg>\n`;
}

mkdirSync(out, { recursive: true });
// the favicon carries its own rounded corners; the app icons are full bleed (the system masks them)
writeFileSync(resolve(out, "icon.svg"), svg({ radius: 112 }));

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();

/** @param {string} file @param {number} size @param {string} markup */
async function render(file, size, markup) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:${BG}}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
  await page.screenshot({ path: resolve(out, file), clip: { x: 0, y: 0, width: size, height: size } });
  console.log(file, size);
}

await render("icon-192.png", 192, svg());
await render("icon-512.png", 512, svg());
// maskable: everything inside the safe circle (80 % of the width), so a round mask never cuts the eddy
await render("icon-maskable-512.png", 512, svg({ scale: 0.74 }));
await render("apple-touch-icon.png", 180, svg());

await browser.close();
