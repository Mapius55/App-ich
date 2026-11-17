// Woche (level 2): seven rows, Monday first. Each row: weekday and date, the first
// entries in one line, a 06–22 day track (goal blocks in accent, others soft, a now
// tick today) and a micro line with the time for goals. Under the summary one quiet line per active
// goal with time that week («Halbmarathon · geplant 3 Std · gemacht 2 Std»), as many as the rows can spare
// (none on a small phone, where they stay for a screen reader). Tap a row → that day. The summary hands
// over to the coach: «Mit dem Coach planen» (on Saturday and Sunday the current week plans the next
// one: «Nächste Woche mit dem Coach planen»), a past week «Mit dem Coach anschauen» (a look back).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { daySubline, spokenMinutes, timeHM, weekdayShort, weekRange, weekTitle } from "../lib/dates";
import { addDays, dayMinutes, dayOf, daysBetween, isoWeek, weekDays, weekGoalSummary, weekStart } from "../lib/plan";
import type { CalendarEvent } from "../lib/types";
import { usePlanData } from "../space/data";
import { useFresh, useSeenWhenVisible } from "../space/fresh";
import { useSpace } from "../space/state";
import {
  microLine,
  nowTick,
  plannedMinutes,
  trackRange,
  weekGoalLine,
  weekGoalRoom,
  weekKind,
  weekPlanLabel,
  weekPlanText,
  weekReviewText,
  weekSummary,
  weekTrack,
  type Segment,
} from "./layout";
import { CornerPill, LevelHeader, NextLevelLink } from "./LevelHeader";
import { useArrival, useNow, usePeriodSwap, useTimePaging } from "./usePaging";
import { prefetchRange, useRangeEvents } from "./useRangeEvents";

export interface WeekLevelProps {
  titleId: string;
  active: boolean; // this level is the settled one (at Jetzt)
}

const TIGHT_ROW = 58;
const localDay = (iso: string) => dayOf(new Date(iso));
const byStart = (a: CalendarEvent, b: CalendarEvent) => (a.all_day === b.all_day ? a.starts_at.localeCompare(b.starts_at) : a.all_day ? -1 : 1);

export function WeekLevel({ titleId, active }: WeekLevelProps) {
  const { anchor, today, reduced, highlight, open, ask, registerAdd, goLevel, setAnchor } = useSpace();
  const target = weekStart(anchor);
  const { shown: monday, pageRef, titleRef } = usePeriodSwap(target, active && !reduced);
  const { step, swipeRef, followRef } = useTimePaging(2);
  const data = useRangeEvents(monday, addDays(monday, 7), { goalTime: true });
  const { goals } = usePlanData();
  const now = useNow(active);
  const arriving = useArrival(active, reduced, 150);

  useEffect(() => {
    if (target !== monday) prefetchRange(target, addDays(target, 7), true);
  }, [target, monday]);

  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  useEffect(() => {
    registerAdd("woche", () => open({ kind: "event", event: null, day: anchorRef.current }));
    return () => registerAdd("woche", null);
  }, [registerAdd, open]);

  // rows tighter than 58 px move the micro line to the end of line 1; the goal lines take only the room the
  // rows can spare (weekGoalRoom; none on a small phone): rows and lines share the height, so the count stays put
  // once measured
  const rowsRef = useRef<HTMLOListElement>(null);
  const goalsRef = useRef<HTMLUListElement>(null);
  const [tight, setTight] = useState(false);
  const [goalRoom, setGoalRoom] = useState(Infinity);
  useEffect(() => {
    const el = rowsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setTight(el.clientHeight / 7 < TIGHT_ROW);
      const lines = goalsRef.current;
      const lineH = lines?.querySelector<HTMLElement>("li:not(.sr-only)")?.offsetHeight || 18;
      setGoalRoom(weekGoalRoom(el.clientHeight, lines?.offsetHeight ?? 0, lineH));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const days = useMemo(() => weekDays(monday), [monday]);
  const events = data.events;
  // blocks with an answer: its goal time (the block's day) or, answered for another day, its answer
  const answered = useMemo(
    () => new Set([...(data.log ?? []).flatMap((t) => (t.event_id ? [t.event_id] : [])), ...Object.keys(data.answers)]),
    [data.log, data.answers],
  );
  const week = useMemo(() => {
    const byDay = new Map<string, CalendarEvent[]>(days.map((d) => [d, []]));
    for (const e of events ?? []) byDay.get(localDay(e.starts_at))?.push(e);
    for (const list of byDay.values()) list.sort(byStart);
    const range = trackRange(events ?? []);
    // a planned Nolio training doesn't count by itself: the completed one comes as goal time from Nolio
    const goalBlocks = (events ?? []).filter((e) => e.kind === "block" && e.goal_id && e.source !== "nolio");
    const done = dayMinutes(data.log ?? [], goalBlocks, answered, now, localDay, data.countFrom);
    const rows = days.map((day) => {
      const list = byDay.get(day) ?? [];
      return { day, list, segments: weekTrack(list, day, range), done: done[day] ?? 0, planned: plannedMinutes(list, now) };
    });
    return { range, rows, done: rows.reduce((n, r) => n + r.done, 0), planned: rows.reduce((n, r) => n + r.planned, 0) };
  }, [days, events, data.log, data.countFrom, answered, now]);

  const kind = weekKind(monday, today);

  // per active goal: planned against done that week (done as the goal's bar counts it)
  const goalLines = useMemo(() => {
    if (!events) return [];
    const active = (goals ?? []).filter((g) => g.status === "active");
    if (!active.length) return [];
    const blocks = events.filter((e) => e.kind === "block" && e.goal_id).map((e) => ({ ...e, answered: answered.has(e.id) }));
    const sums = new Map(weekGoalSummary(active.map((g) => g.id), blocks, data.log ?? [], monday, now, localDay, data.countFrom).map((s) => [s.goal_id, s]));
    return active.flatMap((g) => {
      const s = sums.get(g.id);
      const text = s ? weekGoalLine(s.planned_minutes, s.counted_minutes, kind) : null;
      if (!s || !text) return [];
      return [{ id: g.id, title: g.title, text, spoken: weekGoalLine(s.planned_minutes, s.counted_minutes, kind, spokenMinutes)! }];
    });
  }, [events, goals, data.log, data.countFrom, answered, monday, now, kind]);

  const range = weekRange(monday);
  const tick = nowTick(now, week.range);
  const summary = events ? weekSummary(kind, week.done, week.planned) : "\u00a0";

  // " · Mit dem Coach planen" follows the summary inline; when it wraps, the dot goes
  // (hidden, not removed, so the measurement cannot flip back and forth)
  const loaded = !!data.events;
  const sumRef = useRef<HTMLParagraphElement>(null);
  const [sumWrapped, setSumWrapped] = useState(false);
  useLayoutEffect(() => {
    const p = sumRef.current;
    if (!p) return;
    const measure = () => {
      const [text, , btn] = Array.from(p.children) as HTMLElement[];
      setSumWrapped(!!btn && btn.offsetTop > text.offsetTop + text.offsetHeight / 2);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(p);
    return () => ro.disconnect();
  }, [summary, kind, loaded]);

  return (
    <div className="tl tl-week" ref={swipeRef} data-active={active || undefined}>
      {target !== weekStart(today) && <CornerPill side="right" label="Zu dieser Woche" onClick={() => setAnchor(today)} />}
      <LevelHeader
        titleId={titleId}
        title={weekTitle(monday, today)}
        srTitle={`Woche, ${range.replace(/\s?–\s?/, " bis ")}`}
        sub={`${range} · KW ${isoWeek(monday)}`}
        prev={{ label: "Vorherige Woche", onClick: () => step(-1) }}
        next={{ label: "Nächste Woche", onClick: () => step(1) }}
        fadeRef={titleRef}
      />
      <div className="tl-follow" ref={followRef}>
        <div className="tl-page" ref={pageRef}>
          <p className={`wk-sum${sumWrapped ? " wrapped" : ""}`} ref={sumRef} data-week={monday} data-spoken={events ? weekSummary(kind, week.done, week.planned, spokenMinutes) : undefined}>
            <span>{summary}</span>
            {events && (
              <>
                <span className="wk-sum-dot" aria-hidden="true">
                  ·
                </span>
                {kind === "past" ? (
                  <button type="button" className="wk-sum-coach" onClick={() => ask(weekReviewText(monday, today))}>
                    Mit dem Coach anschauen
                  </button>
                ) : (
                  <button type="button" className="wk-sum-coach" onClick={() => ask(weekPlanText(monday, today))}>
                    {weekPlanLabel(monday, today)}
                  </button>
                )}
              </>
            )}
          </p>
          {goalLines.length > 0 && (
            <ul className="wk-goals" ref={goalsRef}>
              {/* the lines without room give way on screen and stay for a screen reader */}
              {goalLines.map((g, i) => (
                <li key={g.id} className={i < goalRoom ? undefined : "sr-only"} aria-label={`${g.title}: ${g.spoken.replace(/ · /g, ", ")}`}>
                  <span className="wk-goal-t" aria-hidden="true">
                    {g.title}
                  </span>
                  <span className="wk-goal-n" aria-hidden="true">
                    {` · ${g.text}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.error && (
            <p className="form-error" role="alert">
              {data.error}
            </p>
          )}
          <ol className={`wk-rows${tight ? " tight" : ""}`} ref={rowsRef}>
            {week.rows.map((r) => {
              const rel = daysBetween(today, r.day);
              const fromTrainer = r.list.some((e) => e.source === "nolio");
              // a day of a weekly rhythm: a quiet «jede Woche», like «vom Trainer». The markers come first, so a tight
              // row (320 px) cuts the minutes rather than a marker, in the order of the entries they belong to: a
              // trainer's 07:00 run before the 18:00 rhythm never reads as «jede Woche» and keeps its «vom Trainer»
              const weeklyAt = rel >= 0 ? r.list.findIndex((e) => !!e.series_id) : -1;
              const weekly = weeklyAt >= 0;
              const marks = [
                ...(weekly ? [{ text: "jede\u00a0Woche", kind: "weekly" as const, at: weeklyAt }] : []),
                ...(fromTrainer ? [{ text: "vom Trainer", kind: "trainer" as const, at: r.list.findIndex((e) => e.source === "nolio") }] : []),
              ].sort((a, b) => a.at - b.at);
              const micro = events ? [...marks.map(({ text, kind }) => ({ text, kind })), ...microLine(r.day, today, r.done, r.planned)] : [];
              const n = r.list.length;
              const minutes = [rel <= 0 && r.done > 0 ? `${spokenMinutes(r.done)} für Ziele` : null, rel >= 0 && r.planned > 0 ? `${spokenMinutes(r.planned)} geplant` : null]
                .filter(Boolean)
                .join(", ");
              const label = `${daySubline(r.day, today)}${rel === 0 ? ", heute" : ""}, ${n ? `${n} ${n === 1 ? "Eintrag" : "Einträge"}` : "frei"}${minutes ? `, ${minutes}` : ""}${weekly ? ", mit einem Block, der jede Woche kommt" : ""}${fromTrainer ? ", mit Training vom Trainer" : ""}. Tag öffnen`;
              const microEl = micro.length ? (
                <span className="wk-micro">
                  {micro.map((p, i) => (
                    <span key={p.kind} className={p.kind}>
                      {i > 0 && " · "}
                      {p.text}
                    </span>
                  ))}
                </span>
              ) : null;
              return (
                <li key={r.day}>
                  <button
                    type="button"
                    className={`wk-row${rel < 0 ? " past" : ""}${rel === 0 ? " today" : ""}${rel === 0 && arriving ? " arrive" : ""}`}
                    aria-current={rel === 0 ? "date" : undefined}
                    aria-label={label}
                    onClick={() => goLevel(1, { day: r.day })}
                  >
                    <span className="wk-date" aria-hidden="true">
                      <span className="wk-wd">{weekdayShort(r.day).toUpperCase()}</span>
                      <span className="wk-num">{Number(r.day.slice(8))}</span>
                    </span>
                    <span className="wk-main" aria-hidden="true">
                      <span className="wk-line-row">
                        <span className="wk-line">
                          {!events ? "\u00a0" : n === 0 ? <span className="wk-free">Frei</span> : r.list.map((e, i) => <EntryBit key={e.id} e={e} first={i === 0} />)}
                        </span>
                        {tight && microEl}
                      </span>
                      <span className="wk-track">
                        {r.segments.map((s) => (
                          <TrackSegment key={s.id} s={s} flash={highlight === s.id} />
                        ))}
                        {rel === 0 && tick !== null && <span className="wk-tick" style={{ left: `${tick * 100}%` }} />}
                      </span>
                      {!tight && (microEl ?? <span className="wk-micro">{"\u00a0"}</span>)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <NextLevelLink label="JAHR" onClick={() => goLevel(3)} />
    </div>
  );
}

function EntryBit({ e, first }: { e: CalendarEvent; first: boolean }) {
  return (
    <>
      {!first && <span className="wk-sep"> · </span>}
      {e.all_day ? <span className="wk-t">Ganztags: </span> : <span className="wk-t">{timeHM(e.starts_at)} </span>}
      <span className="wk-title">{e.title}</span>
    </>
  );
}

function TrackSegment({ s, flash }: { s: Segment; flash: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fresh = useFresh(s.id);
  useSeenWhenVisible(ref, s.id);
  return (
    <span
      ref={ref}
      className={`wk-seg${s.goal ? " goal" : ""}${fresh ? " is-fresh" : ""}${flash ? " is-flash" : ""}`}
      style={{ left: `${s.left * 100}%`, width: `${s.width * 100}%` }}
    />
  );
}
