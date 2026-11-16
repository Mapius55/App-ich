// Calendar entries of a day range, the answers for past goal blocks and (optionally)
// the time logged for goals. Logic extracted from components/plan/CalendarView.tsx
// (which stays untouched for the flag-off path). A small cache keyed by range shows
// a range at once when paging back and forth, and lets a level prefetch the next one.
import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import { localMidnightIso } from "../lib/dates";
import { addDays } from "../lib/plan";
import type { CalendarEvent, GoalTime } from "../lib/types";
import { planData, usePlanData } from "../space/data";
import { whenStill } from "../space/motion";

/** event_id → minutes (0 = didn't happen); a missing id counts as planned */
export type Answers = Record<string, number>;

export interface RangeSnapshot {
  events: CalendarEvent[];
  answers: Answers;
  log: GoalTime[] | null;
}

export interface RangeData {
  /** null until the range was loaded once */
  events: CalendarEvent[] | null;
  answers: Answers;
  /** goal time in the range (only with `goalTime`) */
  log: GoalTime[] | null;
  error: string | null;
  /** "Ja" / "Nein" for a past goal block; null takes the answer back */
  answer(e: CalendarEvent, done: boolean | null): void;
}

/** planned minutes of a block that serves a goal and is over (it counts for the goal by itself), else null */
export function pastBlockMinutes(e: CalendarEvent, now: number): number | null {
  if (e.kind !== "block" || !e.goal_id || e.all_day || !e.ends_at) return null;
  const end = Date.parse(e.ends_at);
  return end <= now ? Math.round((end - Date.parse(e.starts_at)) / 60000) : null;
}

const cache = new Map<string, { version: string; data: RangeSnapshot }>();
const CACHE_MAX = 24;

/** forget everything (a new Space mount may be another user) */
export function clearRangeCache(): void {
  cache.clear();
}

const keyOf = (from: string, to: string, goalTime: boolean) => `${from}|${to}|${goalTime ? 1 : 0}`;

async function fetchRange(from: string, to: string, goalTime: boolean): Promise<RangeSnapshot> {
  const [events, log] = await Promise.all([
    backend.listEvents(localMidnightIso(from), localMidnightIso(to)),
    goalTime ? backend.listGoalTime(from, addDays(to, -1)) : Promise.resolve(null),
  ]);
  const now = Date.now();
  const ids = events.filter((e) => pastBlockMinutes(e, now) !== null).map((e) => e.id);
  const answers = ids.length ? await backend.blockAnswers(ids) : {};
  return { events, answers, log };
}

function remember(key: string, version: string, data: RangeSnapshot): void {
  cache.delete(key);
  cache.set(key, { version, data });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/** load a range into the cache in the background (e.g. the next day while the current one animates out) */
export function prefetchRange(from: string, to: string, goalTime = false): void {
  const s = planData.get();
  const version = `${s.eventsVersion}.${goalTime ? s.planVersion : 0}`;
  const key = keyOf(from, to, goalTime);
  if (cache.get(key)?.version === version) return;
  fetchRange(from, to, goalTime)
    .then((data) => remember(key, version, data))
    .catch(() => {});
}

/** entries in [from, to) (days, `to` exclusive) */
export function useRangeEvents(from: string, to: string, o: { goalTime?: boolean } = {}): RangeData {
  const goalTime = !!o.goalTime;
  const { eventsVersion, planVersion } = usePlanData();
  const version = `${eventsVersion}.${goalTime ? planVersion : 0}`;
  const key = keyOf(from, to, goalTime);
  const [state, setState] = useState<{ key: string; data: RangeSnapshot } | null>(() => {
    const hit = cache.get(key);
    return hit ? { key, data: hit.data } : null;
  });
  const [error, setError] = useState<string | null>(null);
  // answers being saved right now win over what a load brings back meanwhile
  const pending = useRef(new Map<string, number | null>());

  useEffect(() => {
    let alive = true;
    const hit = cache.get(key);
    if (hit) setState((s) => (s?.key === key && s.data === hit.data ? s : { key, data: hit.data }));
    if (hit?.version === version) return;
    fetchRange(from, to, goalTime)
      .then((data) => {
        if (!alive) return;
        const answers = { ...data.answers };
        for (const [id, v] of pending.current) {
          if (v === null) delete answers[id];
          else answers[id] = v;
        }
        const merged = { ...data, answers };
        remember(key, version, merged);
        // (the cache at once; the screen once the column rests: motion.ts)
        whenStill(() => {
          if (!alive) return;
          setState({ key, data: merged });
          setError(null);
        });
      })
      .catch((e) => alive && whenStill(() => alive && setError(e instanceof Error ? e.message : String(e))));
    return () => {
      alive = false;
    };
  }, [key, from, to, goalTime, version]);

  const loaded = state && state.key === key ? state.data : null;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const answer = useCallback(
    (e: CalendarEvent, done: boolean | null) => {
      const planned = pastBlockMinutes(e, Date.now()) ?? 0;
      const value = done === null ? null : done ? planned : 0;
      const apply = (v: number | null) =>
        setState((s) => {
          if (!s) return s;
          const answers = { ...s.data.answers };
          if (v === null) delete answers[e.id];
          else answers[e.id] = v;
          const data = { ...s.data, answers };
          const hit = cache.get(s.key);
          if (hit) remember(s.key, hit.version, data);
          return { ...s, data };
        });
      const before = loadedRef.current?.answers[e.id];
      pending.current.set(e.id, value);
      apply(value);
      backend
        .setBlockDone(e.id, done)
        .then(() => {
          setError(null);
          planData.bumpEvents(); // goal hours and the year's heat include past blocks
        })
        .catch((err) => {
          if (pending.current.get(e.id) === value) apply(before ?? null); // unless a newer tap is on its way
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (pending.current.get(e.id) === value) pending.current.delete(e.id);
        });
    },
    [],
  );

  return { events: loaded?.events ?? null, answers: loaded?.answers ?? {}, log: loaded?.log ?? null, error, answer };
}
