// STUB (phase 0): Builder B replaces the body; the props are final.
import { useSpace } from "../space/state";

export interface YearLevelProps {
  titleId: string;
  active: boolean; // this level is the settled one (at Jetzt)
}

export function YearLevel(props: YearLevelProps) {
  const { anchor } = useSpace();
  const year = anchor.slice(0, 4);
  return (
    <div className="stub" data-active={props.active || undefined}>
      <h2 id={props.titleId} className="stub-title" tabIndex={-1}>
        <span aria-hidden="true">{year}</span>
        <span className="sr-only">{`Jahr ${year}`}</span>
      </h2>
      <p className="stub-sub">Jahr (Platzhalter)</p>
    </div>
  );
}
