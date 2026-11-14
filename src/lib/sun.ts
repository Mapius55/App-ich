// Solar elevation (degrees above horizon) for a place and moment.
// NOAA's simplified algorithm; accurate to well under a degree, which is
// plenty for picking sky colours.

const rad = Math.PI / 180;

export function solarElevation(date: Date, lat: number, lon: number): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const epsilon = (23.439 - 0.0000004 * n) * rad;
  const decl = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));

  // Greenwich mean sidereal time in degrees
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  const lst = (gmst + lon) * rad;
  const hourAngle = lst - ra;

  const latR = lat * rad;
  const sinAlt = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(hourAngle);
  return Math.asin(sinAlt) / rad;
}

/** true when the sun is past its highest point today (afternoon/evening). */
export function isAfterSolarNoon(date: Date, lat: number, lon: number): boolean {
  const later = new Date(date.getTime() + 10 * 60 * 1000);
  return solarElevation(later, lat, lon) < solarElevation(date, lat, lon);
}
