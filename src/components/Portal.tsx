import { useEffect, useRef, useState } from "react";
import { mixLch } from "../lib/color";
import { createProgram, hexToVec, NOISE } from "../lib/gl";
import { onPress, onPulse, voice } from "../lib/orbSignals";
import type { Clouds } from "../lib/palette";

const DEFAULT_CLOUDS: Clouds = { cover: 0.5, cirrus: 0.5, stratus: 0.1 };

export type OrbState = "idle" | "speaking" | "thinking" | "listening";

interface Props {
  colors: string[]; // 5 colours: [main, light, accent, deep, accent]
  size: number;
  daylight?: number; // 0 night … 1 day: at night the sky in the hole is deeper
  clouds?: Clouds; // the real weather shapes how the colours move
  speed?: number;
  seed?: number;
  state?: OrbState;
  interactive?: boolean;
  /** stop drawing (the canvas keeps showing its last frame) */
  paused?: boolean;
  /** draw at most this many frames per second (e.g. a docked circle while the coach talks) */
  fps?: number;
}

// A circle cut out of a sheet of paper, laid over a larger flat sky.
// Through the hole you see soft colours flowing into each other like
// out-of-focus clouds, with a fine grain (in the spirit of the ElevenLabs
// orbs, in today's colour world). The flow moves in several ways:
//   - it drifts with a wind that slowly turns,
//   - it folds and billows, more while you speak or the coach talks,
//   - now and then a gentle eddy comes and goes,
//   - fine high veils cross it faster and in another direction (clear skies),
//   - overcast, rain and fog stretch the colours into wide, calm bands.
// No sphere, no lens: the only hint of depth is the faint shadow the paper's
// cut edge casts onto the sky.
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
uniform float u_cover;
uniform float u_cirrus;
uniform float u_stratus;
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
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float R = 0.97;
  vec2 sp = p / R;
  float r = length(sp);
  float px = 2.0 / (u_res.x * R);

  float t = u_flow;  // drift (faster while speaking, pressed, listening)
  float e = u_time;  // slow change of shape
  vec2 seed = vec2(u_seed, u_seed * 0.37);
  vec2 uv = (sp + u_pan) / (1.0 + 0.25 * u_press + 0.06 * u_kick);

  // the wind turns slowly; mostly sideways, a little up or down
  float windA = 0.35 * sin(e * 0.013 + u_seed) + 0.25 * sin(e * 0.031 + 1.7);
  vec2 windDir = vec2(cos(windA), sin(windA));
  // now and then a gentle eddy comes and goes (a little stronger while speaking)
  float swirl = smoothstep(0.3, 1.0, sin(e * 0.045 + u_seed * 2.0)) * 0.55 + 0.25 * u_energy + 0.15 * u_kick;
  vec2 suv = rot(swirl * exp(-dot(uv, uv) * 0.7)) * uv;
  // overcast, rain and fog: the colours lie in wide, calm bands
  suv.y *= 1.0 + 0.7 * u_stratus;

  vec3 o0 = toOk(u_c0), o1 = toOk(u_c1), o2 = toOk(u_c2), o3 = toOk(u_c3), o4 = toOk(u_c4), oW = toOk(vec3(1.0));

  // ---- soft colour clouds that fold, drift and flow into each other
  vec2 q = suv * 0.6 + seed;
  // (kept small enough that the flow never folds over itself: no creases)
  float stir = 0.32 + 0.1 * u_cover + 0.12 * u_energy + 0.16 * u_level + 0.1 * u_kick;
  vec2 w1 = vec2(snoise(vec3(q * 0.6, e * 0.05)), snoise(vec3(q * 0.6 + 4.7, e * 0.05)));
  vec2 q2 = q + stir * w1 + windDir * t * 0.035;
  float a = snoise(vec3(q2 + 1.3, e * 0.04));
  float b = snoise(vec3(q2 * 1.2 + 8.1, e * 0.045));
  float c = snoise(vec3(q2 * 0.9 + 3.3, e * 0.035));
  vec3 ok = mix(o0, o2, smoothstep(-0.7, 0.7, a));
  ok = mix(ok, o4, smoothstep(-0.3, 0.8, b) * 0.8);
  ok = mix(ok, o1, smoothstep(0.0, 0.9, c) * 0.65);
  ok = mix(ok, o3, smoothstep(0.3, 0.9, -a) * 0.3);

  // ---- fine high veils, faster and across the flow (mostly on clear days)
  vec2 cu = (rot(-0.45) * suv) * vec2(0.55, 2.0) + rot(0.7) * windDir * t * 0.09 + 0.25 * w1;
  float veil = snoise(vec3(cu * 1.1 + seed + 11.0, e * 0.02)) * 0.7 + snoise(vec3(cu * 2.3 + seed + 17.0, e * 0.03)) * 0.3;
  veil = smoothstep(0.1, 0.75, veil) * u_cirrus;
  ok = mix(ok, mix(o1, oW, 0.3 * u_day), veil * 0.3);

  // ---- soft light from the upper left, stronger by day
  float diag = dot(sp, normalize(vec2(0.72, -0.69)));
  ok = mix(ok, mix(o1, oW, 0.25 * u_day), smoothstep(0.2, -1.0, diag) * (0.12 + 0.18 * u_day));

  vec3 sky = fromOk(ok);
  sky *= mix(0.84, 1.0, u_day); // night: a little deeper
  sky *= 1.0 + 0.16 * u_level + 0.1 * u_kick + 0.05 * u_energy;

  // the paper's cut edge casts a faint shadow onto the sky (light from the upper left)
  float shadowDist = length(sp - vec2(0.03, -0.03));
  sky *= 1.0 - smoothstep(0.94, 1.03, shadowDist) * 0.22;

  // fine grain, fixed like the grain of paper (it doesn't flicker)
  float g = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  sky += (g - 0.5) * 0.07;
  sky = clamp(sky, 0.0, 1.0);

  float inside = 1.0 - smoothstep(1.0 - px * 1.2, 1.0, r);
  gl_FragColor = vec4(sky * inside, inside);
}`;

/** the flat colour-flow look (no highlight, no shading) for places without WebGL */
export function orbFallbackBackground(colors: string[]): string {
  const [c0, c1, c2] = [colors[0], colors[1] ?? colors[0], colors[2] ?? colors[0]];
  return `radial-gradient(70% 70% at 22% 28%, ${c1} 0%, transparent 70%), radial-gradient(70% 70% at 78% 72%, ${c2} 0%, transparent 70%), linear-gradient(135deg, ${c0}, ${c2})`;
}

interface Live {
  target: { current: string[] };
  state: { current: OrbState };
  speed: { current: number };
  day: { current: number };
  clouds: { current: Clouds };
  seed: { current: number };
  fps: { current: number | undefined };
  input: { current: { down: boolean; kick: number } };
}

interface Engine {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  start(): void;
  stop(): void;
  resize(size: number): void;
  drawOnce(): void;
  restore(): boolean;
  lose(): void;
}

// The GL side of the portal, created once per canvas. Resizing changes the canvas
// backing store, viewport and u_res in place (no new canvas, no context loss).
function createEngine(canvas: HTMLCanvasElement, live: Live): Engine | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) return null;
  type Uniforms = Record<"res" | "time" | "flow" | "energy" | "seed" | "press" | "pan" | "kick" | "level" | "day" | "cover" | "cirrus" | "stratus", WebGLUniformLocation | null> & {
    cols: (WebGLUniformLocation | null)[];
  };
  let U: Uniforms;
  const init = (): boolean => {
    let prog: WebGLProgram;
    try {
      prog = createProgram(gl, FRAG);
    } catch (e) {
      console.warn("Portal: WebGL nicht verfügbar", e);
      return false;
    }
    const u = (n: string) => gl.getUniformLocation(prog, n);
    U = {
      res: u("u_res"), time: u("u_time"), flow: u("u_flow"), energy: u("u_energy"), seed: u("u_seed"),
      press: u("u_press"), pan: u("u_pan"), kick: u("u_kick"), level: u("u_level"), day: u("u_day"),
      cover: u("u_cover"), cirrus: u("u_cirrus"), stratus: u("u_stratus"),
      cols: [u("u_c0"), u("u_c1"), u("u_c2"), u("u_c3"), u("u_c4")],
    };
    gl.uniform1f(U.seed, (live.seed.current % 1000) / 37);
    gl.uniform2f(U.pan, 0, 0);
    gl.enable(gl.BLEND);
    if (canvas.width) gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);
    return true;
  };
  if (!init()) return null;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cur = [...live.target.current];
  let t = 0, flow = 0, energy = 0, press = 0, level = 0, day = live.day.current;
  const cl = { ...live.clouds.current };
  let last = performance.now();
  let lastDraw = 0;
  let raf = 0;
  let size = 0;

  const step = (dt: number) => {
    const st = live.state.current;
    const inp = live.input.current;
    const want = st === "speaking" ? 1 : st === "thinking" ? 0.65 : st === "listening" ? 0.45 : 0;
    energy += (want - energy) * Math.min(1, dt * 3);
    press += ((inp.down ? 1 : 0) - press) * Math.min(1, dt * 8);
    const wantLevel = st === "listening" ? Math.max(voice.level, 0.12 + 0.08 * Math.sin(t * 4)) : st === "speaking" ? voice.out * 0.9 : 0;
    level += (wantLevel - level) * Math.min(1, dt * 10);
    inp.kick *= Math.exp(-dt * 3.2);
    const m = reduce ? 0.2 : 1;
    t += dt * m;
    // clouds drift; faster while speaking, pressed, listening or nudged by a word
    flow += dt * m * live.speed.current * (0.9 + 1.4 * energy + 2.2 * press + 1.2 * level + 1.5 * inp.kick);
    const k = Math.min(1, dt * 3); // colour and weather changes ease in over ~1 s
    cur = cur.map((c, i) => (c === live.target.current[i] ? c : mixLch(c, live.target.current[i], Math.max(0.05, k))));
    day += (live.day.current - day) * Math.max(0.03, k * 0.5);
    const want2 = live.clouds.current;
    cl.cover += (want2.cover - cl.cover) * Math.max(0.01, k * 0.2);
    cl.cirrus += (want2.cirrus - cl.cirrus) * Math.max(0.01, k * 0.2);
    cl.stratus += (want2.stratus - cl.stratus) * Math.max(0.01, k * 0.2);
  };

  const draw = () => {
    if (gl.isContextLost()) return;
    const inp = live.input.current;
    cur.forEach((c, i) => gl.uniform3fv(U.cols[i], hexToVec(c)));
    gl.uniform1f(U.time, t);
    gl.uniform1f(U.flow, flow);
    gl.uniform1f(U.energy, energy);
    gl.uniform1f(U.press, press);
    gl.uniform1f(U.day, day);
    gl.uniform1f(U.cover, cl.cover);
    gl.uniform1f(U.cirrus, cl.cirrus);
    gl.uniform1f(U.stratus, cl.stratus);
    gl.uniform1f(U.kick, inp.kick);
    gl.uniform1f(U.level, level);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const fps = live.fps.current;
    if (fps && now - lastDraw < 1000 / fps - 4) return;
    const dt = Math.min(fps ? 0.12 : 0.05, (now - last) / 1000);
    last = now;
    lastDraw = now;
    step(dt);
    draw();
  };

  return {
    canvas,
    gl,
    start() {
      if (raf) return;
      last = performance.now();
      lastDraw = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    resize(next: number) {
      // the flow is cheap to draw; 2x keeps the grain fine and the paper edge crisp
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = Math.max(1, Math.round(next * dpr));
      if (next === size && canvas.width === px) return;
      size = next;
      canvas.width = px;
      canvas.height = px;
      gl.viewport(0, 0, px, px);
      gl.uniform2f(U.res, px, px);
    },
    drawOnce() {
      step(0);
      draw();
    },
    restore() {
      return init();
    },
    lose() {
      cancelAnimationFrame(raf);
      raf = 0;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/**
 * The portal. Press it and the sky comes closer; it brightens with your voice
 * and stirs at every word the coach says. One canvas for its whole life: a new
 * size resizes it in place, and `paused` stops drawing (the last frame stays).
 */
export function Portal({ colors, size, daylight = 1, clouds = DEFAULT_CLOUDS, speed = 1, seed = 1, state = "idle", interactive = true, paused = false, fps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<Live>(null as unknown as Live);
  live.current ??= {
    target: { current: colors },
    state: { current: state },
    speed: { current: speed },
    day: { current: daylight },
    clouds: { current: clouds },
    seed: { current: seed },
    fps: { current: fps },
    input: { current: { down: false, kick: 0 } },
  };
  const L = live.current;
  L.target.current = colors;
  L.state.current = state;
  L.speed.current = speed;
  L.day.current = daylight;
  L.clouds.current = clouds;
  L.seed.current = seed;
  L.fps.current = fps;
  const engine = useRef<Engine | null>(null);
  const loseTimer = useRef(0);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [fallback, setFallback] = useState(false);

  useEffect(() => onPulse((s) => (L.input.current.kick = Math.min(1, L.input.current.kick + s))), [L]);
  useEffect(
    () =>
      onPress((down) => {
        L.input.current.down = down;
        if (!down) L.input.current.kick = 1;
      }),
    [L],
  );

  // GL lives as long as the canvas; the context is released only on unmount (deferred
  // a tick, so StrictMode's mount → unmount → mount keeps the same context)
  useEffect(() => {
    if (fallback) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    clearTimeout(loseTimer.current);
    let eng = engine.current;
    if (!eng || eng.canvas !== canvas || eng.gl.isContextLost()) {
      eng = createEngine(canvas, L);
      if (!eng) {
        setFallback(true);
        return;
      }
      engine.current = eng;
    }
    const e = eng;
    e.resize(sizeRef.current);
    if (pausedRef.current) e.drawOnce();
    else e.start();
    const onLost = (ev: Event) => {
      ev.preventDefault(); // allows a restore
      e.stop();
    };
    const onRestored = () => {
      if (!e.restore()) return setFallback(true);
      e.resize(sizeRef.current);
      if (pausedRef.current) e.drawOnce();
      else e.start();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      e.stop();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      loseTimer.current = window.setTimeout(() => {
        e.lose();
        if (engine.current === e) engine.current = null;
      }, 0);
    };
  }, [fallback, L]);

  // a new size: resize in place (and draw once when paused, the resize cleared the canvas)
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.resize(size);
    if (pausedRef.current) e.drawOnce();
  }, [size]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (paused) e.stop();
    else e.start();
  }, [paused]);

  // press only (no drag): down brings the sky closer, up lets go with a kick
  const handlers = interactive
    ? {
        onPointerDown: () => (L.input.current.down = true),
        onPointerUp: () => {
          L.input.current.down = false;
          L.input.current.kick = 1;
        },
        onPointerCancel: () => (L.input.current.down = false),
      }
    : {};

  return (
    <div className={`portal ${interactive ? "interactive" : ""}`} style={{ width: size, height: size }} aria-hidden="true" data-paused={paused ? "true" : "false"} {...handlers}>
      {fallback ? (
        <div className="portal-fallback" style={{ background: orbFallbackBackground(colors) }} />
      ) : (
        <canvas ref={canvasRef} style={{ width: size, height: size }} />
      )}
    </div>
  );
}
