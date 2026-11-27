// Stepper: minus, value, plus. Steps evenly (step) or through a list of sensible values (values).
import { Icon } from "./icons.tsx";

export interface StepperProps {
  /** accessible name, e.g. "Dauer" */
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** default 0 */
  min?: number;
  /** default 999 */
  max?: number;
  /** default 1; ignored when values is given */
  step?: number;
  /** step through these values instead (ascending), e.g. [5, 8, 10, 12, 15, 20, 30] */
  values?: readonly number[];
  /** shown after the number, e.g. "Min" or "Sek" */
  unit?: string;
  /** own text for the value (replaces number and unit) */
  format?: (value: number) => string;
  /** md: compact; lg: the number in the display face */
  size?: "md" | "lg";
  disabled?: boolean;
  className?: string;
}

export function Stepper({ label, value, onChange, min = 0, max = 999, step = 1, values, unit, format, size = "md", disabled, className }: StepperProps) {
  let lower: number | null;
  let higher: number | null;
  if (values && values.length > 0) {
    lower = null;
    higher = null;
    for (const v of values) {
      if (v < value) lower = v;
      if (v > value && higher === null) higher = v;
    }
  } else {
    lower = value - step >= min ? value - step : value > min ? min : null;
    higher = value + step <= max ? value + step : value < max ? max : null;
  }
  const text = format ? format(value) : String(value);
  return (
    <div role="group" aria-label={label} className={`kw-stepper kw-stepper--${size}${className ? " " + className : ""}`}>
      <button type="button" className="kw-stepper__btn" aria-label={`${label}: weniger`} disabled={disabled || lower === null} onClick={() => lower !== null && onChange(lower)}>
        <Icon name="minus" size={20} />
      </button>
      <output className="kw-stepper__value" aria-live="polite">
        <span className="kw-stepper__num kw-num">{text}</span>
        {unit && !format && <span className="kw-stepper__unit">{unit}</span>}
      </output>
      <button type="button" className="kw-stepper__btn" aria-label={`${label}: mehr`} disabled={disabled || higher === null} onClick={() => higher !== null && onChange(higher)}>
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}
