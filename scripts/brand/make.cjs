// Brand asset generator for "I am".
// 1. Download Bodoni Moda (OFL) from github.com/google/fonts (ofl/bodonimoda)
// 2. python outline.py BodoniModa[opsz,wght].ttf "I am" 500 > glyphs.json   (needs fontTools)
// 3. node make.cjs glyphs.json <out-dir>      → icon.svg, wordmark.svg, banner.svg
// 4. node render.cjs '[["icon.svg",512,512,"icon-512.png"]]'   (needs Playwright) → PNGs
// Builds the brush background + "I am" logo as SVG strings.
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

// Swash in font units (baseline y=0, cap height -1500, x-height -920).
const SWASH = 'M 712 0 C 1500 30, 2450 -260, 3120 -820 C 3560 -1190, 4260 -1420, 4330 -930 C 4390 -500, 4050 -40, 3640 10';

function logo(color = '#fff', strokeW = 13) {
  return { d: g.d, swash: SWASH, color, strokeW, width: g.width };
}

function logoGroup(cx, cy, scale, color = '#fff', stroke = 6.5) {
  const w = 4400; // including swash
  const x = cx - (w * scale) / 2 + 40 * scale;
  const y = cy + (1500 * scale) / 2 - 60 * scale;
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="${g.d}" fill="${color}"/>
    <path d="${SWASH}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>
  </g>`;
}

const NIGHT = { base0: '#01040f', base1: '#04215c', light: '#4aa6f5', mid: '#1758c6', shade: '#010616' };

const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000">${brush(NIGHT, 'i')}${logoGroup(500, 515, 0.155, '#fff', 10)}</svg>`;
const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1560 4440 1700"><path d="${g.d}" fill="currentColor"/><path d="${SWASH}" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/></svg>`;
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="840" viewBox="0 0 1240 840">${brush(NIGHT, 'w', 1240, 840)}${logoGroup(620, 420, 0.21)}</svg>`;

const out = process.argv[3];
fs.writeFileSync(out + '/icon.svg', icon(1000));
fs.writeFileSync(out + '/wordmark.svg', wordmark);
fs.writeFileSync(out + '/banner.svg', banner);
module.exports = { brush };
