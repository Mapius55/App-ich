// Toggle: a switch with its label, as one row. The whole row can be tapped.
import { useId } from "react";
import type { ReactNode } from "react";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** a quiet second line under the label */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <label className={`kw-toggle${disabled ? " is-disabled" : ""}${className ? " " + className : ""}`} htmlFor={id}>
      <span className="kw-toggle__text">
        <span className="kw-toggle__label">{label}</span>
        {description && (
          <span className="kw-toggle__desc" id={id + "-d"}>
            {description}
          </span>
        )}
      </span>
      <input id={id} className="kw-switch" type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={description ? id + "-d" : undefined} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
