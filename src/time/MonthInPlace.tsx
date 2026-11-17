// A month of Jahr, opened in place: the tapped mini month grows (FLIP, 360 ms) into a
// 7-column grid of 48 px days with heat, rings and up to three entry dots. Tap a day
// → Tag. Folding back runs the FLIP in reverse into the mini month.
import { useLayoutEffect, useRef } from "react";
import { daySubline, spokenMinutes } from "../lib/dates";
import { heatLevel, monthGrid } from "../lib/plan";
import type { YearData } from "./useYearData";

const WD = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];
const FLIP_MS = 360;
const EASE_OUT = "cubic-bezier(.2,.75,.2,1)";
const EASE_IO = "cubic-bezier(.6,0,.2,1)";

export interface MonthInPlaceProps {
  month: string; // YYYY-MM
  label: string; // "November 2026"
  today: string;
  data: YearData;
  /** the mini month it grows from and folds back into */
  origin: HTMLElement | null;
  closing: boolean;
  reduced: boolean;
  onClosed(): void;
  onDay(day: string): void;
}

/** the transform that puts `el` (laid out at `to`) onto the rect `from` */
function flipFrom(from: DOMRect, to: DOMRect): string {
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

export function MonthInPlace({ month, label, today, data, origin, closing, reduced, onClosed, onDay }: MonthInPlaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  // open: grow from the mini month
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const o = origin?.getBoundingClientRect();
    if (reduced || !o || !o.width) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
      return;
    }
    el.animate([{ transform: flipFrom(o, el.getBoundingClientRect()), opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: FLIP_MS, easing: EASE_OUT });
    // only on mount: a month stepped by the arrow keys just swaps its content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fold: shrink back into the mini month, then let the parent unmount
  useLayoutEffect(() => {
    if (!closing) return;
    const el = ref.current;
    const done = () => onClosedRef.current();
    if (!el || typeof el.animate !== "function") return done();
    const o = origin?.getBoundingClientRect();
    const a =
      reduced || !o || !o.width
        ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 120 : 200, fill: "forwards" })
        : el.animate([{ transform: "none", opacity: 1 }, { transform: flipFrom(o, el.getBoundingClientRect()), opacity: 0 }], { duration: FLIP_MS, easing: EASE_IO, fill: "forwards" });
    a.finished.then(done, done);
  }, [closing, origin, reduced]);

  const cells = monthGrid(`${month}-01`);
  return (
    <div className="mo" ref={ref}>
      <div className="mo-wd" aria-hidden="true">
        {WD.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mo-grid" role="group" aria-label={label}>
        {cells.map(({ day, inMonth }) => {
          if (!inMonth) return <span key={day} className="mo-out" aria-hidden="true" />;
          const future = day > today;
          const m = data.perDay[day] ?? 0;
          const n = data.entries[day] ?? 0;
          const level = future ? 0 : heatLevel(m, data.thresholds);
          const cls = [
            "mo-day",
            `l${level}`,
            future && "future",
            day === today && "today",
            !future && day !== today && level > 0 && data.provisional.has(day) && "prov",
            future && data.planned.has(day) && "planned",
            data.targets.has(day) && "target",
          ]
            .filter(Boolean)
            .join(" ");
          const aria = `${daySubline(day, today)}: ${m ? `${spokenMinutes(m)} für Ziele${data.provisional.has(day) ? ", vorläufig" : ""}` : "keine Zeit für Ziele"}${n ? `, ${n} ${n === 1 ? "Eintrag" : "Einträge"}` : ""}${data.planned.has(day) && future ? ", geplant" : ""}${data.targets.has(day) ? ", Zieltag" : ""}. Tag öffnen`;
          return (
            <button key={day} type="button" className={cls} data-day={day} aria-label={aria} aria-current={day === today ? "date" : undefined} onClick={() => onDay(day)}>
              <span className="mo-num">{Number(day.slice(8))}</span>
              <span className="mo-dots" aria-hidden="true">
                {Array.from({ length: Math.min(3, n) }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
