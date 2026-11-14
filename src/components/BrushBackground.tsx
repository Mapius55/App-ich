// The brand background: soft painted brush strokes across a deep sky.
// The strokes keep their texture while their colours follow the time of day,
// weather and mood. The SVG (with its bristle-noise filters) is rendered as an
// image, so the browser rasterises it once; only that bitmap drifts, and a new
// sky cross-fades over the old one.

import { useEffect, useMemo, useState } from "react";

export interface BrushColors {
  bgTop: string;
  bgBottom: string;
  light: string;
  mid: string;
  shade: string;
}

const W = 600;
const H = 1000;

function brushSvg({ bgTop, bgBottom, light, mid, shade }: BrushColors): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="base" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${bgTop}"/><stop offset="0.6" stop-color="${bgBottom}"/><stop offset="1" stop-color="${mid}"/>
    </linearGradient>
    <radialGradient id="l"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${light}" stop-opacity="0.55"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>
    <radialGradient id="m"><stop offset="0" stop-color="${mid}" stop-opacity="0.95"/><stop offset="1" stop-color="${mid}" stop-opacity="0"/></radialGradient>
    <radialGradient id="s"><stop offset="0" stop-color="${shade}" stop-opacity="0.95"/><stop offset="1" stop-color="${shade}" stop-opacity="0"/></radialGradient>
    <filter id="streak" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.0018 0.045" numOctaves="4" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2.2 -0.55" result="a"/>
      <feComposite in="SourceGraphic" in2="a" operator="in" result="c"/>
      <feGaussianBlur in="c" stdDeviation="1.2"/>
    </filter>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="34"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <g transform="rotate(-34 ${W / 2} ${H / 2})">
    <ellipse cx="${W * 0.78}" cy="${H * 0.24}" rx="${W * 0.9}" ry="${H * 0.13}" fill="url(#l)" filter="url(#soft)" opacity="0.55"/>
    <ellipse cx="${W * 0.76}" cy="${H * 0.23}" rx="${W * 0.95}" ry="${H * 0.12}" fill="url(#l)" filter="url(#streak)" opacity="0.9"/>
    <ellipse cx="${W * 0.62}" cy="${H * 0.4}" rx="${W * 0.85}" ry="${H * 0.08}" fill="url(#m)" filter="url(#streak)" opacity="0.7"/>
    <ellipse cx="${W * 0.86}" cy="${H * 0.66}" rx="${W * 0.85}" ry="${H * 0.12}" fill="url(#s)" filter="url(#soft)" opacity="0.9"/>
    <ellipse cx="${W * 0.05}" cy="${H * 0.55}" rx="${W * 0.7}" ry="${H * 0.2}" fill="url(#s)" filter="url(#soft)" opacity="0.85"/>
    <ellipse cx="${W * 0.4}" cy="${H * 0.86}" rx="${W * 0.8}" ry="${H * 0.06}" fill="url(#m)" filter="url(#streak)" opacity="0.35"/>
  </g>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.12" style="mix-blend-mode:overlay"/>
</svg>`;
}

export function BrushBackground({ colors }: { colors: BrushColors }) {
  const key = `${colors.bgTop}${colors.bgBottom}${colors.light}${colors.mid}${colors.shade}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brushSvg(colors))}`, [key]);

  // Two layers: the new sky fades in over the previous one.
  const [layers, setLayers] = useState<{ a: string; b: string | null; top: "a" | "b" }>({ a: src, b: null, top: "a" });
  useEffect(() => {
    setLayers((l) => {
      const current = l.top === "a" ? l.a : l.b;
      if (current === src) return l;
      return l.top === "a" ? { ...l, b: src, top: "b" } : { ...l, a: src, top: "a" };
    });
  }, [src]);

  return (
    <div className="brush-bg" aria-hidden="true">
      <div className="brush-drift">
        {/* keyed by src: a new sky remounts and fades in on top of the old one */}
        <img key={layers.a} src={layers.a} alt="" className={layers.top === "a" ? "on" : ""} />
        {layers.b && <img key={layers.b} src={layers.b} alt="" className={layers.top === "b" ? "on" : ""} />}
      </div>
    </div>
  );
}
