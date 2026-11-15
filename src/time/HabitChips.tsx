// Habit chips on Tag: tick a habit for the day shown. At most three chips, then
// "+N" → Ziele. Today "HEUTE ABHAKEN", a past day "GEWOHNHEITEN", hidden on future days.
import { useRef, useState } from "react";
import { daysBetween } from "../lib/plan";
import type { Habit } from "../lib/types";
import { planData, usePlanData } from "../space/data";
import { useFresh, useSeenWhenVisible } from "../space/fresh";
import { useSpace } from "../space/state";

const MAX = 3;

function Chip({ habit, day, done }: { habit: Habit; day: string; done: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const fresh = useFresh(habit.id);
  useSeenWhenVisible(ref, habit.id);
  const [ticked, setTicked] = useState(false);
  const toggle = () => {
    planData.toggleHabit(habit, day, !done);
    if (!done) {
      setTicked(true);
      setTimeout(() => setTicked(false), 260);
    }
  };
  return (
    <button
      ref={ref}
      type="button"
      className={`hc-chip${done ? " done" : ""}${ticked ? " ticked" : ""}${fresh ? " is-fresh" : ""}`}
      aria-pressed={done}
      aria-label={`${habit.title}${fresh ? ", neu vom Coach" : ""}`}
      onClick={toggle}
    >
      <span className="hc-dot" aria-hidden="true">
        {done && (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path className="hc-check" d="M5 12.5l4.2 4.2L19 7" />
          </svg>
        )}
      </span>
      <span className="hc-name">{habit.title}</span>
    </button>
  );
}

export function HabitChips({ day }: { day: string }) {
  const { today, go } = useSpace();
  const { habits } = usePlanData();
  const rel = daysBetween(today, day);
  const list = (habits ?? []).filter((h) => h.active);
  if (rel > 0 || !list.length) return null;
  const shown = list.slice(0, MAX);
  const more = list.length - shown.length;
  return (
    <div className="hc">
      <p className="hc-label">{rel === 0 ? "Heute abhaken" : "Gewohnheiten"}</p>
      <div className="hc-chips">
        {shown.map((h) => (
          <Chip key={h.id} habit={h} day={day} done={h.done_days.includes(day)} />
        ))}
        {more > 0 && (
          <button type="button" className="hc-chip hc-more" onClick={() => go("ziele")} aria-label={`${more} weitere Gewohnheiten bei den Zielen`}>
            +{more}
          </button>
        )}
      </div>
    </div>
  );
}
