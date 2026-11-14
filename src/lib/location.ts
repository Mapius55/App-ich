// Location for sun position and weather. Only rounded coordinates are kept
// (about 1 km precision), which is all the sky colours need.

export interface Coords {
  lat: number;
  lon: number;
}

const KEY = "ich.coords";
// Until the person shares their location, use Zürich as a neutral default.
export const DEFAULT_COORDS: Coords = { lat: 47.37, lon: 8.54 };

const round = (v: number) => Math.round(v * 100) / 100;

export function storedCoords(): Coords | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Coords) : null;
  } catch {
    return null;
  }
}

export function storeCoords(c: Coords) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
}

export function requestCoords(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Dieser Browser kann keinen Standort bestimmen."));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) };
        storeCoords(c);
        resolve(c);
      },
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Standort nicht freigegeben. Du kannst das später in den Einstellungen des Browsers ändern."
              : "Standort konnte nicht bestimmt werden.",
          ),
        ),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60 * 60 * 1000 },
    );
  });
}
