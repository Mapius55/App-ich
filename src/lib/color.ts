// Small colour helpers. Mixing happens in OKLab so blends stay luminous
// (no muddy grey in the middle like plain RGB mixing).

export type RGB = [number, number, number]; // 0..255

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
};

type Lab = [number, number, number];

export function rgbToOklab([r, g, b]: RGB): Lab {
  const lr = toLin(r), lg = toLin(g), lb = toLin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function mix(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]));
}

/** Adjust colour in OKLCh space: dL lightness, chroma multiplier, hue shift in degrees. */
export function adjust(hex: string, { dL = 0, chroma = 1, hue = 0 }: { dL?: number; chroma?: number; hue?: number }): string {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  let C = Math.hypot(a, b) * chroma;
  let h = Math.atan2(b, a) + (hue * Math.PI) / 180;
  C = Math.max(0, C);
  return rgbToHex(oklabToRgb([Math.min(1, Math.max(0, L + dL)), C * Math.cos(h), C * Math.sin(h)]));
}

export function lightness(hex: string): number {
  return rgbToOklab(hexToRgb(hex))[0];
}

/** Set lightness to a target value while keeping hue and chroma. */
export function withLightness(hex: string, L: number): string {
  const [, a, b] = rgbToOklab(hexToRgb(hex));
  return rgbToHex(oklabToRgb([L, a, b]));
}

export function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Blend in OKLCh along the shorter hue arc: keeps colours clean (no grey/brown midpoints). */
export function mixLch(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  const cA = Math.hypot(A[1], A[2]);
  const cB = Math.hypot(B[1], B[2]);
  let hA = Math.atan2(A[2], A[1]);
  let hB = Math.atan2(B[2], B[1]);
  if (cA < 0.02) hA = hB; // a near-grey takes the other's hue
  if (cB < 0.02) hB = hA;
  let dh = hB - hA;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  const L = A[0] + (B[0] - A[0]) * t;
  const C = cA + (cB - cA) * t;
  const h = hA + dh * t;
  return rgbToHex(oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)]));
}

/** OKLCh of a colour: [lightness 0..1, chroma, hue in degrees]. */
export function lch(hex: string): [number, number, number] {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}
