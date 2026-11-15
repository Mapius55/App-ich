// Brand asset generator for "Bucket List": «Bucket» / «List» on two centred lines in Bodoni Moda, on the
// blue brush background (the same background the "I am" logo had).
// 1. Bodoni Moda (OFL) from github.com/google/fonts (ofl/bodonimoda/BodoniModa[opsz,wght].ttf). Keep the
//    font outside the repository; only the outlines below end up in the files.
// 2. python outline.py BodoniModa[opsz,wght].ttf 650 16 --tracking=85 "Bucket" "List" > glyphs.json
//    (needs fontTools). Weight 650, optical size 16 and a little tracking (instead of 500 / 96 for the old
//    one-line logo): sturdier hairlines and letters that stay apart, so both lines remain readable when
//    the icon is small (checked at 60 px).
// 3. node make.cjs glyphs.json <out-dir>   → icon.svg, icon-maskable.svg, wordmark.svg, banner.svg
// 4. node render.cjs '[["icon.svg",512,512,"icon-512.png"],["icon.svg",192,192,"icon-192.png"],
//      ["icon.svg",180,180,"apple-touch-icon.png"],["icon-maskable.svg",512,512,"icon-maskable-512.png"],
//      ["banner.svg",1240,840,"banner.png"]]'   (needs Playwright) → PNGs
//    Check a downscaled render (60 px) before shipping: both lines must stay readable.
// Files: public/icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png;
// brand/icon.svg, wordmark.svg, banner.svg, banner.png.
const fs = require('fs');
const g = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function brush({ base0, base1, light, mid, shade }, id = 'b', w = 1000, h = 1000) {
  return `
  <defs>
    <linearGradient id="${id}-base" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${base0}"/><stop offset=".55" stop-color="${base1}"/><stop offset="1" stop-color="${mid}"/>
    </linearGradient>
    <radialGradient id="${id}-l"><stop offset="0" stop-color="${light}" stop-opacity="1"/><stop offset=".55" stop-color="${light}" stop-opacity=".55"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-m"><stop offset="0" stop-color="${mid}" stop-opacity=".95"/><stop offset="1" stop-color="${mid}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-s"><stop offset="0" stop-color="${shade}" stop-opacity=".95"/><stop offset="1" stop-color="${shade}" stop-opacity="0"/></radialGradient>
    <filter id="${id}-streak" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.0018 0.045" numOctaves="4" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2.2 -0.55" result="a"/>
      <feComposite in="SourceGraphic" in2="a" operator="in" result="c"/>
      <feGaussianBlur in="c" stdDeviation="1.4"/>
    </filter>
    <filter id="${id}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="38"/></filter>
    <filter id="${id}-grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="3"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${id}-base)"/>
  <g transform="rotate(-32 ${w / 2} ${h / 2})">
    <ellipse cx="${w * .72}" cy="${h * .3}" rx="${w * .62}" ry="${h * .2}" fill="url(#${id}-l)" filter="url(#${id}-soft)" opacity=".55"/>
    <ellipse cx="${w * .7}" cy="${h * .28}" rx="${w * .66}" ry="${h * .19}" fill="url(#${id}-l)" filter="url(#${id}-streak)" opacity=".9"/>
    <ellipse cx="${w * .62}" cy="${h * .5}" rx="${w * .6}" ry="${h * .12}" fill="url(#${id}-m)" filter="url(#${id}-streak)" opacity=".7"/>
    <ellipse cx="${w * .82}" cy="${h * .74}" rx="${w * .6}" ry="${h * .17}" fill="url(#${id}-s)" filter="url(#${id}-soft)" opacity=".9"/>
    <ellipse cx="${w * .1}" cy="${h * .62}" rx="${w * .5}" ry="${h * .3}" fill="url(#${id}-s)" filter="url(#${id}-soft)" opacity=".85"/>
  </g>
  <rect width="${w}" height="${h}" filter="url(#${id}-grain)" opacity=".13" style="mix-blend-mode:overlay"/>`;
}

// ---------- the two-line wordmark ----------
// Baseline to baseline, in cap heights. Neither word has a descender, so the lines can sit close; the
// gap between them is LEAD - 1 cap heights (a little more than the old logo's word space).
const LEAD = 1.42;

/** The lines stacked and centred on their ink, in font units; returns paths plus the block's ink box. */
function stack() {
  const cap = g.capHeight || 1500;
  const lines = g.lines.map((l, i) => {
    const dx = -(l.x0 + l.x1) / 2; // centre on the ink, not the advance width (optical centring)
    const dy = i * LEAD * cap;
    return { d: l.d, dx, dy, x0: l.x0 + dx, x1: l.x1 + dx, y0: l.y0 + dy, y1: l.y1 + dy };
  });
  const box = {
    x0: Math.min(...lines.map((l) => l.x0)),
    x1: Math.max(...lines.map((l) => l.x1)),
    y0: Math.min(...lines.map((l) => l.y0)),
    y1: Math.max(...lines.map((l) => l.y1)),
  };
  return { lines, box };
}

const S = stack();

/** The wordmark scaled so that its widest line is `width` wide, centred on (cx, cy). */
function logoGroup(cx, cy, width, color = '#fff') {
  const { lines, box } = S;
  const scale = width / (box.x1 - box.x0);
  const midY = (box.y0 + box.y1) / 2;
  return `<g transform="translate(${r(cx)} ${r(cy - midY * scale)}) scale(${r(scale, 5)})" fill="${color}">
    ${lines.map((l) => `<path transform="translate(${r(l.dx)} ${r(l.dy)})" d="${l.d}"/>`).join('\n    ')}
  </g>`;
}

const r = (n, p = 2) => +n.toFixed(p);

const NIGHT = { base0: '#01040f', base1: '#04215c', light: '#4aa6f5', mid: '#1758c6', shade: '#010616' };

// The icon: the widest line ("Bucket") spans 78 % of the tile, a hair below the centre (optical centre
// of a rounded tile). Maskable (Android): everything inside the safe circle (radius 40 %), so smaller.
const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000">${brush(NIGHT, 'i')}${logoGroup(500, 508, 780)}</svg>`;
const maskable = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000">${brush(NIGHT, 'm')}${logoGroup(500, 505, 660)}</svg>`;

const pad = 60;
const wm = { w: S.box.x1 - S.box.x0, h: S.box.y1 - S.box.y0 };
const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(S.box.x0 - pad)} ${r(S.box.y0 - pad)} ${r(wm.w + 2 * pad)} ${r(wm.h + 2 * pad)}"><g fill="currentColor">${S.lines
  .map((l) => `<path transform="translate(${r(l.dx)} ${r(l.dy)})" d="${l.d}"/>`)
  .join('')}</g></svg>`;
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="840" viewBox="0 0 1240 840">${brush(NIGHT, 'w', 1240, 840)}${logoGroup(620, 420, 640)}</svg>`;

const out = process.argv[3];
fs.writeFileSync(out + '/icon.svg', icon(1000));
fs.writeFileSync(out + '/icon-maskable.svg', maskable(1000));
fs.writeFileSync(out + '/wordmark.svg', wordmark);
fs.writeFileSync(out + '/banner.svg', banner);
module.exports = { brush };
