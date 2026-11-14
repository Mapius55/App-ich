import { useEffect, useRef, useState } from "react";
import { mixLch } from "../lib/color";
import { createProgram, hexToVec, NOISE } from "../lib/gl";
import { onPulse, voice } from "../lib/orbSignals";

export type OrbState = "idle" | "speaking" | "thinking" | "listening";

interface Props {
  colors: string[]; // 5 colours: [main, light, accent, deep, accent]
  size: number;
  daylight?: number; // 0 night … 1 day: at night the sky in the hole is deeper
  speed?: number;
  seed?: number;
  state?: OrbState;
  interactive?: boolean;
}

// A circle cut out of a sheet of paper, laid over a larger flat sky.
// Through the hole you see a flat surface of soft, wind-blown clouds in
// today's colours sliding past underneath. No sphere, no lens: the only hint
// of depth is the faint shadow the paper's cut edge casts onto the sky.
const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_flow;
uniform float u_energy;
uniform float u_seed;
uniform float u_press;
uniform vec2 u_pan;
uniform float u_kick;
uniform float u_level;
uniform float u_day;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
${NOISE}

// mixing in OKLab keeps blends clean (no grey or brown in between)
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toOk(vec3 c) {
  c = toLin(c);
  vec3 lms = vec3(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
                  0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
                  0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  lms = pow(max(lms, 0.0), vec3(1.0 / 3.0));
  return vec3(0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
              1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
              0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}
vec3 fromOk(vec3 o) {
  vec3 lms = vec3(o.x + 0.3963377774 * o.y + 0.2158037573 * o.z,
                  o.x - 0.1055613458 * o.y - 0.0638541728 * o.z,
                  o.x - 0.0894841775 * o.y - 1.2914855480 * o.z);
  lms = lms * lms * lms;
  return toSrgb(vec3(4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
                    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
                    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z));
}

float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float R = 0.97;
  vec2 sp = p / R;
  float r = length(sp);
  float px = 2.0 / (u_res.x * R);

  // the flat sky underneath: one large plane, sliding past with the wind
  float t = u_flow;
  vec2 seed = vec2(u_seed, u_seed * 0.37);
  vec2 uv = (sp + u_pan) / (1.0 + 0.25 * u_press + 0.06 * u_kick);

  float diag = dot(sp, normalize(vec2(0.72, -0.69))); // light up-left, deeper down-right (fixed to the hole)
  // by day the light corner is airy white; at night it stays deep and coloured
  vec3 o0 = toOk(u_c0), o1 = toOk(u_c1), o2 = toOk(u_c2), o4 = toOk(u_c4), oW = toOk(vec3(1.0));
  // light corner: airy by day, deep and coloured at night
  vec3 corner = mix(mix(o0, o1, 0.35 + 0.65 * u_day), oW, 0.18 * u_day);
  vec3 ok = mix(corner, o0, smoothstep(-0.9, 1.0, diag));
  ok = mix(ok, o2, smoothstep(0.1, 0.9, snoise(vec3(uv * 0.5 + seed, t * 0.02))) * 0.35);
  ok = mix(ok, o4, smoothstep(0.3, 1.0, diag + 0.3 * snoise(vec3(uv * 0.7 - seed, t * 0.025))) * 0.35);

  // wind-blown wisps
  vec2 wind = vec2(t * 0.06, t * 0.015);
  vec2 w = vec2(snoise(vec3(uv * 0.9 + seed, t * 0.05)), snoise(vec3(uv * 0.9 + seed + 5.1, t * 0.05)));
  vec2 cu = uv + 0.26 * w;
  vec2 stretch = vec2(0.75, 1.35);
  vec3 whiteOk = mix(o1, oW, mix(0.15, 0.6, u_day));
  float far = fbm(vec3(cu * 1.3 * stretch + seed + wind * 0.6, t * 0.03));
  float mid = fbm(vec3(cu * 0.85 * stretch + seed + 3.0 + wind, t * 0.04));
  ok = mix(ok, whiteOk, smoothstep(0.05, 0.6, far) * 0.35);
  ok = mix(ok, whiteOk, smoothstep(0.0, 0.55, mid) * 0.6 * (1.0 - 0.45 * smoothstep(-0.2, 1.0, diag)));
  vec3 sky = fromOk(ok);
  float under = fbm(vec3((cu + vec2(0.05, 0.06)) * 0.85 * stretch + seed + 3.0 + wind, t * 0.04));
  sky = mix(sky, sky * mix(vec3(1.0), u_c3, 0.25), smoothstep(0.1, 0.6, under) * (1.0 - smoothstep(0.0, 0.55, mid)) * 0.35);
  sky *= mix(0.8, 1.0, u_day); // night: a little deeper
  sky *= 1.0 + 0.16 * u_level + 0.1 * u_kick + 0.05 * u_energy;

  // the paper's cut edge casts a faint shadow onto the sky (light from the upper left)
  float shadowDist = length(sp - vec2(0.03, -0.03));
  sky *= 1.0 - smoothstep(0.94, 1.03, shadowDist) * 0.28;

  // film grain
  float g = fract(sin(dot(gl_FragCoord.xy + fract(u_time) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
  sky += (g - 0.5) * 0.02;
  sky = clamp(sky, 0.0, 1.0);

  float inside = 1.0 - smoothstep(1.0 - px * 1.2, 1.0, r);
  gl_FragColor = vec4(sky * inside, inside);
}`;



/**
 * The portal. Press it and the sky comes closer; drag and the sky slides
 * along under the paper; it brightens with your voice and stirs at every
 * word the coach says.
 */
export function Portal({ colors, size, daylight = 1, speed = 1, seed = 1, state = "idle", interactive = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef(colors);
  const stateRef = useRef(state);
  const speedRef = useRef(speed);
  const dayRef = useRef(daylight);
  dayRef.current = daylight;
  const input = useRef({ down: false, lastX: 0, lastY: 0, velX: 0, velY: 0, kick: 0 });
  const [fallback, setFallback] = useState(false);

  target.current = colors;
  stateRef.current = state;
  speedRef.current = speed;

  useEffect(() => onPulse((s) => (input.current.kick = Math.min(1, input.current.kick + s))), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return setFallback(true);
    let prog: WebGLProgram;
    try {
      prog = createProgram(gl, FRAG);
    } catch (e) {
      console.warn("Portal: WebGL nicht verfügbar", e);
      return setFallback(true);
    }
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = {
      res: u("u_res"), time: u("u_time"), flow: u("u_flow"), energy: u("u_energy"), seed: u("u_seed"),
      press: u("u_press"), pan: u("u_pan"), kick: u("u_kick"), level: u("u_level"), day: u("u_day"),
      cols: [u("u_c0"), u("u_c1"), u("u_c2"), u("u_c3"), u("u_c4")],
    };
    // soft clouds don't need full retina resolution; keeps phones cool
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.seed, (seed % 1000) / 37);
    gl.enable(gl.BLEND);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cur = [...target.current];
    let t = 0, flow = 0, panX = 0, panY = 0, energy = 0, press = 0, level = 0, day = dayRef.current;
    let last = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = stateRef.current;
      const inp = input.current;
      const want = st === "speaking" ? 1 : st === "thinking" ? 0.65 : st === "listening" ? 0.45 : 0;
      energy += (want - energy) * Math.min(1, dt * 3);
      press += ((inp.down ? 1 : 0) - press) * Math.min(1, dt * 8);
      const wantLevel =
        st === "listening" ? Math.max(voice.level, 0.12 + 0.08 * Math.sin(t * 4)) : st === "speaking" ? voice.out * 0.9 : 0;
      level += (wantLevel - level) * Math.min(1, dt * 10);
      inp.kick *= Math.exp(-dt * 3.2);
      inp.velX *= Math.exp(-dt * 2.2);
      inp.velY *= Math.exp(-dt * 2.2);

      const m = reduce ? 0.2 : 1;
      t += dt * m;
      // falling inward: faster while speaking, pressed or listening
      // clouds drift; faster while speaking, pressed, listening or nudged by a word
      flow += dt * m * speedRef.current * (0.9 + 1.4 * energy + 2.2 * press + 1.2 * level + 1.5 * inp.kick);
      panX += dt * inp.velX;
      panY += dt * inp.velY;

      cur = cur.map((c, i) => (c === target.current[i] ? c : mixLch(c, target.current[i], 0.05)));
      cur.forEach((c, i) => gl.uniform3fv(U.cols[i], hexToVec(c)));
      gl.uniform1f(U.time, t);
      gl.uniform1f(U.flow, flow);
      gl.uniform1f(U.energy, energy);
      gl.uniform1f(U.press, press);
      gl.uniform2f(U.pan, panX, panY);
      day += (dayRef.current - day) * 0.03;
      gl.uniform1f(U.day, day);
      gl.uniform1f(U.kick, inp.kick);
      gl.uniform1f(U.level, level);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [size, seed]);

  // ---- touch: press and the sky comes closer; drag to slide the sky underneath
  const handlers = interactive
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          Object.assign(input.current, { down: true, lastX: e.clientX, lastY: e.clientY });
        },
        onPointerMove: (e: React.PointerEvent) => {
          const inp = input.current;
          if (!inp.down) return;
          const k = 2 / size; // pixels → shader units
          inp.velX -= (e.clientX - inp.lastX) * k * 9;
          inp.velY += (e.clientY - inp.lastY) * k * 9;
          inp.lastX = e.clientX;
          inp.lastY = e.clientY;
        },
        onPointerUp: () => {
          input.current.down = false;
          input.current.kick = 1;
        },
        onPointerCancel: () => (input.current.down = false),
      }
    : {};

  return (
    <div className={`portal ${interactive ? "interactive" : ""}`} style={{ width: size, height: size }} aria-hidden="true" {...handlers}>
      {fallback ? (
        <div
          className="portal-fallback"
          style={{
            background: `radial-gradient(circle at 40% 35%, ${colors[1]}, ${colors[0]} 45%, ${colors[2]} 72%, transparent 74%)`,
          }}
        />
      ) : (
        // a fresh canvas per size: a canvas whose WebGL context was released can't be reused
        <canvas key={size} ref={canvasRef} style={{ width: size, height: size }} />
      )}
    </div>
  );
}
