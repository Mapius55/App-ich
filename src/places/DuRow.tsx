// A collapsible row in Du (§3.6): uppercase title, a soft value on the right, a fading
// hairline under it. It opens in place (grid rows 0fr → 1fr); the content mounts on
// first open and stays mounted so closing can animate.
import { useState } from "react";
import type { DuSection } from "../space/state";

export function DuRow({
  id,
  title,
  value,
  open,
  dim,
  onToggle,
  children,
}: {
  id: DuSection;
  title: string;
  value?: string | null;
  open: boolean;
  /** another row is open: this one steps back */
  dim: boolean;
  onToggle(): void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const panelId = `du-panel-${id}`;
  return (
    <div className={`du-row${open ? " open" : ""}${dim ? " dim" : ""}`} data-section={id}>
      <h3 className="du-row-h">
        <button type="button" className="du-row-btn" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <span className="du-row-title">{title}</span>
          {value ? <span className="du-row-value">{value}</span> : null}
        </button>
      </h3>
      <div id={panelId} className="pl-unfold" data-open={open || undefined} inert={!open} role="region" aria-label={title}>
        <div className="pl-unfold-inner du-panel">{mounted && children}</div>
      </div>
    </div>
  );
}
