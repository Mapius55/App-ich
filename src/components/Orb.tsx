import { useEffect, useRef } from "react";
import { mix, rgba } from "../lib/color";
import { seededRandom } from "../lib/palette";

export type OrbState = "idle" | "speaking" | "thinking" | "listening";

interface Props {
  colors: string[];
  size: number;
  speed?: number;
  seed?: number;
  state?: OrbState;
  glow?: boolean;
}

interface Blob {
  colorIndex: number;
  orbit: number; // distance from centre, fraction of radius
  radius: number; // blob radius, fraction of radius
  phase: number;
  angularSpeed: number;
  wobble: number;
}

function makeBlobs(seed: number): Blob[] {
  const rand = seededRandom(String(seed));
  const blobs: Blob[] = [];
  for (let i = 0; i < 7; i++) {
    blobs.push({
      colorIndex: i % 5,
      orbit: 0.25 + rand() * 0.45,
      radius: 0.55 + rand() * 0.45,
      phase: rand() * Math.PI * 2,
      angularSpeed: (0.12 + rand() * 0.22) * (i % 2 === 0 ? 1 : -1),
      wobble: 0.08 + rand() * 0.12,
    });
  }
  return blobs;
}

/**
 * A softly glowing sphere: colour blobs drift around the centre, clipped to a
 * circle. Colours glide to new values instead of jumping, so a change in time
 * of day, weather or mood feels like light changing in the sky.
 */
export function Orb({ colors, size, speed = 1, seed = 1, state = "idle", glow = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef(colors);
  const current = useRef<string[]>(colors);
  const stateRef = useRef(state);
  const speedRef = useRef(speed);
  const blobs = useRef(makeBlobs(seed));
  const glowRef = useRef<HTMLDivElement>(null);

  target.current = colors;
  stateRef.current = state;
  speedRef.current = speed;

  useEffect(() => {
    blobs.current = makeBlobs(seed);
  }, [seed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let energy = 0; // smoothed "activity" level for speaking/thinking
    let frame = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = stateRef.current;
      const wantEnergy = st === "speaking" ? 1 : st === "thinking" ? 0.7 : st === "listening" ? 0.45 : 0;
      energy += (wantEnergy - energy) * Math.min(1, dt * 3);
      const motion = reduceMotion ? 0.15 : 1;
      t += dt * speedRef.current * (1 + energy * 1.6) * motion;

      // Glide colours toward target (cheap: every 2nd frame)
      if (frame++ % 2 === 0) {
        current.current = target.current.map((c, i) => {
          const cur = current.current[i] ?? c;
          return cur === c ? c : mix(cur, c, 0.06);
        });
      }
      const cols = current.current;

      const R = size / 2;
      const breathe = 1 + Math.sin(t * 1.3) * 0.012 + energy * Math.sin(t * 6.5) * 0.02;
      const r = R * 0.94 * breathe;

      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, r, 0, Math.PI * 2);
      ctx.clip();

      // base wash
      const base = ctx.createLinearGradient(0, 0, size, size);
      base.addColorStop(0, cols[0]);
      base.addColorStop(1, cols[2]);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);

      // drifting colour blobs
      for (const b of blobs.current) {
        const a = b.phase + t * b.angularSpeed * (1 + energy * 0.8);
        const orbit = r * (b.orbit + Math.sin(t * 0.7 + b.phase) * b.wobble);
        const x = R + Math.cos(a) * orbit;
        const y = R + Math.sin(a) * orbit;
        const br = r * b.radius;
        const g = ctx.createRadialGradient(x, y, 0, x, y, br);
        const c = cols[b.colorIndex];
        g.addColorStop(0, rgba(c, 1));
        g.addColorStop(0.5, rgba(c, 0.7));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }

      // soft light from the upper left
      const hl = ctx.createRadialGradient(R - r * 0.35, R - r * 0.45, 0, R - r * 0.35, R - r * 0.45, r * 0.9);
      hl.addColorStop(0, "rgba(255,255,255,0.2)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.fillRect(0, 0, size, size);

      // gentle depth at the rim
      const rim = ctx.createRadialGradient(R, R, r * 0.62, R, R, r);
      rim.addColorStop(0, "rgba(0,0,0,0)");
      rim.addColorStop(1, rgba(cols[3], 0.35));
      ctx.fillStyle = rim;
      ctx.fillRect(0, 0, size, size);

      ctx.restore();

      if (glowRef.current) {
        glowRef.current.style.transform = `scale(${0.9 + energy * 0.12 + Math.sin(t * 1.3) * 0.02})`;
        glowRef.current.style.background = `radial-gradient(circle, ${rgba(cols[1], 0.55)} 0%, ${rgba(cols[3], 0.25)} 45%, transparent 70%)`;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <div className="orb" style={{ width: size, height: size }} aria-hidden="true">
      {glow && <div className="orb-glow" ref={glowRef} />}
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
    </div>
  );
}
