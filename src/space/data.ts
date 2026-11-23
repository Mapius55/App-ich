// Plan data for the whole space (goals, habits) and the change counters the time
// levels reload on. Logic moved from screens/Plan.tsx (which stays untouched).
// Ticks show at once and are saved in the background; on error the lists reload.
import { useEffect, useSyncExternalStore } from "react";
import { backend } from "../lib/backend";
import type { Goal, Habit, Milestone } from "../lib/types";
import { whenStill } from "./motion";

export interface PlanSnapshot {
  goals: Goal[] | null; // all, incl. reached and dropped; null until the first load
  habits: Habit[] | null;
  error: string | null; // the last action error, else a load error
  eventsVersion: number; // bumped when calendar entries changed (coach or local saves)
  planVersion: number; // bumped when goals or habits changed
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let goals: Goal[] | null = null;
let habits: Habit[] | null = null;
const errors = { goals: null as string | null, habits: null as string | null, action: null as string | null };
let eventsVersion = 0;
let planVersion = 0;
let goalsSeq = 0;
let habitsSeq = 0;
let loaded = false;

const listeners = new Set<() => void>();
let snapshot: PlanSnapshot = build();
let publishQueued = false;

function build(): PlanSnapshot {
  return { goals, habits, error: errors.action ?? errors.goals ?? errors.habits, eventsVersion, planVersion };
}
// The one place goals, habits and the change counters reach the screen (Tag, Woche, Jahr, the Bucket
// List): while the column moves they wait and go out once, together (motion.ts); at rest (a tap) at once.
function emit(): void {
  if (publishQueued) return;
  publishQueued = true;
  whenStill(() => {
    publishQueued = false;
    snapshot = build();
    listeners.forEach((l) => l());
  });
}

function loadGoals(): void {
  const seq = ++goalsSeq;
  backend
    .listGoals(true)
    .then((g) => {
      if (seq !== goalsSeq) return;
      goals = g;
      errors.goals = null;
      emit();
    })
    .catch((e) => {
      if (seq !== goalsSeq) return;
      goals = goals ?? [];
      errors.goals = message(e);
      emit();
    });
}

function loadHabits(): void {
  const seq = ++habitsSeq;
  backend
    .listHabits()
    .then((h) => {
      if (seq !== habitsSeq) return;
      habits = h;
      errors.habits = null;
      emit();
    })
    .catch((e) => {
      if (seq !== habitsSeq) return;
      habits = habits ?? [];
      errors.habits = message(e);
      emit();
    });
}

const ok = () => {
  if (errors.action === null) return;
  errors.action = null;
  emit();
};
const fail = (e: unknown) => {
  errors.action = message(e);
  emit();
  planData.load(); // back to what is really stored
};

export const planData = {
  get(): PlanSnapshot {
    return snapshot;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** listGoals(true) + listHabits, independently (one failing doesn't hide the other) */
  load(): void {
    loaded = true;
    loadGoals();
    loadHabits();
  },
  /** calendar entries changed; goal hours include past blocks, so goals reload too */
  bumpEvents(): void {
    eventsVersion++;
    emit();
    if (loaded) loadGoals();
  },
  /** goals or habits changed (coach events, local saves) */
  bumpPlan(): void {
    planVersion++;
    emit();
    if (loaded) planData.load();
  },
  /** optimistic, rollback by reload on error */
  toggleMilestone(m: Milestone): void {
    const done = !m.done_at;
    if (goals)
      goals = goals.map((g) =>
        g.id !== m.goal_id ? g : { ...g, milestones: g.milestones.map((x) => (x.id === m.id ? { ...x, done_at: done ? new Date().toISOString() : null } : x)) },
      );
    emit();
    backend.updateMilestone(m.id, { done }).then(ok, fail);
  },
  /** resolves either way; a failure shows in `error` */
  async addMilestone(goal: Goal, title: string): Promise<void> {
    try {
      const m = await backend.addMilestone(goal.id, { title, due_date: null });
      if (goals) goals = goals.map((g) => (g.id === goal.id ? { ...g, milestones: [...g.milestones, m] } : g));
      errors.action = null;
      emit();
    } catch (e) {
      errors.action = message(e);
      emit();
    }
  },
  /** optimistic, rollback by reload on error */
  toggleHabit(h: Habit, day: string, done: boolean): void {
    if (habits)
      habits = habits.map((x) =>
        x.id !== h.id ? x : { ...x, done_days: done ? [...new Set([...x.done_days, day])].sort() : x.done_days.filter((d) => d !== day) },
      );
    emit();
    backend.setHabitDone(h.id, day, done).then(() => {
      ok();
      // D2: a habit with a goal and a length counts (or uncounts) its minutes: the goal's time and today's line follow
      if (h.goal_id && h.minutes) {
        planVersion++;
        emit();
        loadGoals();
      }
    }, fail);
  },
};

/** the snapshot (loads once on first use) plus a goal title lookup */
export function usePlanData(): PlanSnapshot & { goalTitle(id: string | null): string | null } {
  const s = useSyncExternalStore(planData.subscribe, planData.get, planData.get);
  useEffect(() => {
    if (!loaded) planData.load();
  }, []);
  const goalTitle = (id: string | null) => (id ? (s.goals?.find((g) => g.id === id)?.title ?? null) : null);
  return { ...s, goalTitle };
}

/** after sign-out: forget everything, the next user loads fresh */
export function resetPlanData(): void {
  goals = null;
  habits = null;
  errors.goals = errors.habits = errors.action = null;
  loaded = false;
  goalsSeq++;
  habitsSeq++;
  emit();
}
