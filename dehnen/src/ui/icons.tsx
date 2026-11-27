// The icon set of Kehrwasser: one consistent hand, 24 px grid, stroke 1.75, round caps and joins.
// <Icon name="play" /> is decorative by default (aria-hidden); pass title to give it a name.
import type { CSSProperties } from "react";

interface Shape {
  /** path data */
  d?: string;
  /** circle: cx, cy, r */
  c?: [number, number, number];
  /** filled with the current colour instead of stroked */
  fill?: boolean;
  /** own stroke width (dots) */
  w?: number;
}

const ICONS = {
  // tabs
  today: [{ d: "M21 12a9 9 0 0 0-18 0 6.5 6.5 0 0 0 13 0 4 4 0 0 0-8 0 1.5 1.5 0 0 0 3 0" }],
  exercises: [{ c: [12, 4.6, 1.9] }, { d: "M4.5 8.6c2.6 1.1 4.9 1.6 7.5 1.6s4.9-.5 7.5-1.6" }, { d: "M12 10.2v5.3l-3.6 5.3M12 15.5l3.6 5.3" }],
  routines: [{ d: "M7.5 3.5v10M16.5 3.5v10" }, { d: "M3 18.6c3-2.9 5.2-2.9 9 0s6 2.9 9 0" }],
  history: [{ d: "M5 20.5v-6M12 20.5v-17M19 20.5V9.5" }],
  settings: [
    {
      d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    },
    { c: [12, 12, 3] },
  ],

  // navigation
  back: [{ d: "M15 4.5 7.5 12l7.5 7.5" }],
  forward: [{ d: "M9 4.5 16.5 12 9 19.5" }],
  up: [{ d: "M4.5 15 12 7.5l7.5 7.5" }],
  down: [{ d: "M4.5 9 12 16.5 19.5 9" }],
  close: [{ d: "M6 6l12 12M18 6 6 18" }],
  "arrow-up": [{ d: "M12 19.5v-15M5.5 11 12 4.5l6.5 6.5" }],
  "arrow-down": [{ d: "M12 4.5v15M5.5 13l6.5 6.5 6.5-6.5" }],
  more: [{ d: "M5 12h.01M12 12h.01M19 12h.01", w: 2.6 }],
  grip: [{ d: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01", w: 2.4 }],

  // actions
  plus: [{ d: "M12 5v14M5 12h14" }],
  minus: [{ d: "M5 12h14" }],
  check: [{ d: "M5 12.5 9.5 17 19 7" }],
  search: [{ c: [11, 11, 6.5] }, { d: "m16 16 4.5 4.5" }],
  filter: [{ d: "M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20" }, { c: [15, 7, 2.5] }, { c: [9, 17, 2.5] }],
  shuffle: [{ d: "M3.5 7H7c2.2 0 3.3 1.2 5 5s2.8 5 5 5h3.5" }, { d: "M3.5 17H7c1.1 0 1.9-.3 2.6-.9M20.5 7H17c-1.1 0-1.9.3-2.6.9" }, { d: "m18 4.5 2.5 2.5L18 9.5M18 14.5l2.5 2.5-2.5 2.5" }],
  edit: [{ d: "M4 20l1-4.6L16.4 4a2.1 2.1 0 0 1 3 3L8 18.6 4 20z" }, { d: "m14.5 6 3 3" }],
  trash: [{ d: "M4.5 7h15M9.5 4h5M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12" }, { d: "M10 11v5.5M14 11v5.5" }],
  copy: [{ d: "M9 9h10.5v11.5H9z" }, { d: "M5 15V3.5h10" }],
  download: [{ d: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" }],
  upload: [{ d: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14" }],
  share: [{ d: "M12 14.5v-11M8 7l4-3.5L16 7" }, { d: "M7.5 10.5H5.5v10h13v-10h-2" }],
  replay: [{ d: "M4 12a8 8 0 1 0 2.5-5.8L4 8.5" }, { d: "M4 4v4.5h4.5" }],
  rotate: [{ d: "M20 11a8 8 0 0 0-14-4.2L4 9" }, { d: "M4 4.5V9h4.5" }, { d: "M4 13a8 8 0 0 0 14 4.2l2-2.2" }, { d: "M20 19.5V15h-4.5" }],
  expand: [{ d: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" }],

  // player
  play: [{ d: "M8 5.2v13.6a.6.6 0 0 0 .9.5l11-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z", fill: true }],
  pause: [{ d: "M7.5 5v14M16.5 5v14", w: 3.2 }],
  next: [{ d: "M6 6v12l9.5-6z", fill: true }, { d: "M6 6v12l9.5-6z" }, { d: "M18.5 5.5v13" }],
  prev: [{ d: "M18 6v12L8.5 12z", fill: true }, { d: "M18 6v12L8.5 12z" }, { d: "M5.5 5.5v13" }],
  timer: [{ c: [12, 13.5, 7.5] }, { d: "M12 9.5v4l2.5 1.5M9.5 3h5" }],
  clock: [{ c: [12, 12, 8.5] }, { d: "M12 7.5V12l3 2" }],

  // states
  heart: [{ d: "M12 20.3s-7.8-4.7-7.8-10.4a4.4 4.4 0 0 1 7.8-2.8 4.4 4.4 0 0 1 7.8 2.8c0 5.7-7.8 10.4-7.8 10.4z" }],
  "heart-filled": [
    { d: "M12 20.3s-7.8-4.7-7.8-10.4a4.4 4.4 0 0 1 7.8-2.8 4.4 4.4 0 0 1 7.8 2.8c0 5.7-7.8 10.4-7.8 10.4z", fill: true },
    { d: "M12 20.3s-7.8-4.7-7.8-10.4a4.4 4.4 0 0 1 7.8-2.8 4.4 4.4 0 0 1 7.8 2.8c0 5.7-7.8 10.4-7.8 10.4z" },
  ],
  eye: [{ d: "M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6z" }, { c: [12, 12, 2.75] }],
  "eye-off": [{ d: "M4 4l16 16" }, { d: "M9.9 6.3A9.7 9.7 0 0 1 12 6c5.8 0 9 6 9 6a15 15 0 0 1-2.7 3.4M6.5 7.8A15 15 0 0 0 3 12s3.2 6 9 6a9 9 0 0 0 3.8-.8" }, { d: "M9.8 9.9a3 3 0 0 0 4.3 4.2" }],
  info: [{ c: [12, 12, 8.5] }, { d: "M12 11v5.5" }, { d: "M12 7.7v.01", w: 2.2 }],
  alert: [{ d: "M12 4 3 19.5h18L12 4z" }, { d: "M12 10v4.5" }, { d: "M12 17v.01", w: 2.2 }],
  list: [{ d: "M8.5 7H20M8.5 12H20M8.5 17H20" }, { d: "M4.5 7h.01M4.5 12h.01M4.5 17h.01", w: 2.4 }],
  mute: [{ d: "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" }, { d: "m16 9.5 5 5M21 9.5l-5 5" }],
  music: [{ d: "M9 17.5V6l10.5-2v11.5" }, { c: [6.5, 17.5, 2.5] }, { c: [17, 15.5, 2.5] }],
  sides: [{ d: "M12 3.5v17" }, { d: "M8 8 4 12l4 4M16 8l4 4-4 4" }],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

/** Every icon name, for galleries and checks. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** px, default 24 */
  size?: number;
  /** default 1.75 */
  strokeWidth?: number;
  /** gives the icon an accessible name; without it the icon is decorative */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 24, strokeWidth = 1.75, title, className, style }: IconProps) {
  const shapes: Shape[] = ICONS[name];
  return (
    <svg
      className={className ? `kw-icon ${className}` : "kw-icon"}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {shapes.map((s, i) =>
        s.c ? (
          <circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} fill={s.fill ? "currentColor" : undefined} strokeWidth={s.w} />
        ) : (
          <path key={i} d={s.d} fill={s.fill ? "currentColor" : undefined} stroke={s.fill && !s.w ? "none" : undefined} strokeWidth={s.w} />
        ),
      )}
    </svg>
  );
}
