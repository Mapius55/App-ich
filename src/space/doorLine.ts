// The door line under the circle (D19, logic moved over from UpNext): pure, tested.
import { timeHM } from "../lib/dates";
import { addDays, dayOf } from "../lib/plan";
import type { CalendarEvent } from "../lib/types";

export interface DoorLine {
  label: string; // "HEUTE" | "MORGEN" | "" (with "DEIN TAG" as the text)
  text: string; // "17:00 Lauftraining" | "Ganztags: Rennen" | "Nichts mehr geplant" | "Dein Tag"
  aria: string;
  day: string;
  id?: string;
}

const GRACE_MS = 30 * 60 * 1000; // a timed entry counts until 30 min after its start

/**
 * The door line (moved over from UpNext): the next entry today, an all-day entry,
 * after 20:00 tomorrow's first entry, "Nichts mehr geplant", or "Dein Tag" when
 * nothing is planned in the next 8 days.
 */
export function doorLine(events: CalendarEvent[], now: Date): DoorLine {
  const today = dayOf(now);
  const tomorrow = addDays(today, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8).getTime();
  const start = (e: CalendarEvent) => new Date(e.starts_at).getTime();
  const on = (day: string) => events.filter((e) => dayOf(new Date(e.starts_at)) === day).sort((a, b) => start(a) - start(b));
  const pick = (day: string, timedFrom: number) => {
    const list = on(day);
    return list.find((e) => !e.all_day && start(e) > timedFrom) ?? list.find((e) => e.all_day) ?? null;
  };
  const tell = (e: CalendarEvent, day: string, word: "heute" | "morgen"): DoorLine => ({
    label: word === "heute" ? "Heute" : "Morgen",
    text: e.all_day ? `Ganztags: ${e.title}` : `${timeHM(e.starts_at)} ${e.title}`,
    aria: e.all_day ? `Als Nächstes: ${e.title} ${word}, ganztags. Deinen Tag ansehen` : `Als Nächstes: ${e.title} ${word} um ${timeHM(e.starts_at)}. Deinen Tag ansehen`,
    day,
    id: e.id,
  });

  const next = pick(today, now.getTime() - GRACE_MS);
  if (next) return tell(next, today, "heute");
  if (now.getHours() >= 20) {
    const t = pick(tomorrow, -Infinity);
    if (t) return tell(t, tomorrow, "morgen");
  }
  const later = events.some((e) => (e.all_day ? dayOf(new Date(e.starts_at)) > today : start(e) > now.getTime()) && start(e) < end);
  if (later) return { label: "Heute", text: "Nichts mehr geplant", aria: "Heute ist nichts mehr geplant. Deinen Tag ansehen", day: today };
  return { label: "", text: "Dein Tag", aria: "Deinen Tag ansehen", day: today };
}
