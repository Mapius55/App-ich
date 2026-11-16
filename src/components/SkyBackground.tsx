import { useEffect, useRef, useState } from "react";
import { mixLch } from "../lib/color";
import { createProgram, hexToVec, NOISE } from "../lib/gl";

// The living sky behind the whole app: an almost-black ground with soft
// fields of light in the colours of today's colour world. Each colour is its
// own field of light; where fields meet they add up like light (screen blend),
// never like paint, so blue and orange make a glow, not brown.
// Brushed into diagonal streaks. Rendered at a fraction of the screen
// resolution and at ~30 fps, so it stays light on the battery.

const N = 5; // main, accent, accent2, light, deep

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_glow;
uniform vec3 u_ground;
uniform vec3 u_cols[${N}];
${NOISE}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 screenAdd(vec3 base, vec3 light) { return 1.0 - (1.0 - base) * (1.0 - light); }

float field(vec2 q, vec2 drift, float scale, float t, float lo, float hi) {
  return smoothstep(lo, hi, snoise(vec3(q * scale + drift, t)));
}

void main() {
  vec2 p = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float t = u_time;

  // slowly drifting, folded coordinates (fluid look)
  vec2 w = vec2(snoise(vec3(p * 1.1, t * 0.035)), snoise(vec3(p * 1.1 + 7.3, t * 0.035)));
  vec2 q = p + 0.3 * w;

  // light lives up high and along a diagonal band, running out into black below
  vec2 d = rot(0.6) * p;
  float bandPos = d.y - 0.18 + 0.18 * snoise(vec3(d.x * 0.9, 1.0, t * 0.03));
  float band = exp(-bandPos * bandPos * 8.0);
  float height = mix(0.2, 1.0, smoothstep(-0.38, 0.3, p.y));

  // brush streaks along the diagonal
  float streak = snoise(vec3(d.x * 0.7, d.y * 20.0, t * 0.05)) * 0.5 + 0.5;
  float streak2 = snoise(vec3(d.x * 1.6 + 4.0, d.y * 46.0, t * 0.04)) * 0.5 + 0.5;
  float brush = mix(0.55, 1.2, streak) * mix(0.85, 1.1, streak2);

  // one field of light per colour, each wandering on its own
  float fMain   = field(q, vec2(0.0, t * 0.02), 0.8, t * 0.03, -0.25, 0.75);
  float fAccent = field(q, vec2(5.3, -t * 0.018), 1.0, t * 0.028 + 3.0, -0.05, 0.8);
  float fAcc2   = field(q, vec2(-3.1, t * 0.015), 1.15, t * 0.025 + 7.0, 0.2, 0.9);
  float fLight  = field(q, vec2(9.7, t * 0.012), 0.7, t * 0.02 + 11.0, 0.35, 1.0);

  // fields are either clearly lit or dark: no dim, murky in-between (dim orange on black reads as brown)
  fMain = pow(fMain, 1.7); fAccent = pow(fAccent, 1.7); fAcc2 = pow(fAcc2, 1.8); fLight = pow(fLight, 2.0);
  float light = (band * 0.85 + 0.3) * height * brush * u_glow;
  vec3 ground = mix(u_ground, u_cols[4] * 0.3, 0.3);
  vec3 c = ground;
  c = screenAdd(c, u_cols[0] * fMain * light * 1.0);
  c = screenAdd(c, u_cols[1] * fAccent * light * 0.8);
  c = screenAdd(c, u_cols[2] * fAcc2 * light * 0.7);
  c = screenAdd(c, u_cols[3] * fLight * light * band * 0.45);

  // keep the edges deep
  c *= 1.0 - 0.45 * smoothstep(0.25, 1.1, length(p * vec2(1.1, 0.9)));
  gl_FragColor = vec4(c, 1.0);
}`;

export function SkyBackground({ colors, ground, glow }: { colors: string[]; ground: string; glow: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef({ colors, ground, glow });
  const [fallback, setFallback] = useState(false);
  const loseTimer = useRef(0);
  target.current = { colors, ground, glow };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // a StrictMode remount reuses the context (its release below is deferred a tick)
    clearTimeout(loseTimer.current);
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl || gl.isContextLost()) return setFallback(true);
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
      cur = cur.map((c, i) => (c === tgt[i] ? c : mixLch(c, tgt[i], 0.04)));
      curGround = curGround === target.current.ground ? curGround : mixLch(curGround, target.current.ground, 0.04);
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
      gl.deleteProgram(prog);
      loseTimer.current = window.setTimeout(() => gl.getExtension("WEBGL_lose_context")?.loseContext(), 0);
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
