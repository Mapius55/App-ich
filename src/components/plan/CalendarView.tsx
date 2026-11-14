import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { addDays, addMonths, dayOf, daysBetween, monthGrid, monthStart, weekDays } from "../../lib/plan";
import { localMidnightIso, longDay, monthTitle, timeHM, weekdayShort } from "../../lib/dates";
import type { CalendarEvent, Goal } from "../../lib/types";
import { EventSheet } from "./EventSheet";
import { IconChevron, IconPlus } from "./icons";

type Mode = "week" | "month";

const MODE_KEY = "ich.plan.calendarMode";
function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "month" ? "month" : "week";
  } catch {
    return "week";
  }
}

function relativeDay(day: string, today: string): string | null {
  const d = daysBetween(today, day);
  return d === 0 ? "Heute" : d === 1 ? "Morgen" : d === -1 ? "Gestern" : null;
}

const byStart = (a: CalendarEvent, b: CalendarEvent) => (a.all_day === b.all_day ? a.starts_at.localeCompare(b.starts_at) : a.all_day ? -1 : 1);

interface Props {
  goals: Goal[];
  today: string;
  /** bumped when the coach changed entries */
  refresh: number;
}

export function CalendarView({ goals, today, refresh }: Props) {
  const [mode, setMode] = useState<Mode>(storedMode);
  const [selected, setSelected] = useState(today);
  const [dir, setDir] = useState(0); // which way the last move went, for the slide
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);

  const cells = useMemo(
    () => (mode === "week" ? weekDays(selected).map((day) => ({ day, inMonth: true })) : monthGrid(selected)),
    [mode, selected],
  );
  const from = cells[0].day;
  const to = addDays(cells[cells.length - 1].day, 1);

  useEffect(() => {
    let alive = true;
    backend
      .listEvents(localMidnightIso(from), localMidnightIso(to))
      .then((ev) => {
        if (!alive) return;
        setEvents(ev);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [from, to, refresh, version]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      const d = dayOf(new Date(e.starts_at));
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    for (const list of m.values()) list.sort(byStart);
    return m;
  }, [events]);

  const goalTitle = useMemo(() => new Map(goals.map((g) => [g.id, g.title])), [goals]);

  const chooseMode = (m: Mode) => {
    setMode(m);
    setDir(0);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage unavailable */
    }
  };

  const move = (n: number) => {
    setDir(n);
    if (mode === "week") return setSelected((s) => addDays(s, 7 * n));
    const first = addMonths(monthStart(selected), n);
    setSelected(monthStart(today) === first ? today : first);
  };

  const select = (day: string) => {
    setDir(daysBetween(selected, day) > 0 ? 1 : -1);
    setSelected(day);
  };

  // a horizontal swipe over the days moves on, like turning a page
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  };

  const dayItems = byDay.get(selected) ?? [];
  const rel = relativeDay(selected, today);

  const dots = (day: string) => {
    const list = byDay.get(day) ?? [];
    if (!list.length) return <span className="cal-dots" aria-hidden="true" />;
    return (
      <span className="cal-dots" aria-hidden="true">
        {list.slice(0, 3).map((e) => (
          <span key={e.id} className={`cal-dot ${e.kind === "block" ? "block" : ""}`} />
        ))}
      </span>
    );
  };

  const dayLabel = (day: string) => {
    const n = byDay.get(day)?.length ?? 0;
    return `${longDay(day)}${day === today ? ", heute" : ""}${n ? `, ${n} ${n === 1 ? "Eintrag" : "Einträge"}` : ""}`;
  };

  return (
    <div className="cal">
      <div className="cal-controls">
        <div className="segmented" role="radiogroup" aria-label="Ansicht">
          <button type="button" role="radio" aria-checked={mode === "week"} className={mode === "week" ? "on" : ""} onClick={() => chooseMode("week")}>
            Woche
          </button>
          <button type="button" role="radio" aria-checked={mode === "month"} className={mode === "month" ? "on" : ""} onClick={() => chooseMode("month")}>
            Monat
          </button>
        </div>
        <button type="button" className="pill cal-today" onClick={() => select(today)} disabled={selected === today} aria-label="Zu heute springen">
          Heute
        </button>
      </div>

      <div className="cal-head">
        <button type="button" className="dock-round small" onClick={() => move(-1)} aria-label={mode === "week" ? "Vorherige Woche" : "Vorheriger Monat"}>
          <IconChevron dir="left" />
        </button>
        <h3 className="cal-month" aria-live="polite">
          {monthTitle(selected)}
        </h3>
        <button type="button" className="dock-round small" onClick={() => move(1)} aria-label={mode === "week" ? "Nächste Woche" : "Nächster Monat"}>
          <IconChevron dir="right" />
        </button>
      </div>

      <div className="cal-swipe" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {mode === "week" ? (
          <div key={`w-${from}`} className={`cal-week cal-swap ${dir > 0 ? "from-right" : dir < 0 ? "from-left" : ""}`} role="group" aria-label="Tage der Woche">
            {cells.map(({ day }) => (
              <button
                key={day}
                type="button"
                className={`cal-chip ${day === selected ? "selected" : ""} ${day === today ? "today" : ""}`}
                aria-pressed={day === selected}
                aria-current={day === today ? "date" : undefined}
                aria-label={dayLabel(day)}
                onClick={() => select(day)}
              >
                <span className="cal-chip-wd">{weekdayShort(day)}</span>
                <span className="cal-num">{Number(day.slice(8))}</span>
                {dots(day)}
              </button>
            ))}
          </div>
        ) : (
          <div key={`m-${monthStart(selected)}`} className={`cal-month-grid cal-swap ${dir > 0 ? "from-right" : dir < 0 ? "from-left" : ""}`}>
            <div className="cal-wd-row" aria-hidden="true">
              {cells.slice(0, 7).map(({ day }) => (
                <span key={day}>{weekdayShort(day)}</span>
              ))}
            </div>
            <div className="cal-grid" role="group" aria-label={monthTitle(selected)}>
              {cells.map(({ day, inMonth }) => (
                <button
                  key={day}
                  type="button"
                  className={`cal-cell ${inMonth ? "" : "out"} ${day === selected ? "selected" : ""} ${day === today ? "today" : ""}`}
                  aria-pressed={day === selected}
                  aria-current={day === today ? "date" : undefined}
                  aria-label={dayLabel(day)}
                  onClick={() => select(day)}
                >
                  <span className="cal-num">{Number(day.slice(8))}</span>
                  {dots(day)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="agenda">
        <div className="agenda-head">
          <h3 className="agenda-day">
            {rel && <span className="agenda-rel">{rel}</span>}
            <span>{longDay(selected)}</span>
          </h3>
          <button type="button" className="dock-main small" onClick={() => setEditing("new")} aria-label={`Eintrag am ${longDay(selected)} hinzufügen`}>
            <IconPlus size={20} />
          </button>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <ul key={selected} className="agenda-list">
          {events && dayItems.length === 0 && <li className="agenda-empty">Nichts eingetragen.</li>}
          {dayItems.map((e) => {
            const goal = e.goal_id ? goalTitle.get(e.goal_id) : null;
            const time = e.all_day ? null : timeHM(e.starts_at);
            const endTime = !e.all_day && e.ends_at ? timeHM(e.ends_at) : null;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={`agenda-item ${e.kind === "block" ? "block" : ""}`}
                  onClick={() => setEditing(e)}
                  aria-label={`${e.title}, ${e.all_day ? "ganztägig" : `${time}${endTime ? ` bis ${endTime}` : ""}`}${e.kind === "block" ? ", Block" : ""}${goal ? `, Ziel ${goal}` : ""}. Bearbeiten`}
                >
                  <span className="agenda-time">
                    {e.all_day ? (
                      "Ganztags"
                    ) : (
                      <>
                        <span>{time}</span>
                        {endTime && <span className="agenda-end">{endTime}</span>}
                      </>
                    )}
                  </span>
                  <span className="agenda-body">
                    <span className="agenda-title">{e.title}</span>
                    {(e.kind === "block" || e.location || goal) && (
                      <span className="agenda-meta">
                        {e.kind === "block" && <span className="agenda-tag">Block</span>}
                        {e.location && <span className="agenda-where">{e.location}</span>}
                        {/* the race day itself is often named like its goal */}
                        {goal && <span className="agenda-goal">{goal === e.title ? "Ziel" : goal}</span>}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {editing && (
        <EventSheet
          event={editing === "new" ? null : editing}
          day={selected}
          goals={goals}
          onClose={() => setEditing(null)}
          onChanged={(day) => {
            setVersion((v) => v + 1);
            if (day && day !== selected) select(day); // follow an entry moved to another day
          }}
        />
      )}
    </div>
  );
}
