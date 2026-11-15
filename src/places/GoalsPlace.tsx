// STUB (phase 0): Builder C replaces the body; the props are final.
export interface GoalsPlaceProps {
  titleId: string;
  active: boolean; // Ziele is the settled place
}

export function GoalsPlace(props: GoalsPlaceProps) {
  return (
    <div className="stub" data-active={props.active || undefined}>
      <h2 id={props.titleId} className="stub-title" tabIndex={-1}>
        Ziele
      </h2>
      <p className="stub-sub">Ziele (Platzhalter)</p>
    </div>
  );
}
