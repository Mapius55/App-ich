// One habit in Ziele (§3.5): name (→ habit Unfold), "2 von 3 diese Woche" (from the first one
// done, never "0 von 7"), the streak, and seven tickable dots Mo–So for this week.
import { useRef } from "react";
import { habitStreak, habitWeek, streakLabel } from "../lib/plan";
import { longDay, weekdayShort } from "../lib/dates";
import type { Habit } from "../lib/types";
import { IconCheck } from "../components/plan/icons";
import { planData } from "../space/data";
import { useFresh, useSeenWhenVisible } from "../space/fresh";
import { useSpace } from "../space/state";
import { habitMetaParts } from "./habitMeta";
import { useRevealWhenFresh } from "./reveal";

export function HabitWeekRow({ habit, today, goalTitle, flash, active }: { habit: Habit; today: string; goalTitle: string | null; flash: boolean; active: boolean }) {
  const { open, reduced } = useSpace();
  const ref = useRef<HTMLLIElement>(null);
  const fresh = useFresh(habit.id);
  useSeenWhenVisible(ref, habit.id);
  useRevealWhenFresh(ref, fresh, active, reduced);
  const week = habitWeek(habit, today);
  const streak = streakLabel(habitStreak(habit, today));
  const reached = week.doneThisWeek >= week.target;
  const meta = habitMetaParts({ done: week.doneThisWeek, target: week.target, streak, goal: goalTitle });

  return (
    <li ref={ref} data-id={habit.id} className={`hw${fresh ? " is-fresh" : ""}${flash ? " is-flash" : ""}`}>
      <div className="hw-head">
        <button type="button" className="hw-name" onClick={() => open({ kind: "habit", habit }, ref.current)} aria-label={`Gewohnheit bearbeiten: ${habit.title}${fresh ? ", neu vom Coach" : ""}`}>
          {habit.title}
          {fresh && (
            <span className="fresh-tag" aria-hidden="true">
              neu
            </span>
          )}
        </button>
        {meta.length > 0 && (
          <p className="hw-meta">
            {meta.map((m, i) => (
              <span key={m.key} className={m.key === "week" ? (reached ? "reached" : "") : m.key === "goal" ? "hw-goal" : undefined}>
                {i > 0 && " · "}
                {m.text}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="hw-days" role="group" aria-label={`${habit.title}, diese Woche`}>
        {week.days.map((d) => {
          const isToday = d.day === today;
          return (
            <button
              key={d.day}
              type="button"
              aria-pressed={d.done}
              aria-label={`${habit.title}, ${longDay(d.day)}${isToday ? ", heute" : ""}${d.done ? ", erledigt" : ""}`}
              className={`hw-day${d.done ? " done" : ""}${isToday ? " today" : ""}`}
              disabled={d.future}
              onClick={() => planData.toggleHabit(habit, d.day, !d.done)}
            >
              <span className="hw-dot" aria-hidden="true">
                {d.done ? <IconCheck size={13} /> : weekdayShort(d.day)}
              </span>
            </button>
          );
        })}
      </div>
    </li>
  );
}
