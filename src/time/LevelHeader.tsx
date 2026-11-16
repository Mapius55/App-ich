// The head of a time level: ‹ TITLE › with an sr-only full name, the subline, and
// the corner pills ("Zu heute" top right, "‹ 2026" top left) in the docked circle's row.
import type { ReactNode, Ref } from "react";
import { IconChevron } from "../components/plan/icons";
import { useFitText } from "./usePaging";

interface Chevron {
  label: string;
  onClick(): void;
  disabled?: boolean;
}

export interface LevelHeaderProps {
  titleId: string;
  /** visible short title (uppercase) */
  title: string;
  /** the full name read by screen readers, e.g. "Heute, Samstag, 14. November" */
  srTitle: string;
  sub?: ReactNode;
  prev?: Chevron | null;
  next?: Chevron | null;
  /** the element whose [data-swap-fade] children cross-fade on a period change */
  fadeRef?: Ref<HTMLElement>;
}

export function LevelHeader({ titleId, title, srTitle, sub, prev, next, fadeRef }: LevelHeaderProps) {
  const fit = useFitText<HTMLSpanElement>(title);
  const chevrons = !!(prev || next);
  const chev = (c: Chevron | null | undefined, dir: "left" | "right") =>
    c ? (
      <button type="button" className="lh-chev" aria-label={c.label} onClick={c.onClick} disabled={c.disabled}>
        <IconChevron dir={dir} />
      </button>
    ) : (
      <span className="lh-chev" aria-hidden="true" />
    );
  return (
    <header className={`lh${chevrons ? "" : " lh-solo"}`} ref={fadeRef}>
      <div className="lh-row">
        {chevrons && chev(prev, "left")}
        <h2 id={titleId} className="lh-title" tabIndex={-1}>
          <span ref={fit} className="lh-title-text" aria-hidden="true" data-swap-fade="">
            {title}
          </span>
          <span className="sr-only">{srTitle}</span>
        </h2>
        {chevrons && chev(next, "right")}
      </div>
      {sub !== undefined && (
        <p className="lh-sub" data-swap-fade="">
          {sub}
        </p>
      )}
    </header>
  );
}

/** a pill in the docked circle's row: "Zu heute" (right) or "‹ 2026" (left) */
export function CornerPill({ side, label, onClick, ariaLabel }: { side: "left" | "right"; label: string; onClick(): void; ariaLabel?: string }) {
  return (
    <button type="button" className={`lvl-corner ${side}`} onClick={onClick} aria-label={ariaLabel}>
      <span className="pill">{label}</span>
    </button>
  );
}

/** "WOCHE ⌄" / "JAHR ⌄": the link down to the next level */
export function NextLevelLink({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="lvl-next" onClick={onClick}>
      {label} <span className="lvl-next-chev">⌄</span>
    </button>
  );
}
