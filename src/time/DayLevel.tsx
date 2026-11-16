// Tag (level 1): the anchor day as a list with the JETZT line, past goal blocks
// („Hat’s geklappt? Ja · Nein“), a ghost row in the largest free gap, habit chips. Today from 17:00
// the evening is hers: a free gap is just «Frei», without «Mit dem Coach planen».
// Overflow (measured, not guessed): compact rows → past rows collapse → first K
// rows + "+N weitere" → an inner scroller. The section height never changes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Weather } from "../lib/weather";
import { daySubline, dayTitle, timeHM } from "../lib/dates";
import { addDays, daysBetween } from "../lib/plan";
import type { CalendarEvent } from "../lib/types";
import { usePlanData } from "../space/data";
import { useFresh, useSeenWhenVisible } from "../space/fresh";
import { useSpace } from "../space/state";
import { BlockAnswer } from "./BlockAnswer";
import { HabitChips } from "./HabitChips";
import { calmEvening, dayRows, dayPlanText, hm, largestGap, minutesIn } from "./layout";
import { CornerPill, LevelHeader, NextLevelLink } from "./LevelHeader";
import { useNow, usePeriodSwap, useTimePaging } from "./usePaging";
import { clearRangeCache, pastBlockMinutes, prefetchRange, useRangeEvents, type Answers } from "./useRangeEvents";

export interface DayLevelProps {
  titleId: string;
  active: boolean; // this level is the settled one (at Jetzt)
  weather: Weather | null;
}

type Item =
  | { kind: "event"; e: CalendarEvent; past: boolean }
  | { kind: "now" }
  | { kind: "gap"; start: number; end: number }
  | { kind: "earlier"; count: number };

/** 0 full rows, 1 compact rows, 2 past rows collapsed, 3 only the first `limit` items */
type Fit = 0 | 1 | 2 | 3;
const MORE_H = 44;

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function DayLevel({ titleId, active, weather }: DayLevelProps) {
  // a new Space may belong to another user: start without cached ranges (before the first load)
  useState(clearRangeCache);
  const space = useSpace();
  const { anchor, today, reduced, highlight, open, ask, registerAdd, goLevel, setAnchor } = space;
  const { shown, pageRef, titleRef } = usePeriodSwap(anchor, active && !reduced);
  const { step, swipeRef, followRef } = useTimePaging(1);
  const data = useRangeEvents(shown, addDays(shown, 1));
  const { goalTitle } = usePlanData();
  const now = useNow(active);
  const rel = daysBetween(today, shown);

  useEffect(() => {
    if (anchor !== shown) prefetchRange(anchor, addDays(anchor, 1));
  }, [anchor, shown]);

  // dock "+": a new entry on the anchor day
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  useEffect(() => {
    registerAdd("tag", () => open({ kind: "event", event: null, day: anchorRef.current }));
    return () => registerAdd("tag", null);
  }, [registerAdd, open]);

  const events = data.events;
  const rows = useMemo(() => (events ? dayRows(events, shown, today, now) : null), [events, shown, today, now]);
  const gap = useMemo(() => (events && events.length ? largestGap(events, shown, today, now) : null), [events, shown, today, now]);

  const allItems = useMemo<Item[]>(() => {
    if (!rows) return [];
    const items: Item[] = rows.map((r) => (r.type === "now" ? { kind: "now" } : { kind: "event", e: r.e, past: r.past }));
    if (gap) {
      const at = items.findIndex((it) => it.kind === "event" && !it.past && !it.e.all_day && minutesIn(shown, it.e.starts_at) >= gap.end);
      items.splice(at < 0 ? items.length : at, 0, { kind: "gap", ...gap });
    }
    return items;
  }, [rows, gap, shown]);
  const pastCount = allItems.filter((it) => it.kind === "event" && it.past && !it.e.all_day).length;

  // ---------- overflow ----------
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [boxH, setBoxH] = useState(0);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBoxH(Math.round(box.clientHeight)));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  // what the day shows (her «frühere» or «mehr» stays open while she answers a block: Ja · Teilweise · Nein);
  // the fit is measured again when an answer changes a row's height
  const contentKey = `${shown}|${allItems.map((it) => (it.kind === "event" ? `${it.e.id}${it.past ? "p" : ""}${it.e.title.length}` : it.kind)).join(",")}`;
  const layoutKey = `${contentKey}|${Object.keys(data.answers).length}|${boxH}`;
  const [fitState, setFitState] = useState<{ key: string; fit: Fit; limit: number }>({ key: "", fit: 0, limit: Infinity });
  const [user, setUser] = useState<{ key: string; expanded: boolean; pastOpen: boolean }>({ key: "", expanded: false, pastOpen: false });
  const fit: Fit = fitState.key === layoutKey ? fitState.fit : 0;
  const limit = fitState.key === layoutKey ? fitState.limit : Infinity;
  const expanded = user.key === contentKey && user.expanded;
  const pastOpen = user.key === contentKey && user.pastOpen;
  const openAll = () => setUser({ key: contentKey, expanded: true, pastOpen: true });

  const compact = fit >= 1 || expanded;
  const collapse = fit >= 2 && !pastOpen && pastCount >= 2;
  let items = allItems;
  if (collapse) {
    const firstPast = items.findIndex((it) => it.kind === "event" && it.past && !it.e.all_day);
    items = [...items.slice(0, firstPast), { kind: "earlier", count: pastCount }, ...items.filter((it, i) => i >= firstPast && !(it.kind === "event" && it.past && !it.e.all_day))];
  }
  const countEvents = (list: Item[]) => list.reduce((n, it) => n + (it.kind === "event" ? 1 : it.kind === "earlier" ? it.count : 0), 0);
  const limited = fit >= 3 && !expanded && limit < items.length;
  const visible = limited ? items.slice(0, limit) : items;
  const hiddenCount = limited ? countEvents(items) - countEvents(visible) : 0;

  useLayoutEffect(() => {
    const box = boxRef.current;
    const list = listRef.current;
    if (!box || !list || expanded || !allItems.length) return;
    if (list.offsetTop + list.offsetHeight <= box.clientHeight + 1) return;
    if (pastOpen) return setUser({ key: contentKey, expanded: true, pastOpen: true });
    if (fit === 0) return setFitState({ key: layoutKey, fit: 1, limit: Infinity });
    if (fit === 1 && pastCount >= 2) return setFitState({ key: layoutKey, fit: 2, limit: Infinity });
    if (fit < 3) {
      const room = box.clientHeight - list.offsetTop - MORE_H;
      let k = 0;
      for (const li of Array.from(list.children) as HTMLElement[]) {
        if (li.offsetTop + li.offsetHeight > room) break;
        k++;
      }
      return setFitState({ key: layoutKey, fit: 3, limit: Math.max(1, k) });
    }
    if (limit > 1 && limit !== Infinity) setFitState({ key: layoutKey, fit: 3, limit: limit - 1 });
  }, [layoutKey, contentKey, fit, limit, expanded, pastOpen, pastCount, allItems.length]);

  // space.highlight: show the row (open what hides it) and bring it into the inner list's view
  const highlightHere = !!highlight && !!events?.some((e) => e.id === highlight);
  const highlightHidden = highlightHere && (limited || collapse) && !visible.some((it) => it.kind === "event" && it.e.id === highlight);
  useEffect(() => {
    if (highlightHidden) setUser({ key: contentKey, expanded: true, pastOpen: true });
  }, [highlightHidden, contentKey]);
  useEffect(() => {
    if (!highlightHere || highlightHidden) return;
    const box = boxRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-id="${CSS.escape(highlight!)}"]`);
    if (!box || !el || box.scrollHeight <= box.clientHeight) return;
    const top = el.offsetTop - box.clientHeight / 3;
    box.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  }, [highlightHere, highlightHidden, highlight, reduced]);

  // ---------- head ----------
  const title = dayTitle(shown, today);
  const sub = daySubline(shown, today);
  // "Heute, Samstag, 14. November"; a weekday title is already in the subline
  const srTitle = Math.abs(rel) <= 1 ? `${cap(title)}, ${sub}` : sub;
  const weatherText = rel === 0 && weather ? ` · ${Math.round(weather.temperature)}° ${weather.description}` : "";
  const planText = dayPlanText(shown, today);
  const calm = calmEvening(shown, today, now);

  return (
    <div className="tl tl-day" ref={swipeRef} data-active={active || undefined}>
      {anchor !== today && <CornerPill side="right" label="Zu heute" onClick={() => setAnchor(today)} />}
      <LevelHeader
        titleId={titleId}
        title={title}
        srTitle={srTitle}
        sub={`${sub}${weatherText}`}
        prev={{ label: "Vorheriger Tag", onClick: () => step(-1) }}
        next={{ label: "Nächster Tag", onClick: () => step(1) }}
        fadeRef={titleRef}
      />
      <div className="tl-follow" ref={followRef}>
        <div className="tl-page" ref={pageRef}>
          {data.error && (
            <p className="form-error" role="alert">
              {data.error}
            </p>
          )}
          <div className={`day-box${expanded ? " scroll" : ""}`} ref={boxRef}>
            {events && events.length === 0 ? (
              <div className="day-empty">
                {rel < 0 ? (
                  <p className="day-empty-line">Ein freier Tag.</p>
                ) : calm ? (
                  <p className="day-empty-line">Ein freier Abend.</p>
                ) : (
                  <>
                    <p className="day-empty-line">Noch nichts geplant. Erzähl mir, was ansteht.</p>
                    <button type="button" className="tl-quiet" onClick={() => ask(planText)}>
                      Mit dem Coach planen
                    </button>
                  </>
                )}
              </div>
            ) : (
              <ul className={`day-list${compact ? " compact" : ""}`} ref={listRef}>
                {visible.map((it) => {
                  if (it.kind === "now")
                    return (
                      <li key="now" className="day-now">
                        <span className="day-now-label">Jetzt</span>
                        <span className="day-now-line" aria-hidden="true" />
                      </li>
                    );
                  if (it.kind === "earlier")
                    return (
                      <li key="earlier">
                        <button type="button" className="day-earlier" onClick={() => setUser({ key: contentKey, expanded, pastOpen: true })} aria-expanded={false}>
                          {it.count} frühere <span aria-hidden="true">⌃</span>
                        </button>
                      </li>
                    );
                  if (it.kind === "gap")
                    return (
                      <li key="gap" className="day-gap">
                        <button type="button" className="day-gap-free" onClick={(ev) => open({ kind: "event", event: null, day: shown, time: hm(it.start) }, ev.currentTarget)}>
                          <span className="day-gap-label">Frei</span> {hm(it.start)}–{hm(it.end)}
                        </button>
                        {!calm && (
                          <button type="button" className="day-gap-coach" onClick={() => ask(planText)}>
                            <span className="pill">Mit dem Coach planen</span>
                          </button>
                        )}
                      </li>
                    );
                  return (
                    <DayRow
                      key={it.e.id}
                      e={it.e}
                      past={it.past}
                      compact={compact}
                      goal={goalTitle(it.e.goal_id)}
                      flash={highlight === it.e.id}
                      answers={data.answers}
                      now={now.getTime()}
                      onOpen={(el) => open({ kind: "event", event: it.e, day: shown }, el)}
                      onAnswer={(done, minutes) => data.answer(it.e, done, minutes)}
                    />
                  );
                })}
                {limited && (
                  <li key="more">
                    <button type="button" className="day-more" onClick={openAll}>
                      +{hiddenCount} weitere
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
          <HabitChips day={shown} />
        </div>
      </div>
      <NextLevelLink label="WOCHE" onClick={() => goLevel(2)} />
    </div>
  );
}

function DayRow(props: {
  e: CalendarEvent;
  past: boolean;
  compact: boolean;
  goal: string | null;
  flash: boolean;
  answers: Answers;
  now: number;
  onOpen(el: HTMLElement): void;
  onAnswer(done: boolean | null, minutes?: number): void;
}) {
  const { e, past, compact, goal, flash, answers, now } = props;
  const ref = useRef<HTMLLIElement>(null);
  const fresh = useFresh(e.id);
  useSeenWhenVisible(ref, e.id);
  const time = e.all_day ? null : timeHM(e.starts_at);
  const end = !e.all_day && e.ends_at ? timeHM(e.ends_at) : null;
  const nolio = e.source === "nolio"; // planned by the trainer: read-only, counts by itself once done in Nolio
  const planned = goal && !nolio ? pastBlockMinutes(e, now) : null;
  const goalLabel = goal ? (goal === e.title ? "Ziel" : goal) : null;
  const meta = planned === null ? [e.location, goalLabel, nolio ? "vom Trainer" : null].filter(Boolean).join(" · ") : "";
  const label = `${e.title}, ${e.all_day ? "ganztägig" : `${time}${end ? ` bis ${end}` : ""}`}${e.kind === "block" ? ", Block" : ""}${goal ? `, Ziel ${goal}` : ""}${nolio ? ", vom Trainer geplant. Ansehen" : ". Bearbeiten"}${fresh ? ", neu vom Coach" : ""}`;
  return (
    <li
      ref={ref}
      data-id={e.id}
      className={`day-row${past ? " past" : ""}${e.goal_id ? " goal" : ""}${planned !== null ? " answer" : ""}${fresh ? " is-fresh" : ""}${flash ? " is-flash" : ""}`}
    >
      <button type="button" className={`day-row-main${meta || planned !== null ? "" : " bare"}`} aria-label={label} onClick={(ev) => props.onOpen(ev.currentTarget)}>
        <span className={`day-time${e.all_day ? " allday" : ""}`}>{e.all_day ? "Ganztags" : time}</span>
        <span className="day-body">
          <span className="day-title">
            {e.title}
            {fresh && <span className="fresh-tag">neu</span>}
            {compact && meta && <span className="day-meta-inline"> · {meta}</span>}
          </span>
          {!compact && meta && <span className="day-meta">{meta}</span>}
        </span>
      </button>
      {planned !== null && goal && <BlockAnswer title={e.title} goal={goal} planned={planned} value={answers[e.id]} onAnswer={props.onAnswer} />}
    </li>
  );
}
