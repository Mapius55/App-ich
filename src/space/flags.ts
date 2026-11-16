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

/** ?space=1 / ?space=0 persist "ich.space"; default false until phase 3 */
export function spaceEnabled(): boolean {
  if (space !== null) return space;
  let param: string | null = null;
  try {
    param = new URLSearchParams(window.location.search).get("space");
  } catch {
    /* no window (tests) */
  }
  if (param === "1" || param === "0") write(SPACE_KEY, param);
  space = (param ?? read(SPACE_KEY)) === "1";
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
