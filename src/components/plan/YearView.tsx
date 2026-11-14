import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { addDays, dayMinutes, dayOf, heatLevel, heatThresholds, yearWeeks } from "../../lib/plan";
import { longDay, minutesLabel } from "../../lib/dates";
import type { CalendarEvent, Goal, GoalTime } from "../../lib/types";

// The year at a glance: one small square per day for the last 53 weeks.
// A day without time for goals stays empty (just a fine outline); the more
// time went into goals, the stronger it glows in today's accent colour.
// Tap a day to see what it was.

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WEEKDAYS = ["Mo", "", "Mi", "", "Fr", "", ""];

interface Props {
  goals: Goal[];
  today: string;
  /** bumps when time or blocks may have changed */
  refresh: number;
}

export function YearView({ goals, today, refresh }: Props) {
  const weeks = useMemo(() => yearWeeks(today), [today]);
  const from = weeks[0][0];
  const [data, setData] = useState<{ log: GoalTime[]; blocks: CalendarEvent[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const startIso = new Date(`${from}T00:00:00`).toISOString();
    const endIso = new Date(`${addDays(today, 1)}T00:00:00`).toISOString();
    Promise.all([backend.listGoalTime(from, today), backend.listEvents(startIso, endIso)])
      .then(([log, events]) => alive && setData({ log, blocks: events.filter((e) => e.kind === "block" && e.goal_id) }))
      .catch(() => alive && setData({ log: [], blocks: [] }));
    return () => {
      alive = false;
    };
  }, [from, today, refresh]);

  // start at the right end: this week
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data]);

  const perDay = useMemo(() => {
    if (!data) return {};
    const answered = new Set(data.log.flatMap((t) => (t.event_id ? [t.event_id] : [])));
    return dayMinutes(data.log, data.blocks, answered, new Date(), (iso) => dayOf(new Date(iso)));
  }, [data]);

  const thresholds = useMemo(() => heatThresholds(Object.values(perDay)), [perDay]);
  const total = Object.values(perDay).reduce((a, b) => a + b, 0);
  const activeDays = Object.values(perDay).filter((m) => m > 0).length;

  // what went into the selected day, per goal
  const detail = useMemo(() => {
    if (!selected || !data) return null;
    const byGoal = new Map<string, number>();
    const answered = new Set(data.log.flatMap((t) => (t.event_id ? [t.event_id] : [])));
    for (const t of data.log) if (t.day === selected && t.minutes > 0) byGoal.set(t.goal_id, (byGoal.get(t.goal_id) ?? 0) + t.minutes);
    for (const b of data.blocks) {
      if (answered.has(b.id) || b.all_day || !b.ends_at || !b.goal_id || dayOf(new Date(b.starts_at)) !== selected) continue;
      if (Date.parse(b.ends_at) > Date.now()) continue;
      const m = Math.min(1440, Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000));
      byGoal.set(b.goal_id, (byGoal.get(b.goal_id) ?? 0) + m);
    }
    return [...byGoal.entries()]
      .map(([id, m]) => ({ title: goals.find((g) => g.id === id)?.title ?? "Ziel", minutes: m }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [selected, data, goals]);

  return (
    <div className="year">
      <p className="year-summary">
        {data === null
          ? " "
          : activeDays
            ? `${minutesLabel(total)} für deine Ziele an ${activeDays} ${activeDays === 1 ? "Tag" : "Tagen"}`
            : "Noch keine Zeit für Ziele eingetragen. Jeder Tag mit Training oder Lernzeit leuchtet hier auf."}
      </p>

      <div className="year-body">
      <div className="year-weekdays" aria-hidden="true">
        <span className="year-month-label" />
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="year-scroll" ref={scroller}>
        <div className="year-grid" role="grid" aria-label="Deine letzten 12 Monate, ein Feld pro Tag">
          {weeks.map((week, wi) => {
            // the month's name above the week with its 1st (and above the first column,
            // unless the next month starts too close to fit both)
            const firstOfMonth = week.find((d) => d.endsWith("-01"));
            const nextFirstSoon = weeks.slice(1, 3).some((w) => w.some((d) => d.endsWith("-01")));
            const monthDay = firstOfMonth ?? (wi === 0 && !nextFirstSoon ? week[0] : null);
            return (
              <div className="year-week" role="row" key={week[0]}>
                <span className="year-month-label" aria-hidden="true">
                  {monthDay ? MONTHS[Number(monthDay.slice(5, 7)) - 1] : ""}
                </span>
                {week.map((d) => {
                  const future = d > today;
                  const m = perDay[d] ?? 0;
                  const level = future ? 0 : heatLevel(m, thresholds);
                  return (
                    <button
                      key={d}
                      type="button"
                      role="gridcell"
                      className={`year-day l${level}${future ? " future" : ""}${d === today ? " today" : ""}${d === selected ? " selected" : ""}`}
                      disabled={future}
                      aria-label={`${longDay(d)}: ${m ? minutesLabel(m) : "keine Zeit für Ziele"}`}
                      aria-pressed={d === selected}
                      onClick={() => setSelected(d === selected ? null : d)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      </div>

      <div className="year-legend" aria-hidden="true">
        <span>weniger</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`year-day l${l}`} />
        ))}
        <span>mehr</span>
      </div>

      {selected && (
        <div className="year-detail" role="status">
          <span className="year-detail-day">{longDay(selected)}</span>
          {detail && detail.length ? (
            <ul>
              {detail.map((x) => (
                <li key={x.title}>
                  <span>{x.title}</span>
                  <span>{minutesLabel(x.minutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="year-detail-empty">Ein freier Tag.</span>
          )}
        </div>
      )}
    </div>
  );
}
