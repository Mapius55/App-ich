// Rollout flag for the space (D23) and the tour's "seen" mark.

const SPACE_KEY = "ich.space";
const TOUR_KEY = "ich.tour.v1";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

let space: boolean | null = null;

/**
 * The new view is the default. Only an explicit "0" (?space=0, Du › Einstellungen › «Alte Ansicht
 * öffnen») keeps the old view; ?space=1 / «Neue Ansicht öffnen» switch back. Only "0" and "1" count
 * as a parameter, and only a parameter is stored: who never chose stays apart from who chose the new.
 */
export function spaceChoice(param: string | null, stored: string | null): { on: boolean; persist: "0" | "1" | null } {
  const valid = param === "0" || param === "1" ? param : null;
  return { on: (valid ?? stored) !== "0", persist: valid };
}

/** ?space=1 / ?space=0 persist "ich.space"; on unless "0" was chosen */
export function spaceEnabled(): boolean {
  if (space !== null) return space;
  let param: string | null = null;
  try {
    param = new URLSearchParams(window.location.search).get("space");
  } catch {
    /* no window (tests) */
  }
  const choice = spaceChoice(param, read(SPACE_KEY));
  if (choice.persist) write(SPACE_KEY, choice.persist);
  space = choice.on;
  return space;
}

let tourSeenThisSession = false;

export function tourSeen(): boolean {
  return tourSeenThisSession || read(TOUR_KEY) !== null;
}

/** "ich.tour.v1"; without storage it holds for this session */
export function markTourSeen(): void {
  tourSeenThisSession = true;
  write(TOUR_KEY, "1");
}
