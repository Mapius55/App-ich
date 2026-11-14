import { useEffect, useRef, useState } from "react";
import { mix } from "../lib/color";
import { createProgram, hexToVec, NOISE } from "../lib/gl";

// The living sky behind the whole app: an almost-black ground with soft
// fields of light that flow through today's ~10 colours, brushed into
// diagonal streaks. Rendered at a fraction of the screen resolution (it's
// all soft light anyway) and at ~30 fps, so it stays light on the battery.

const N = 10;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_glow;
uniform vec3 u_ground;
uniform vec3 u_cols[${N}];
${NOISE}

vec3 pick(float i) {
  vec3 c = u_cols[0];
  for (int k = 0; k < ${N}; k++) { if (float(k) == i) c = u_cols[k]; }
  return c;
}
// walk around the colour wheel: cyclic, smooth
vec3 flow(float t) {
  float x = fract(t) * ${N}.0;
  float i = floor(x);
  float f = smoothstep(0.0, 1.0, fract(x));
  return mix(pick(i), pick(mod(i + 1.0, ${N}.0)), f);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec2 p = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float t = u_time;

  // slowly drifting, folded coordinates (fluid look)
  vec2 w = vec2(snoise(vec3(p * 1.1, t * 0.035)), snoise(vec3(p * 1.1 + 7.3, t * 0.035)));
  vec2 q = p + 0.32 * w;

  // colour: travels through all of today's colours
  float f = snoise(vec3(q * 0.85, t * 0.025));
  vec3 col = flow(f * 0.45 + t * 0.012 + q.y * 0.25);
  vec3 col2 = flow(f * 0.3 - t * 0.009 + q.x * 0.3 + 0.5);
  col = mix(col, col2, smoothstep(-0.4, 0.6, snoise(vec3(q * 0.6 + 3.0, t * 0.02))) * 0.5);

  // where the light falls: a broad diagonal band plus wandering clouds of light
  vec2 d = rot(0.6) * p;
  float bandPos = d.y - 0.18 + 0.18 * snoise(vec3(d.x * 0.9, 1.0, t * 0.03));
  float band = exp(-bandPos * bandPos * 10.0);
  float clouds = smoothstep(0.05, 0.85, snoise(vec3(q * 0.75 + 11.0, t * 0.03)));
  float light = clamp(band * 0.8 + clouds * 0.45, 0.0, 1.0);
  // light lives up high and runs out into black further down (calm behind the text)
  light *= mix(0.22, 1.0, smoothstep(-0.35, 0.3, p.y));

  // brush streaks along the diagonal
  float streak = snoise(vec3(d.x * 0.7, d.y * 20.0, t * 0.05)) * 0.5 + 0.5;
  float streak2 = snoise(vec3(d.x * 1.6 + 4.0, d.y * 46.0, t * 0.04)) * 0.5 + 0.5;
  light *= mix(0.55, 1.2, streak) * mix(0.85, 1.1, streak2);
  light *= u_glow;

  vec3 c = mix(u_ground, col, clamp(light, 0.0, 1.0) * 0.92);
  // keep the edges deep
  c *= 1.0 - 0.45 * smoothstep(0.25, 1.1, length(p * vec2(1.1, 0.9)));
  gl_FragColor = vec4(c, 1.0);
}`;

export function SkyBackground({ colors, ground, glow }: { colors: string[]; ground: string; glow: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef({ colors, ground, glow });
  const [fallback, setFallback] = useState(false);
  target.current = { colors, ground, glow };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return setFallback(true);
    let prog: WebGLProgram;
    try {
      prog = createProgram(gl, FRAG);
    } catch (e) {
      console.warn("Sky: WebGL nicht verfügbar", e);
      return setFallback(true);
    }
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uGlow = gl.getUniformLocation(prog, "u_glow");
    const uGround = gl.getUniformLocation(prog, "u_ground");
    const uCols = gl.getUniformLocation(prog, "u_cols");

    // Low resolution on purpose: the sky is soft light, the browser smooths it.
    const resize = () => {
      const scale = 0.34;
      canvas.width = Math.max(64, Math.round(window.innerWidth * scale));
      canvas.height = Math.max(64, Math.round(window.innerHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const pad = (cs: string[]) => Array.from({ length: N }, (_, i) => cs[i % cs.length]);
    let cur = pad(target.current.colors);
    let curGround = target.current.ground;
    let curGlow = target.current.glow;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let t = Math.random() * 100;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc < 1 / 30) return; // ~30 fps is plenty for drifting light
      t += acc * (reduce ? 0.2 : 1);
      acc = 0;

      // colours glide (several seconds) instead of jumping
      const tgt = pad(target.current.colors);
      cur = cur.map((c, i) => (c === tgt[i] ? c : mix(c, tgt[i], 0.04)));
      curGround = curGround === target.current.ground ? curGround : mix(curGround, target.current.ground, 0.04);
      curGlow += (target.current.glow - curGlow) * 0.04;

      gl.uniform1f(uTime, t);
      gl.uniform1f(uGlow, curGlow);
      gl.uniform3fv(uGround, hexToVec(curGround));
      gl.uniform3fv(uCols, new Float32Array(cur.flatMap(hexToVec)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div className="sky-bg" aria-hidden="true">
      {fallback ? (
        <div
          className="sky-fallback"
          style={{
            background: `radial-gradient(60% 40% at 75% 20%, ${colors[0]}88, transparent 70%),
              radial-gradient(50% 35% at 20% 60%, ${colors[Math.floor(colors.length / 2)]}66, transparent 70%),
              ${ground}`,
          }}
        />
      ) : (
        <canvas ref={canvasRef} />
      )}
      <div className="sky-grain" />
    </div>
  );
}
