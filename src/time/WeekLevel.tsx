// Woche (level 2): seven rows, Monday first. Each row: weekday and date, the first
// entries in one line, a 06–22 day track (goal blocks in accent, others soft, a now
// tick today) and a micro line with the time for goals. Tap a row → that day.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { daySubline, spokenMinutes, timeHM, weekdayShort, weekRange, weekTitle } from "../lib/dates";
import { addDays, dayMinutes, dayOf, daysBetween, isoWeek, weekDays, weekStart } from "../lib/plan";
import type { CalendarEvent } from "../lib/types";
import { useFresh, useSeenWhenVisible } from "../space/fresh";
import { useSpace } from "../space/state";
import { microLine, nowTick, plannedMinutes, trackRange, weekKind, weekPlanText, weekSummary, weekTrack, type Segment } from "./layout";
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

  // rows tighter than 58 px move the micro line to the end of line 1
  const rowsRef = useRef<HTMLOListElement>(null);
  const [tight, setTight] = useState(false);
  useEffect(() => {
    const el = rowsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTight(el.clientHeight / 7 < TIGHT_ROW));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const days = useMemo(() => weekDays(monday), [monday]);
  const events = data.events;
  const week = useMemo(() => {
    const byDay = new Map<string, CalendarEvent[]>(days.map((d) => [d, []]));
    for (const e of events ?? []) byDay.get(localDay(e.starts_at))?.push(e);
    for (const list of byDay.values()) list.sort(byStart);
    const range = trackRange(events ?? []);
    const answered = new Set((data.log ?? []).flatMap((t) => (t.event_id ? [t.event_id] : [])));
    const goalBlocks = (events ?? []).filter((e) => e.kind === "block" && e.goal_id);
    const done = dayMinutes(data.log ?? [], goalBlocks, answered, now, localDay);
    const rows = days.map((day) => {
      const list = byDay.get(day) ?? [];
      return { day, list, segments: weekTrack(list, day, range), done: done[day] ?? 0, planned: plannedMinutes(list, now) };
    });
    return { range, rows, done: rows.reduce((n, r) => n + r.done, 0), planned: rows.reduce((n, r) => n + r.planned, 0) };
  }, [days, events, data.log, now]);

  const kind = weekKind(monday, today);

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
          <p className={`wk-sum${sumWrapped ? " wrapped" : ""}`} ref={sumRef}>
            <span>{summary}</span>
            {events && kind !== "past" && (
              <>
                <span className="wk-sum-dot" aria-hidden="true">
                  ·
                </span>
                <button type="button" className="wk-sum-coach" onClick={() => ask(weekPlanText(monday, today))}>
                  Mit dem Coach planen
                </button>
              </>
            )}
          </p>
          {data.error && (
            <p className="form-error" role="alert">
              {data.error}
            </p>
          )}
          <ol className={`wk-rows${tight ? " tight" : ""}`} ref={rowsRef}>
            {week.rows.map((r) => {
              const rel = daysBetween(today, r.day);
              const micro = events ? microLine(r.day, today, r.done, r.planned) : [];
              const n = r.list.length;
              const minutes = [rel <= 0 && r.done > 0 ? `${spokenMinutes(r.done)} für Ziele` : null, rel >= 0 && r.planned > 0 ? `${spokenMinutes(r.planned)} geplant` : null]
                .filter(Boolean)
                .join(", ");
              const label = `${daySubline(r.day, today)}${rel === 0 ? ", heute" : ""}, ${n ? `${n} ${n === 1 ? "Eintrag" : "Einträge"}` : "frei"}${minutes ? `, ${minutes}` : ""}. Tag öffnen`;
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
