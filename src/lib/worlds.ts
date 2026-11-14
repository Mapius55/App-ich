// Farbwelten: hand-tuned colour combinations, one per sky situation.
//
// Rules (from colour-harmony research, see docs/farben-recherche.md):
//   - colours within a world sit close on the colour wheel, at most one accent
//     from further away (similar hues read as harmonious),
//   - clear steps in lightness (preferred: lightness contrast),
//   - similar saturation inside a world, no muddy browns/olives/greys
//     (they turn into "brown mix" on a dark, glowing ground),
//   - night stays in deep greens and blues (Wunsch), sunsets go coral → pink → violet.
// Wada's "Dictionary of Color Combinations" served as reference for several worlds.
//
// Each world has five roles:
//   light  – the brightest glow (top of the portal, highlights)
//   main   – the dominant colour
//   accent – a close neighbour of main
//   accent2 – the one colour that may stand a little apart
//   deep   – the darkest tone (tints the ground, depth of the portal)

export interface World {
  id: string;
  name: string;
  light: string;
  main: string;
  accent: string;
  accent2: string;
  deep: string;
  /** light phases: N Nacht · B Blaue Stunde · D Morgenrot · M Morgen · T Tag · A Nachmittag/Gold · S Sonnenuntergang */
  phases: string;
  /** weather it belongs to: c klar · w bewölkt · r Regen · f Nebel · s Schnee · g Gewitter ("" = any) */
  weather?: string;
  /** seasons: wi fr so he ("" = any) */
  seasons?: string;
  alp?: boolean;
}

export const WORLDS: World[] = [
  // ---- Nacht: dunkles Grün und Blau
  { id: "tannennacht", name: "Tannennacht", light: "#a6e3d6", main: "#1f6f78", accent: "#2a9d8f", accent2: "#2e5aa8", deep: "#0b2a3a", phases: "N" },
  { id: "fjord", name: "Fjord", light: "#b3ccff", main: "#1d3f8f", accent: "#2f7fa8", accent2: "#2a9d8f", deep: "#0a1636", phases: "N" },
  { id: "nordlicht", name: "Nordlicht", light: "#bff7dc", main: "#1f9e74", accent: "#3fd0b0", accent2: "#4a62d8", deep: "#071f2a", phases: "N", weather: "c", seasons: "wihe" },
  { id: "gewitter", name: "Gewitter", light: "#c2c8ff", main: "#3a3f8f", accent: "#5f7bd6", accent2: "#8a6fd0", deep: "#12142e", phases: "NBT", weather: "g" },

  // ---- Dämmerung
  { id: "daemmerblau", name: "Dämmerblau", light: "#d2ccff", main: "#3f4fbf", accent: "#7a6fe0", accent2: "#e28fb8", deep: "#141a4a", phases: "B" },
  { id: "erstes-licht", name: "Erstes Licht", light: "#ffdccb", main: "#6f86d6", accent: "#b7a6f0", accent2: "#f2a7b5", deep: "#2a2f6a", phases: "BD" },

  // ---- Sonnenaufgang & Morgen
  { id: "morgenrot", name: "Morgenrot", light: "#ffe6cc", main: "#ff9e80", accent: "#f7b2c8", accent2: "#ffcf8a", deep: "#5a3d7a", phases: "D" },
  { id: "bluetenmorgen", name: "Blütenmorgen", light: "#fff3f6", main: "#f7b6d2", accent: "#ffd1e0", accent2: "#9fd8a8", deep: "#2f6f6f", phases: "DM", seasons: "fr" },
  { id: "klarer-morgen", name: "Klarer Morgen", light: "#f2faff", main: "#8fc9ee", accent: "#a8e6cf", accent2: "#f6c1d6", deep: "#2f6f9f", phases: "MT" },

  // ---- Tag
  { id: "sommerhimmel", name: "Sommerhimmel", light: "#f2f9ff", main: "#4fa8e8", accent: "#7fd6e8", accent2: "#a8f0e0", deep: "#1f5fa0", phases: "T", weather: "c", seasons: "frso" },
  { id: "wintertag", name: "Wintertag", light: "#ffffff", main: "#9cc6ec", accent: "#c7e2f7", accent2: "#c9c4f0", deep: "#3f6f9f", phases: "MT", seasons: "wi" },
  { id: "gletscher", name: "Gletscher", light: "#f3fbff", main: "#5ab4d6", accent: "#8fe0d6", accent2: "#d8ecf7", deep: "#1f5f8a", phases: "MTA", alp: true },
  { id: "wolkenblau", name: "Wolkenblau", light: "#eef3f8", main: "#8fb3d1", accent: "#b9d4e6", accent2: "#c8c2e6", deep: "#4a6f94", phases: "MTA", weather: "w" },
  { id: "herbstlicht", name: "Herbstlicht", light: "#ffe9c9", main: "#f28c38", accent: "#ffc145", accent2: "#e5534b", deep: "#5a2a4a", phases: "TA", weather: "c", seasons: "he" },

  // ---- Nachmittag & goldene Stunde
  { id: "pfirsichlicht", name: "Pfirsichlicht", light: "#fff1e0", main: "#ffb48a", accent: "#f7a6a6", accent2: "#ffd88a", deep: "#8a5aa8", phases: "A" },
  { id: "gold", name: "Goldene Stunde", light: "#fff0c8", main: "#ffb347", accent: "#ffd56b", accent2: "#ff8a65", deep: "#7a3f8f", phases: "A", weather: "c" },

  // ---- Sonnenuntergang
  { id: "glut", name: "Glut", light: "#ffd6ad", main: "#ff6b4a", accent: "#ffa54f", accent2: "#ff4f8b", deep: "#4a2a8a", phases: "S", weather: "c" },
  { id: "flamingo", name: "Flamingo", light: "#ffd8e2", main: "#f26b8a", accent: "#ff9e7a", accent2: "#c25cd8", deep: "#3a2a7a", phases: "S" },
  { id: "abendviolett", name: "Abendviolett", light: "#f2d0ff", main: "#9a5fd8", accent: "#e070b8", accent2: "#ff9e7a", deep: "#2a1f6a", phases: "SB" },

  // ---- Wetter
  { id: "regenblau", name: "Regenblau", light: "#dce8f3", main: "#4f7fa8", accent: "#5fa6a6", accent2: "#8a9fd6", deep: "#1f3550", phases: "DMTAS", weather: "r" },
  { id: "nachtregen", name: "Nachtregen", light: "#b8d0e6", main: "#2a4f78", accent: "#2f7f86", accent2: "#5a6fb8", deep: "#0c1a2a", phases: "NB", weather: "r" },
  { id: "morgennebel", name: "Morgennebel", light: "#f5f7fb", main: "#b8c6d8", accent: "#cfd9e6", accent2: "#d9d2ea", deep: "#6f7f99", phases: "DMTAS", weather: "f" },
  { id: "pulverschnee", name: "Pulverschnee", light: "#ffffff", main: "#b9d9f2", accent: "#e3f1fb", accent2: "#c9d4f5", deep: "#5f86b8", phases: "DMTAS", weather: "s" },
];

export const ROLES = ["light", "main", "accent", "accent2", "deep"] as const;
export type Role = (typeof ROLES)[number];
