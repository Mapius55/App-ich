// STUB (phase 0): Builder B replaces the body; the props are final.
import type { Weather } from "../lib/weather";
import { daySubline, dayTitle } from "../lib/dates";
import { useSpace } from "../space/state";

export interface DayLevelProps {
  titleId: string;
  active: boolean; // this level is the settled one (at Jetzt)
  weather: Weather | null;
}

export function DayLevel(props: DayLevelProps) {
  const { anchor, today } = useSpace();
  const title = dayTitle(anchor, today);
  const sub = daySubline(anchor, today);
  return (
    <div className="stub" data-active={props.active || undefined}>
      <h2 id={props.titleId} className="stub-title" tabIndex={-1}>
        <span aria-hidden="true">{title}</span>
        <span className="sr-only">{`${title.charAt(0)}${title.slice(1).toLowerCase()}, ${sub}`}</span>
      </h2>
      <p className="stub-sub">
        {sub}
        {props.weather && anchor === today ? ` · ${Math.round(props.weather.temperature)}° ${props.weather.description}` : ""}
      </p>
    </div>
  );
}
