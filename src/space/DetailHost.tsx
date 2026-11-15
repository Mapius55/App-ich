// STUB (phase 0): Builder C renders the real forms here (Entry, Goal, Habit details).
import { useSpace, type Detail } from "./state";
import { Unfold } from "./Unfold";

function kindLabel(d: Detail): string {
  if (d.kind === "event") return d.event ? "Eintrag" : "Neuer Eintrag";
  if (d.kind === "goal") return d.goal ? "Ziel" : "Neues Ziel";
  return d.habit ? "Gewohnheit" : "Neue Gewohnheit";
}

function titleOf(d: Detail): string {
  if (d.kind === "event") return d.event?.title ?? "";
  if (d.kind === "goal") return d.goal?.title ?? "";
  return d.habit?.title ?? "";
}

export function DetailHost() {
  const { detail, detailOrigin, close } = useSpace();
  if (!detail) return null;
  return (
    <Unfold kindLabel={kindLabel(detail)} origin={detailOrigin} onRequestClose={close}>
      <h2 className="stub-title">{titleOf(detail) || kindLabel(detail)}</h2>
      <p className="stub-sub">Formular (Platzhalter)</p>
    </Unfold>
  );
}
