// "Orte": first in the DOM, visible only while it has focus.
import type { Level, Place } from "./state";

const TARGETS: { label: string; place: Place; level?: Level }[] = [
  { label: "Jetzt", place: "jetzt", level: 0 },
  { label: "Heute", place: "jetzt", level: 1 },
  { label: "Woche", place: "jetzt", level: 2 },
  { label: "Jahr", place: "jetzt", level: 3 },
  { label: "Ziele", place: "ziele" },
  { label: "Du", place: "du" },
];

/** `inert` while a detail is open: everything outside the Unfold and the dock rests */
export function SkipNav({ onGo, inert = false }: { onGo: (place: Place, level?: Level) => void; inert?: boolean }) {
  return (
    <nav aria-label="Orte" className="skip" inert={inert}>
      <span className="skip-label">Springen zu:</span>
      {TARGETS.map((t) => (
        <button key={t.label} type="button" className="pill" onClick={() => onGo(t.place, t.level)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
