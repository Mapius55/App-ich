// Jahr (level 3): the calendar year as 12 mini months (3 × 4) with month sums,
// heat, hollow "geplant" rings, "Zieltag" rings, a legend, an optional goal filter.
// A month opens in place (MonthInPlace); while it is open, sideways swipe is off.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { spokenMinutes } from "../lib/dates";
import { heatLevel, yearMonths } from "../lib/plan";
import { usePlanData } from "../space/data";
import { useSpace } from "../space/state";
import { hoursShort, MONTH_LONG, MONTH_SHORT, sumDays, yearSummary } from "./layout";
import { CornerPill, LevelHeader } from "./LevelHeader";
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
  const { anchor, today, reduced, yearGoal, setYearGoal, goLevel, setAnchor, detail } = useSpace();
  const { goalTitle } = usePlanData();
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
  const filterTitle = yearGoal ? (goalTitle(yearGoal) ?? "einem Ziel") : null;
  const monthIdx = open ? Number(open.month.slice(5, 7)) - 1 : -1;
  const monthLabel = open ? `${MONTH_LONG[monthIdx]} ${year}` : "";

  return (
    <div className={`tl tl-year${open ? " month-open" : ""}`} ref={swipeRef} data-active={active || undefined}>
      {open && <CornerPill side="left" label={`‹ ${year}`} onClick={closeMonth} />}
      {anchorYear !== thisYear && <CornerPill side="right" label="Zu diesem Jahr" onClick={() => setAnchor(today)} />}
      <LevelHeader
        titleId={titleId}
        title={open ? monthLabel.toUpperCase() : String(year)}
        srTitle={open ? monthLabel : `Jahr ${year}`}
        sub={data.loaded ? yearSummary(total.minutes, total.days) : " "}
        prev={open ? null : { label: "Vorheriges Jahr", onClick: () => step(-1) }}
        next={open ? null : { label: "Nächstes Jahr", onClick: () => step(1), disabled: anchorYear >= maxYear }}
        fadeRef={setFade}
      />
      <div className="tl-follow" ref={followRef}>
        <div className="tl-page" ref={pageRef}>
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
                const aria = `${MONTH_LONG[i]} ${year}: ${sum.days ? `${sum.days} ${sum.days === 1 ? "Tag" : "Tage"} mit Zeit für Ziele, ${spokenMinutes(sum.minutes)}` : "keine Zeit für Ziele"}. Monat öffnen`;
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
        </div>
      </div>
    </div>
  );
}
