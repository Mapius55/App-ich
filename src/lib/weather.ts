// Live weather from Open-Meteo (free, no key, CORS-enabled).

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "storm";

export interface Weather {
  kind: WeatherKind;
  cloudCover: number; // 0..100
  temperature: number; // °C
  description: string; // German, for the coach
  fetchedAt: number;
}

const CACHE_KEY = "ich.weather";
const MAX_AGE = 30 * 60 * 1000;

function classify(code: number): { kind: WeatherKind; description: string } {
  if (code === 0) return { kind: "clear", description: "klar und sonnig" };
  if (code <= 2) return { kind: "partly", description: "leicht bewölkt" };
  if (code === 3) return { kind: "cloudy", description: "bedeckt" };
  if (code === 45 || code === 48) return { kind: "fog", description: "neblig" };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { kind: "rain", description: "regnerisch" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: "snow", description: "es schneit" };
  if (code >= 95) return { kind: "storm", description: "gewittrig" };
  return { kind: "partly", description: "wechselhaft" };
}

export function cachedWeather(): Weather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Weather;
    return Date.now() - w.fetchedAt < MAX_AGE * 4 ? w : null;
  } catch {
    return null;
  }
}

export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  const cached = cachedWeather();
  if (cached && Date.now() - cached.fetchedAt < MAX_AGE) return cached;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
      `&current=weather_code,cloud_cover,temperature_2m&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return cached;
    const data = await res.json();
    const { kind, description } = classify(Number(data.current.weather_code));
    const w: Weather = {
      kind,
      description,
      cloudCover: Number(data.current.cloud_cover ?? 0),
      temperature: Number(data.current.temperature_2m ?? 0),
      fetchedAt: Date.now(),
    };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(w));
    } catch {
      /* storage unavailable */
    }
    return w;
  } catch {
    return cached;
  }
}
