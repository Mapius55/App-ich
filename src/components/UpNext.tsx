import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import type { CalendarEvent } from "../lib/types";

// "Als Nächstes": the next appointments of the coming week, under the greeting.
export function UpNext({ refresh }: { refresh: number }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    let alive = true;
    backend
      .listEvents()
      .then((ev) => {
        if (!alive) return;
        const now = new Date();
        const endWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8);
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        setEvents(
          ev
            .filter((e) => {
              const d = new Date(e.starts_at);
              // timed: not over yet (30 min grace); all-day: from today on
              return e.all_day ? d >= startToday && d < endWeek : d.getTime() > now.getTime() - 30 * 60e3 && d < endWeek;
            })
            .slice(0, 3),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refresh]);

  if (!events.length) return null;
  const now = new Date();
  const dayLabel = (d: Date) => {
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
    if (diff === 0) return "Heute";
    if (diff === 1) return "Morgen";
    return new Intl.DateTimeFormat("de-CH", { weekday: "short" }).format(d);
  };
  return (
    <ul className="up-next" aria-label="Als Nächstes">
      {events.map((e) => {
        const d = new Date(e.starts_at);
        const day = dayLabel(d);
        const time = e.all_day ? "" : ` ${new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(d)}`;
        return (
          <li key={e.id} className="up-next-item">
            <span className="up-next-when">
              {day}
              {time}
            </span>
            <span className="up-next-title">{e.title}</span>
          </li>
        );
      })}
    </ul>
  );
}
