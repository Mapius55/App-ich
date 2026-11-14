import { habitStreak, habitWeek, streakLabel } from "../../lib/plan";
import { longDay, weekdayShort } from "../../lib/dates";
import type { Habit } from "../../lib/types";
import { IconCheck } from "./icons";

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

  return (
    <li className="habit">
      <button type="button" className="habit-head" onClick={onOpen} aria-label={`Gewohnheit bearbeiten: ${habit.title}`}>
        <span className="habit-title">{habit.title}</span>
        <span className="habit-meta">
          <span className={reached ? "reached" : ""}>
            {week.doneThisWeek} von {week.target} diese Woche
          </span>
          {streak && <span> · {streak}</span>}
        </span>
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
