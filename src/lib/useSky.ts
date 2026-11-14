import { useEffect, useMemo, useState } from "react";
import { computePalette, localDayKey, seasonName, type Mood, type NaturePalette, type Palette } from "./palette";
import { cachedWeather, fetchWeather, type Weather } from "./weather";
import { DEFAULT_COORDS, type Coords } from "./location";
import type { CoachContext } from "./types";

/** Live palette for "now, here": re-computed every minute, weather every 30 min. */
export function useSky(coords: Coords | null, mood: Mood | null, nature: NaturePalette | null) {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<Weather | null>(() => cachedWeather());
  const c = coords ?? DEFAULT_COORDS;

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!coords) return;
    let alive = true;
    const load = () => fetchWeather(coords.lat, coords.lon).then((w) => alive && w && setWeather(w));
    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [coords?.lat, coords?.lon]);

  const palette: Palette = useMemo(
    () =>
      computePalette({
        date: now,
        lat: c.lat,
        lon: c.lon,
        elevation: coords ? weather?.elevation : null,
        weather: coords ? weather : null,
        mood,
        nature,
      }),
    // minute resolution is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(now.getTime() / 60000), c.lat, c.lon, weather, mood, nature],
  );

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", palette.bgTop);
  }, [palette.bgTop]);

  const context = (): CoachContext => {
    const d = new Date();
    return {
      day: localDayKey(d),
      localTime: new Intl.DateTimeFormat("de-CH", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      season: seasonName(d, c.lat),
      phase: palette.phase,
      weather: coords && weather ? `${weather.description}, ${Math.round(weather.temperature)} °C` : undefined,
      hasLocation: !!coords,
    };
  };

  return { palette, weather: coords ? weather : null, context };
}
