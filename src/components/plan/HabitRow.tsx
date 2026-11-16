import { habitStreak, habitWeek, streakLabel } from "../../lib/plan";
import { longDay, weekdayShort } from "../../lib/dates";
import type { Habit } from "../../lib/types";
import { IconCheck } from "./icons";
import { habitMetaParts } from "../../places/habitMeta";

interface Props {
  habit: Habit;
  goalTitle: string | null;
  today: string;
  onOpen: () => void;
  onToggle: (day: string, done: boolean) => void;
}

export function HabitRow({ habit, goalTitle, today, onOpen, onToggle }: Props) {
  const week = habitWeek(habit, today);
  const streak = streakLabel(habitStreak(habit, today));
  const reached = week.doneThisWeek >= week.target;
  const meta = habitMetaParts({ done: week.doneThisWeek, target: week.target, streak });

  return (
    <li className="habit">
      <button type="button" className="habit-head" onClick={onOpen} aria-label={`Gewohnheit bearbeiten: ${habit.title}`}>
        <span className="habit-title">{habit.title}</span>
        {meta.length > 0 && (
          <span className="habit-meta">
            {meta.map((m, i) => (
              <span key={m.key} className={m.key === "week" && reached ? "reached" : ""}>
                {i > 0 && " · "}
                {m.text}
              </span>
            ))}
          </span>
        )}
        {goalTitle && <span className="habit-goal">{goalTitle}</span>}
      </button>
      <div className="habit-days" role="group" aria-label={`${habit.title}, diese Woche`}>
        {week.days.map((d) => {
          const isToday = d.day === today;
          return (
            <button
              key={d.day}
              type="button"
              role="checkbox"
              aria-checked={d.done}
              aria-label={`${longDay(d.day)}${isToday ? " (heute)" : ""}`}
              className={`habit-day ${d.done ? "done" : ""} ${isToday ? "today" : ""}`}
              disabled={d.future}
              onClick={() => onToggle(d.day, !d.done)}
            >
              <span className="habit-day-letter" aria-hidden="true">
                {weekdayShort(d.day)}
              </span>
              <span className="check-circle small">
                <IconCheck size={12} />
              </span>
            </button>
          );
        })}
      </div>
    </li>
  );
}
