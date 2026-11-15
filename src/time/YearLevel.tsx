// Jahr (level 3): the calendar year as 12 mini months (3 × 4) with month sums,
// heat, hollow "geplant" rings, "Zieltag" rings, a legend, an optional goal filter.
// A month opens in place (MonthInPlace); while it is open, sideways swipe is off.
// Gently in the year (Bucket List round): under the title how much of this year has
// passed (a thin bar in the colour flow, «Noch 46 Tage in 2026»), or for a past year
// how many dreams came true; below the months what is still open in the year and
// what came true (→ the Bucket List, highlighted). Those items stay in view: when
// not all of them fit, the rest folds into a quiet «+2» that opens them in place.
// When even that doesn't fit (big text) the part under the title scrolls in place.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { spokenMinutes } from "../lib/dates";
import { heatLevel, yearMonths, yearProgress } from "../lib/plan";
import { daysLeftLine, fulfilledInYear, fulfilledYearLine, openInYear } from "../places/bucket";
import { usePlanData } from "../space/data";
import { useSpace } from "../space/state";
import { hoursShort, MONTH_LONG, MONTH_SHORT, monthSummary, sumDays, yearSummary } from "./layout";
import { CornerPill, LevelHeader, NextLevelLink } from "./LevelHeader";
import { MonthInPlace } from "./MonthInPlace";
import { useArrival, usePeriodSwap, useTimePaging } from "./usePaging";
import { useYearData } from "./useYearData";

export interface YearLevelProps {
  titleId: string;
  active: boolean; // this level is the settled one (at Jetzt)
}

const isTextField = (el: Element | null) =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit"].includes(el.type)) || (el instanceof HTMLElement && el.isContentEditable);

export function YearLevel({ titleId, active }: YearLevelProps) {
  const { anchor, today, reduced, yearGoal, setYearGoal, goLevel, go, setAnchor, detail } = useSpace();
  const { goals, goalTitle } = usePlanData();
  const { shown, pageRef, titleRef } = usePeriodSwap(anchor.slice(0, 4), active && !reduced);
  const year = Number(shown);
  const thisYear = Number(today.slice(0, 4));
  const maxYear = thisYear + 1;
  const anchorYear = Number(anchor.slice(0, 4));

  const [open, setOpen] = useState<{ month: string; closing: boolean } | null>(null);
  const monthEls = useRef(new Map<string, HTMLButtonElement>());
  const { step, swipeRef, followRef } = useTimePaging(3, { allowed: !open, canGo: (dir) => dir < 0 || anchorYear < maxYear });
  const data = useYearData(year, yearGoal);
  const months = useMemo(() => yearMonths(year), [year]);
  const arriving = useArrival(active, reduced, 600);

  const closeMonth = useCallback(() => setOpen((o) => (o && !o.closing ? { ...o, closing: true } : o)), []);
  const onClosed = useCallback(() => {
    setOpen((o) => {
      if (o) requestAnimationFrame(() => monthEls.current.get(o.month)?.focus({ preventScroll: true }));
      return null;
    });
  }, []);

  // leaving the level or changing the year folds the month at once
  useEffect(() => {
    if (!active) setOpen(null);
  }, [active]);
  useEffect(() => setOpen(null), [year]);

  // with a month open: Escape folds it, ← / → step through the months of the year;
  // at the last allowed year, → does nothing (the window handler would go further)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || detail || e.metaKey || e.ctrlKey || e.altKey || isTextField(document.activeElement)) return;
      if (!open) {
        if (e.key === "ArrowRight" && anchorYear >= maxYear) e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMonth();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const i = Number(open.month.slice(5, 7)) - 1 + (e.key === "ArrowRight" ? 1 : -1);
        if (i >= 0 && i < 12 && !open.closing) setOpen({ month: months[i].month, closing: false });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, open, detail, anchorYear, maxYear, months, closeMonth]);

  // focus the heading once a month has opened (keyboard and screen reader users land in it)
  const headRef = useRef<HTMLElement | null>(null);
  const setFade = useCallback(
    (el: HTMLElement | null) => {
      headRef.current = el;
      titleRef.current = el;
    },
    [titleRef],
  );
  const openMonth = open?.month ?? null;
  useEffect(() => {
    if (openMonth) headRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [openMonth]);

  const total = sumDays(data.perDay, String(year));
  // with a month open the subline is that month's ("18 Tage · 24 Std für Ziele")
  const monthTotal = open ? sumDays(data.perDay, open.month) : null;
  const filterTitle = yearGoal ? (goalTitle(yearGoal) ?? "einem Ziel") : null;
  const monthIdx = open ? Number(open.month.slice(5, 7)) - 1 : -1;
  const monthLabel = open ? `${MONTH_LONG[monthIdx]} ${year}` : "";

  // gently in the year: what has passed, what is still open, what came true
  const progress = yearProgress(year, today);
  const cameTrueAll = useMemo(() => fulfilledInYear(goals ?? [], year), [goals, year]);
  const pastLine = year < thisYear ? fulfilledYearLine(cameTrueAll.length, year) : null;
  // filtered to one goal («Nur Halbmarathon»), the pill already names it: no sections then
  const stillOpen = useMemo(() => (yearGoal ? [] : openInYear(goals ?? [], year)), [goals, year, yearGoal]);
  const cameTrue = yearGoal ? [] : cameTrueAll;
  // one section alone lays its items out in two columns; both sit side by side, one column each
  const cols = stillOpen.length > 0 && cameTrue.length > 0 ? 1 : 2;

  // the part under the title scrolls in place only when it doesn't fit (measured)
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(false);
  // «Noch offen» and «Erfüllt» never hide under the edge: `rows` item rows fit (measured), the
  // rest folds into «+n» until it is opened (`expanded`)
  const [rows, setRows] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const rowH = useRef(44); // the tallest item row seen in this year (only grows: no flip-flop)
  useEffect(() => {
    setExpanded(false);
    rowH.current = 44;
  }, [year, yearGoal]);
  useLayoutEffect(() => {
    const box = bodyRef.current;
    if (!box) return;
    const measure = () => {
      const inner = box.firstElementChild as HTMLElement | null;
      const pad = inner ? parseFloat(getComputedStyle(inner).paddingBottom) || 0 : 0;
      // the room kept at the end while scrolling doesn't count (else it would never stop scrolling)
      const need = inner ? inner.offsetHeight - pad : box.scrollHeight;
      setScroll(need > box.clientHeight + 1);
      // the rows of items that fit: the room under the first list, less what follows the sections
      // (neither depends on how many items are shown, so this settles at once)
      const list = box.querySelector<HTMLElement>(".yr-sec-list");
      const more = box.querySelector<HTMLElement>(".yr-more");
      if (!inner || !list || !more) return;
      const r0 = inner.getBoundingClientRect();
      const k = inner.offsetHeight ? r0.height / inner.offsetHeight || 1 : 1; // a level scaled while it moves
      const listTop = (list.getBoundingClientRect().top - r0.top) / k;
      const tail = need - (more.getBoundingClientRect().bottom - r0.top) / k;
      for (const el of box.querySelectorAll<HTMLElement>(".yr-item")) rowH.current = Math.max(rowH.current, el.offsetHeight);
      setRows(Math.max(1, Math.floor((box.clientHeight - listTop - Math.max(0, tail)) / rowH.current)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    if (box.firstElementChild) ro.observe(box.firstElementChild);
    return () => ro.disconnect();
  }, []);

  // how many items each section shows (null: all); «+n» opens the rest in place and moves to the first of them
  const cap = expanded || rows === null ? null : rows * cols;
  const expand = useCallback(() => {
    const box = bodyRef.current;
    const shown = box ? box.querySelectorAll(".yr-item").length : 0;
    setExpanded(true);
    requestAnimationFrame(() => {
      const next = box?.querySelectorAll<HTMLElement>(".yr-item")[shown];
      next?.focus({ preventScroll: true });
      next?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    });
  }, [reduced]);

  return (
    <div className={`tl tl-year${open ? " month-open" : ""}`} ref={swipeRef} data-active={active || undefined}>
      {open && <CornerPill side="left" label={`‹ ${year}`} onClick={closeMonth} />}
      {anchorYear !== thisYear && <CornerPill side="right" label="Zu diesem Jahr" onClick={() => setAnchor(today)} />}
      <LevelHeader
        titleId={titleId}
        title={open ? monthLabel.toUpperCase() : String(year)}
        srTitle={open ? monthLabel : `Jahr ${year}`}
        sub={!data.loaded ? "\u00a0" : monthTotal ? monthSummary(monthTotal.minutes, monthTotal.days) : yearSummary(total.minutes, total.days)}
        prev={open ? null : { label: "Vorheriges Jahr", onClick: () => step(-1) }}
        next={open ? null : { label: "Nächstes Jahr", onClick: () => step(1), disabled: anchorYear >= maxYear }}
        fadeRef={setFade}
      />
      <div className="tl-follow" ref={followRef}>
        <div className="tl-page" ref={pageRef}>
          <div className={`yr-pass${year === thisYear ? " current" : ""}`}>
            {year === thisYear && (
              <>
                <span className="yr-pass-bar" aria-hidden="true">
                  <span style={{ clipPath: `inset(0 ${((1 - progress.fraction) * 100).toFixed(2)}% 0 0 round 999px)` }} />
                </span>
                <span className="yr-pass-text">{daysLeftLine(progress.leftDays, year)}</span>
              </>
            )}
            {pastLine && <span className="yr-pass-text">{pastLine}</span>}
          </div>
          <div className={`yr-body${scroll ? " scroll" : ""}`} ref={bodyRef}>
            <div className="yr-body-inner">
              {filterTitle && (
                <div className="yr-filter">
                  <span className="pill">
                    <span className="yr-filter-name">Nur {filterTitle}</span>
                    <button type="button" className="yr-filter-x" aria-label="Filter entfernen" onClick={() => setYearGoal(null)}>
                      ✕
                    </button>
                  </span>
                </div>
              )}
              <div className="yr-stage">
                <div className={`yr-months year-grid${open && !open.closing ? " dim" : ""}`} inert={!!open}>
                  {months.map(({ month, cells }, i) => {
                    const sum = sumDays(data.perDay, month);
                    const current = year === thisYear && i === Number(today.slice(5, 7)) - 1;
                    const planned = [...data.planned].filter((d) => d.startsWith(month)).length;
                    const targets = [...data.targets].filter((d) => d.startsWith(month)).map((d) => `${Number(d.slice(8))}. ${MONTH_LONG[i]}`);
                    const aria = `${MONTH_LONG[i]} ${year}: ${sum.days ? `${sum.days} ${sum.days === 1 ? "Tag" : "Tage"} mit Zeit für Ziele, ${spokenMinutes(sum.minutes)}` : "keine Zeit für Ziele"}${planned ? `, ${planned} ${planned === 1 ? "Tag" : "Tage"} geplant` : ""}${targets.length ? `, Zieltag am ${targets.join(" und ")}` : ""}. Monat öffnen`;
                    return (
                      <button
                        key={month}
                        ref={(el) => {
                          if (el) monthEls.current.set(month, el);
                          else monthEls.current.delete(month);
                        }}
                        type="button"
                        className={`yr-month${current ? " current" : ""}`}
                        aria-label={aria}
                        onClick={() => setOpen({ month, closing: false })}
                      >
                        <span className="yr-mhead" aria-hidden="true">
                          <span className="yr-mname">{MONTH_SHORT[i]}</span>
                          <span className="yr-msum">{hoursShort(sum.minutes)}</span>
                        </span>
                        <span className="yr-cells" aria-hidden="true">
                          {cells.map(({ day, inMonth }) => {
                            if (!inMonth) return <span key={day} className="yr-cell out" />;
                            const future = day > today;
                            const level = future ? 0 : heatLevel(data.perDay[day] ?? 0, data.thresholds);
                            const cls = [
                              "yr-cell",
                              `l${level}`,
                              future && "future",
                              day === today && "today",
                              day === today && arriving && "arrive",
                              future && data.planned.has(day) && "planned",
                              data.targets.has(day) && "target",
                            ]
                              .filter(Boolean)
                              .join(" ");
                            return <span key={day} className={cls} data-day={day} />;
                          })}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {open && (
                  <MonthInPlace
                    key={`${year}`}
                    month={open.month}
                    label={monthLabel}
                    today={today}
                    data={data}
                    origin={monthEls.current.get(open.month) ?? null}
                    closing={open.closing}
                    reduced={reduced}
                    onClosed={onClosed}
                    onDay={(day) => goLevel(1, { day })}
                  />
                )}
              </div>
              <p className="yr-legend">
                <span>Weniger</span>
                <span className="yr-legend-cells" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((l) => (
                    <span key={l} className={`yr-cell l${l}`} />
                  ))}
                </span>
                <span>Mehr</span>
                <span className="yr-legend-sep" aria-hidden="true">
                  ·
                </span>
                <span className="yr-cell planned future" aria-hidden="true" />
                <span>geplant</span>
                <span className="yr-legend-sep" aria-hidden="true">
                  ·
                </span>
                <span className="yr-cell target future" aria-hidden="true" />
                <span>Zieltag</span>
              </p>
              {(stillOpen.length > 0 || cameTrue.length > 0) && (
                <div className="yr-more" inert={!!open}>
                  {stillOpen.length > 0 && (
                    <YearSection id="yr-open-label" label={`Noch offen in ${year}`} items={stillOpen} cap={cap} cols={cols} onMore={expand} onItem={(id) => go("ziele", { highlight: id })} />
                  )}
                  {cameTrue.length > 0 && (
                    <YearSection id="yr-done-label" label={`Erfüllt in ${year}`} items={cameTrue} cap={cap} cols={cols} done onMore={expand} onItem={(id) => go("ziele", { highlight: id })} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* the level below: «Leben», life in weeks (Builder F) */}
      {!open && <NextLevelLink label="LEBEN" onClick={() => goLevel(4)} />}
    </div>
  );
}

interface YearSectionProps {
  id: string;
  label: string;
  items: { id: string; title: string }[];
  /** at most this many items (null: all); the rest shows as «+n» */
  cap: number | null;
  /** 2: the items sit in two columns */
  cols: number;
  done?: boolean;
  onMore(): void;
  onItem(id: string): void;
}

/** «Noch offen in 2026» or «Erfüllt in 2026»: the items, a tap goes to the Bucket List */
function YearSection({ id, label, items, cap, cols, done, onMore, onItem }: YearSectionProps) {
  const shown = cap === null ? items : items.slice(0, Math.max(1, cap));
  const hidden = items.length - shown.length;
  return (
    <section className="yr-sec" aria-labelledby={id}>
      <div className="yr-sec-head">
        <h3 id={id} className="yr-sec-label">
          {label}
        </h3>
        {hidden > 0 && (
          <button type="button" className="yr-sec-more" onClick={onMore} aria-label={`${hidden} ${hidden === 1 ? "weiteres" : "weitere"} zeigen`}>
            +{hidden}
          </button>
        )}
      </div>
      <ul className={`yr-sec-list${cols === 2 && items.length > 1 ? " two" : ""}`}>
        {shown.map((g) => (
          <li key={g.id}>
            <button type="button" className={`yr-item${done ? " done" : ""}`} onClick={() => onItem(g.id)}>
              {done ? <span className="bl-flow">{g.title}</span> : g.title}
              <span className="sr-only">, auf der Bucket List zeigen</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
