// The last 14 (or 7) WHOOP days as a calm strip: three thin bar rows (Erholung, Schlaf, Belastung), one hue,
// the newest value on the right. Tap a day to read its values; the rows carry spoken summaries.
import { useState } from "react";
import { shortDay } from "../../lib/dates";
import { average, latest, sleepLabel, strainLabel, whoopStrip, type StripDay } from "../../lib/connections";
import type { WhoopDay } from "../../lib/types";

type Key = "recovery" | "sleep" | "strain";
interface Metric {
  key: Key;
  label: string;
  max: number;
  text(v: number): string;
  spoken(v: number): string;
}
const METRICS: Metric[] = [
  { key: "recovery", label: "Erholung", max: 100, text: (v) => `${Math.round(v)} %`, spoken: (v) => `${Math.round(v)} Prozent` },
  { key: "sleep", label: "Schlaf", max: 600, text: (v) => sleepLabel(v) ?? "–", spoken: (v) => `${Math.floor(v / 60)} Stunden ${Math.round(v % 60)}` },
  { key: "strain", label: "Belastung", max: 21, text: (v) => strainLabel(v) ?? "–", spoken: (v) => (strainLabel(v) ?? "").replace(".", " Komma ") },
];

export function WhoopStrip({ days, today, n = 14 }: { days: WhoopDay[]; today: string; n?: number }) {
  const strip = whoopStrip(days, today, n);
  const [sel, setSel] = useState<number | null>(null);
  const pick = (i: number) => setSel((s) => (s === i ? null : i));
  const shown: StripDay | null = sel === null ? null : strip[sel];

  return (
    <div className="cx-strip">
      <p className="cx-strip-head">
        <span className="pl-label">{shown ? (shown.day === today ? "Heute" : shortDay(shown.day)) : `Letzte ${n} Tage`}</span>
        {shown && (
          <button type="button" className="cx-strip-reset" onClick={() => setSel(null)}>
            Zurück
          </button>
        )}
      </p>
      {METRICS.map((m) => {
        const last = latest(strip, m.key);
        const avg = average(strip, m.key);
        const value = shown ? shown[m.key] : (last?.value ?? null);
        const summary = last
          ? `${m.label}: ${last.day === today ? "heute" : `zuletzt am ${shortDay(last.day)}`} ${m.spoken(last.value)}${avg !== null ? `, im Schnitt der ${n} Tage ${m.spoken(avg)}` : ""}`
          : `${m.label}: noch keine Werte`;
        return (
          <div key={m.key} className="cx-metric">
            <span className="cx-metric-label">{m.label}</span>
            <span className="cx-bars" role="img" aria-label={summary}>
              {strip.map((d, i) => {
                const v = d[m.key];
                const h = v === null ? 0 : Math.max(0.08, Math.min(1, v / m.max));
                return (
                  <span
                    key={d.day}
                    className={`cx-bar${v === null ? " gap" : ""}${i === strip.length - 1 ? " last" : ""}${sel === i ? " sel" : ""}`}
                    onClick={() => pick(i)}
                    aria-hidden="true"
                  >
                    <span style={{ height: v === null ? undefined : `${Math.round(h * 100)}%` }} />
                  </span>
                );
              })}
            </span>
            <span className="cx-metric-value" aria-hidden="true">
              {value === null ? "–" : m.text(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
