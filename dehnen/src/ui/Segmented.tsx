// Segmented: choose exactly one of a few options (a radio group that looks like one control).
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** accessible name when the label is not plain text */
  ariaLabel?: string;
}

export interface SegmentedProps<T extends string | number> {
  /** accessible name of the group, e.g. "Dauer" */
  label: string;
  options: readonly SegmentedOption<T>[];
  /** a value that is not among the options selects nothing */
  value: T | null;
  onChange: (value: T) => void;
  /** md 44, sm 36 px high */
  size?: "sm" | "md";
  /** stretch over the full width with equal segments (default true) */
  block?: boolean;
  className?: string;
}

export function Segmented<T extends string | number>({ label, options, value, onChange, size = "md", block = true, className }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.findIndex((o) => o.value === value);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || options.length === 0) return;
    e.preventDefault();
    const from = selected < 0 ? (step > 0 ? -1 : 0) : selected;
    const next = (from + step + options.length) % options.length;
    const opt = options[next];
    if (!opt) return;
    onChange(opt.value);
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={`kw-seg kw-seg--${size}${block ? " kw-seg--block" : ""}${className ? " " + className : ""}`} onKeyDown={onKey}>
      {options.map((o, i) => {
        const on = i === selected;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} aria-label={o.ariaLabel} tabIndex={on || (selected < 0 && i === 0) ? 0 : -1} className={`kw-seg__opt${on ? " is-selected" : ""}`} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
