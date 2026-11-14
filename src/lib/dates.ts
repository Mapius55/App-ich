import type { CalendarEvent } from "./types";

export function eventWhen(e: Pick<CalendarEvent, "starts_at" | "all_day">): string {
  const d = new Date(e.starts_at);
  const day = new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "numeric", month: "long" }).format(d);
  if (e.all_day) return `${day} · ganztägig`;
  const time = new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day} · ${time}`;
}

export function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Heute";
  if (same(d, tomorrow)) return "Morgen";
  return new Intl.DateTimeFormat("de-CH", { weekday: "long", day: "numeric", month: "long" }).format(d);
}
