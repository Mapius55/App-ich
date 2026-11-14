// Small line icons for the Plan page, drawn like the rest of the app (round caps, thin strokes).

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IconBack = () => (
  <svg {...base} width="22" height="22" strokeWidth="1.5">
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const IconClose = () => (
  <svg {...base} width="18" height="18" strokeWidth="1.4">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconPlus = ({ size = 20 }: { size?: number }) => (
  <svg {...base} width={size} height={size} strokeWidth="1.5">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconChevron = ({ dir }: { dir: "left" | "right" | "down" }) => (
  <svg {...base} width="18" height="18" strokeWidth="1.5">
    <path d={dir === "left" ? "M15 6l-6 6 6 6" : dir === "right" ? "M9 6l6 6-6 6" : "M6 9l6 6 6-6"} />
  </svg>
);

/** The check inside a round check circle; its stroke draws in when shown. */
export const IconCheck = ({ size = 14 }: { size?: number }) => (
  <svg {...base} width={size} height={size} strokeWidth="2.4" className="check-mark">
    <path d="M5 12.5l4.2 4.2L19 7" pathLength={1} />
  </svg>
);

export const IconEdit = () => (
  <svg {...base} width="16" height="16" strokeWidth="1.4">
    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
  </svg>
);
