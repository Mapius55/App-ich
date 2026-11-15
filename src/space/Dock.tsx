// The dock's left slot: ✓ "Fertig" while a detail is open, "+" when the current
// place or level registered an add handler, otherwise an empty spacer.
import type { AddKey } from "./state";

const ADD_LABEL: Record<AddKey, string> = {
  tag: "Eintrag hinzufügen",
  woche: "Eintrag hinzufügen",
  ziele: "Auf die Bucket List",
  du: "Etwas über dich notieren",
};

export function DockLeft({ detailOpen, addKey, onAdd, onDone }: { detailOpen: boolean; addKey: AddKey | null; onAdd: (() => void) | null; onDone: () => void }) {
  if (detailOpen)
    return (
      <button type="button" className="dock-round dock-done" onClick={onDone} aria-label="Fertig">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
      </button>
    );
  if (addKey && onAdd)
    return (
      <button type="button" className="dock-round dock-add" onClick={onAdd} aria-label={ADD_LABEL[addKey]}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    );
  return <span className="dock-spacer" />;
}
