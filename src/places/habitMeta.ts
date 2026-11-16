// Habits without pressure: the week's count appears once something is done this week («1 von 3
// diese Woche»), never as «0 von 7»; until then the line says nothing about the week.

/** «2 von 3 diese Woche», or null while nothing is done this week */
export function weekCount(done: number, target: number): string | null {
  return done > 0 ? `${done} von ${target} diese Woche` : null;
}

export type MetaPart = { key: "week" | "streak" | "goal"; text: string };

/** a habit's quiet meta line, in order (joined by « · »): the week's count, the streak, the goal */
export function habitMetaParts(o: { done: number; target: number; streak: string | null; goal?: string | null }): MetaPart[] {
  const week = weekCount(o.done, o.target);
  const parts: MetaPart[] = [];
  if (week) parts.push({ key: "week", text: week });
  if (o.streak) parts.push({ key: "streak", text: o.streak });
  if (o.goal) parts.push({ key: "goal", text: o.goal });
  return parts;
}
