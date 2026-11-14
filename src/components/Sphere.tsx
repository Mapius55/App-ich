import { useEffect, useRef, useState } from "react";
import { hexToRgb, mix, rgba } from "../lib/color";

export type OrbState = "idle" | "speaking" | "thinking" | "listening";

interface Props {
  colors: string[]; // 5 colours from the palette
  size: number;
  speed?: number;
  seed?: number;
  state?: OrbState;
  glow?: boolean;
}

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// A lit 3D sphere whose surface is painted by slowly drifting 3D noise, so the
// colour bands wrap around the ball and turn with it.
// Simplex noise: Ashima Arts / Stefan Gustavson (MIT licence).
const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_energy;
uniform float u_seed;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float breathe = 1.0 + 0.012 * sin(u_time * 1.3) + u_energy * 0.022 * sin(u_time * 6.5);
  float R = 0.93 * breathe;
  p /= R;
  float d = length(p);
  float px = 2.0 / (u_res.x * R);
  float alpha = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, d);
  if (alpha <= 0.0) { gl_FragColor = vec4(0.0); return; }

  float z = sqrt(max(0.0, 1.0 - d * d));
  vec3 n = vec3(p, z);
  float t = u_time;

  // surface coordinates turn with the ball
  vec3 q = rotY(t * 0.16) * rotX(0.35 + 0.08 * sin(t * 0.21)) * n;
  // low frequencies + wide blends = large, soft colour fields (no spots)
  vec3 sp = q * 0.62 + vec3(u_seed);
  float f1 = snoise(sp + vec3(0.0, t * 0.05, 0.0));
  float f2 = snoise(sp * 0.9 + vec3(5.2, -t * 0.04, 1.3));
  float f3 = snoise(sp * 0.55 + vec3(-3.1, 2.7, t * 0.04));

  vec3 col = mix(u_c0, u_c1, smoothstep(-0.7, 0.7, f1));
  col = mix(col, u_c2, smoothstep(-0.35, 0.85, f2) * 0.8);
  col = mix(col, u_c4, smoothstep(-0.1, 0.9, f3) * 0.65);
  // deeper tone pools towards the bottom
  col = mix(col, u_c3, smoothstep(0.0, 1.0, -n.y * 0.9 + f3 * 0.3) * 0.5);

  // light from the upper left
  vec3 L = normalize(vec3(-0.45, 0.6, 0.75));
  float diff = max(dot(n, L), 0.0);
  col *= 0.6 + 0.5 * diff;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, H), 0.0);
  col += vec3(1.0) * pow(nh, 30.0) * 0.30;   // soft gloss
  col = mix(col, vec3(1.0), pow(nh, 5.0) * 0.07);  // broad sheen

  // rim light: a lighter tint glowing at the edge
  float fres = pow(1.0 - z, 2.4);
  vec3 rimCol = mix(u_c1, vec3(1.0), 0.35);
  col = mix(col, rimCol, fres * 0.55 * (0.55 + 0.45 * (1.0 - diff)));

  // film grain
  float g = fract(sin(dot(gl_FragCoord.xy + fract(t) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.03;

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

const toVec = (hex: string) => hexToRgb(hex).map((v) => v / 255) as [number, number, number];

/**
 * The gradient sphere. Colours glide to new values instead of jumping, so a
 * change of light, weather or mood feels like the sky changing.
 */
export function Sphere({ colors, size, speed = 1, seed = 1, state = "idle", glow = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const target = useRef(colors);
  const current = useRef<string[]>(colors);
  const stateRef = useRef(state);
  const speedRef = useRef(speed);
  const [fallback, setFallback] = useState(false);

  target.current = colors;
  stateRef.current = state;
  speedRef.current = speed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) {
      setFallback(true);
      return;
    }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    } catch (e) {
      console.warn("Sphere: WebGL nicht verfügbar", e);
      setFallback(true);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(prog, name);
    const uRes = u("u_res"), uTime = u("u_time"), uEnergy = u("u_energy"), uSeed = u("u_seed");
    const uCols = [u("u_c0"), u("u_c1"), u("u_c2"), u("u_c3"), u("u_c4")];

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uSeed, (seed % 1000) / 37);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let energy = 0;
    let frame = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = stateRef.current;
      const want = st === "speaking" ? 1 : st === "thinking" ? 0.7 : st === "listening" ? 0.45 : 0;
      energy += (want - energy) * Math.min(1, dt * 3);
      t += dt * speedRef.current * (1 + energy * 1.4) * (reduceMotion ? 0.15 : 1);

      if (frame++ % 2 === 0) {
        current.current = target.current.map((c, i) => {
          const cur = current.current[i] ?? c;
          return cur === c ? c : mix(cur, c, 0.06);
        });
      }
      const cols = current.current;
      cols.forEach((c, i) => uCols[i] && gl.uniform3fv(uCols[i], toVec(c)));
      gl.uniform1f(uTime, t);
      gl.uniform1f(uEnergy, energy);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (glowRef.current) {
        glowRef.current.style.transform = `scale(${0.92 + energy * 0.12 + Math.sin(t * 1.3) * 0.02})`;
        glowRef.current.style.background = `radial-gradient(circle, ${rgba(cols[1], 0.5)} 0%, ${rgba(cols[0], 0.22)} 42%, transparent 68%)`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [size, seed]);

  return (
    <div className="sphere" style={{ width: size, height: size }} aria-hidden="true">
      {glow && <div className="sphere-glow" ref={glowRef} />}
      {fallback ? (
        <div
          className="sphere-fallback"
          style={{
            background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.55), transparent 32%),
              radial-gradient(circle at 70% 35%, ${colors[1]}, transparent 55%),
              radial-gradient(circle at 40% 75%, ${colors[2]}, transparent 60%),
              radial-gradient(circle at 50% 50%, ${colors[0]}, ${colors[3]})`,
          }}
        />
      ) : (
        <canvas ref={canvasRef} style={{ width: size, height: size }} />
      )}
    </div>
  );
}
