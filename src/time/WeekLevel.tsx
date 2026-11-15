// STUB (phase 0): Builder B replaces the body; the props are final.
import { weekRange, weekTitle } from "../lib/dates";
import { isoWeek } from "../lib/plan";
import { useSpace } from "../space/state";

export interface WeekLevelProps {
  titleId: string;
  active: boolean; // this level is the settled one (at Jetzt)
}

export function WeekLevel(props: WeekLevelProps) {
  const { anchor, today } = useSpace();
  const range = weekRange(anchor);
  return (
    <div className="stub" data-active={props.active || undefined}>
      <h2 id={props.titleId} className="stub-title" tabIndex={-1}>
        <span aria-hidden="true">{weekTitle(anchor, today)}</span>
        <span className="sr-only">{`Woche, ${range.replace(/\s?–\s?/, " bis ")}`}</span>
      </h2>
      <p className="stub-sub">
        {range} · KW {isoWeek(anchor)}
      </p>
    </div>
  );
}
