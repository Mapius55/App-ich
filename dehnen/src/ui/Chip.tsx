// Chip: a toggle (filters, regions). Tag: the same shape without behaviour, for quiet facts.
import type { ReactNode } from "react";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";

export interface ChipProps {
  selected: boolean;
  /** called with the new state */
  onChange: (selected: boolean) => void;
  icon?: IconName;
  /** a small count after the label */
  count?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function Chip({ selected, onChange, icon, count, disabled, className, children }: ChipProps) {
  return (
    <button type="button" className={`kw-chip${selected ? " is-selected" : ""}${className ? " " + className : ""}`} aria-pressed={selected} disabled={disabled} onClick={() => onChange(!selected)}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
      {count !== undefined && <span className="kw-chip__count kw-num">{count}</span>}
    </button>
  );
}

export interface TagProps {
  /** default = dim outline; accent and warm for the rare highlight; solid = filled quiet surface */
  tone?: "default" | "accent" | "warm" | "solid";
  icon?: IconName;
  className?: string;
  children: ReactNode;
}

export function Tag({ tone = "default", icon, className, children }: TagProps) {
  return (
    <span className={`kw-tag kw-tag--${tone}${className ? " " + className : ""}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}
