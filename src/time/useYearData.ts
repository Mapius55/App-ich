// The calendar year for the Jahr level: minutes for goals per day (logged time plus
// past goal blocks nobody answered while they still count, goalDayMinutes), the days whose
// time is mostly provisional (drawn lighter), planned days, target days and the number of
// entries per day. Data path extracted from components/plan/YearView.tsx; optional
// filter to one goal.
import { useEffect, useMemo, useState } from "react";
import { backend } from "../lib/backend";
import { localMidnightIso } from "../lib/dates";
import { countsLikeBlock, dayOf, goalDayMinutes, heatThresholds, provisionalDays } from "../lib/plan";
import type { CalendarEvent, GoalTime } from "../lib/types";
import { usePlanData } from "../space/data";
import { whenStill } from "../space/motion";

export interface YearData {
  loaded: boolean;
  /** day → minutes for goals (filtered), provisional ones included */
  perDay: Record<string, number>;
  /** past days whose time is mostly provisional (blocks nobody answered yet): their heat is lighter */
  provisional: Set<string>;
  thresholds: [number, number, number];
  /** future days with a goal block (filtered) */
  planned: Set<string>;
  /** goals' target dates in this year (filtered) */
  targets: Set<string>;
  /** day → number of entries (all of them, for the month's dots) */
  entries: Record<string, number>;
}

const localDay = (iso: string) => dayOf(new Date(iso));

export function useYearData(year: number, goalId: string | null): YearData {
  const { goals, eventsVersion, planVersion } = usePlanData();
  const [raw, setRaw] = useState<{ year: number; log: GoalTime[]; events: CalendarEvent[]; from: string | null; at: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const y = String(year).padStart(4, "0");
    const next = String(year + 1).padStart(4, "0");
    Promise.all([
      backend.listGoalTime(`${y}-01-01`, `${y}-12-31`),
      backend.listEvents(localMidnightIso(`${y}-01-01`), localMidnightIso(`${next}-01-01`)),
      backend.countingFrom(),
    ])
      // (shown once the column rests: motion.ts)
      .then(([log, events, from]) => whenStill(() => alive && setRaw({ year, log, events, from, at: Date.now() })))
      .catch(() => whenStill(() => alive && setRaw({ year, log: [], events: [], from: null, at: Date.now() })));
    return () => {
      alive = false;
    };
  }, [year, eventsVersion, planVersion]);

  const data = raw && raw.year === year ? raw : null;

  const derived = useMemo(() => {
    const entries: Record<string, number> = {};
    const planned = new Set<string>();
    if (!data) return { perDay: {}, provisional: new Set<string>(), entries, planned };
    const answered = new Set(data.log.flatMap((t) => (t.event_id ? [t.event_id] : [])));
    const log = goalId ? data.log.filter((t) => t.goal_id === goalId) : data.log;
    const blocks = data.events.filter((e) => countsLikeBlock(e) && e.goal_id && (!goalId || e.goal_id === goalId));
    for (const e of data.events) {
      const d = localDay(e.starts_at);
      entries[d] = (entries[d] ?? 0) + 1;
    }
    for (const b of blocks) if (!b.all_day && b.ends_at && Date.parse(b.ends_at) > data.at) planned.add(localDay(b.starts_at));
    const minutes = goalDayMinutes(log, blocks, answered, new Date(data.at), localDay, data.from);
    return { perDay: minutes.total, provisional: provisionalDays(minutes), entries, planned };
  }, [data, goalId]);

  const targets = useMemo(() => {
    const prefix = `${String(year).padStart(4, "0")}-`;
    const out = new Set<string>();
    for (const g of goals ?? []) {
      if (!g.target_date?.startsWith(prefix)) continue;
      if (goalId ? g.id === goalId : g.status === "active" || g.status === "paused") out.add(g.target_date);
    }
    return out;
  }, [goals, year, goalId]);

  const thresholds = useMemo(() => heatThresholds(Object.values(derived.perDay)), [derived.perDay]);

  return { loaded: !!data, perDay: derived.perDay, provisional: derived.provisional, thresholds, planned: derived.planned, targets, entries: derived.entries };
}
