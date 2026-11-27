// Button and IconButton: real <button>s (or <a> when href is given), at least 44 px to touch.
import type { AriaAttributes, CSSProperties, MouseEvent, ReactNode } from "react";
import { Icon } from "./icons.tsx";
import type { IconName } from "./icons.tsx";

interface CommonProps extends AriaAttributes {
  /** renders an <a href> that looks the same, e.g. href={href("/mix")} */
  href?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  type?: "button" | "submit";
  id?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export interface ButtonProps extends CommonProps {
  /** primary = the one main action (accent); quiet = secondary on a surface; ghost = text only; danger = destructive */
  variant?: "primary" | "quiet" | "ghost" | "danger";
  /** sm 36, md 48, lg 56 px high (sm still has a 44 px touch area) */
  size?: "sm" | "md" | "lg";
  /** full width */
  block?: boolean;
  /** icon before the label */
  icon?: IconName;
  /** icon after the label */
  iconEnd?: IconName;
  children?: ReactNode;
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({ variant = "quiet", size = "md", block, icon, iconEnd, href, onClick, disabled, type = "button", className, children, ...rest }: ButtonProps) {
  const cls = cx("kw-btn", `kw-btn--${variant}`, `kw-btn--${size}`, block && "kw-btn--block", className);
  const iconSize = size === "sm" ? 18 : size === "lg" ? 24 : 20;
  const inner = (
    <>
      {icon && <Icon name={icon} size={iconSize} />}
      {children !== undefined && children !== null && <span className="kw-btn__label">{children}</span>}
      {iconEnd && <Icon name={iconEnd} size={iconSize} />}
    </>
  );
  if (href !== undefined && !disabled) {
    return (
      <a className={cls} href={href} onClick={onClick} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <button className={cls} type={type} onClick={onClick} disabled={disabled} {...rest}>
      {inner}
    </button>
  );
}

export interface IconButtonProps extends CommonProps {
  icon: IconName;
  /** the accessible name (German), e.g. "Einstellungen" */
  label: string;
  /** md 44, lg 56 px */
  size?: "md" | "lg";
  /** plain = no background; filled = on a quiet round surface; accent = the main round action */
  variant?: "plain" | "filled" | "accent";
  /** for toggles (favourite): sets aria-pressed and the accent colour */
  pressed?: boolean;
}

export function IconButton({ icon, label, size = "md", variant = "plain", pressed, href, onClick, disabled, type = "button", className, ...rest }: IconButtonProps) {
  const cls = cx("kw-iconbtn", `kw-iconbtn--${variant}`, `kw-iconbtn--${size}`, pressed && "is-pressed", className);
  const glyph = <Icon name={icon} size={size === "lg" ? 28 : 24} />;
  if (href !== undefined && !disabled) {
    return (
      <a className={cls} href={href} onClick={onClick} aria-label={label} {...rest}>
        {glyph}
      </a>
    );
  }
  return (
    <button className={cls} type={type} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={pressed} {...rest}>
      {glyph}
    </button>
  );
}
