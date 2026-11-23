import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import { dayOf } from "../lib/plan";
import { shortDay } from "../lib/dates";
import { unlockAudio } from "../lib/voice";
import type { Goal, Habit, Milestone } from "../lib/types";
import { CalendarView } from "../components/plan/CalendarView";
import { GoalCard } from "../components/plan/GoalCard";
import { GoalSheet } from "../components/plan/GoalSheet";
import { HabitRow } from "../components/plan/HabitRow";
import { HabitSheet } from "../components/plan/HabitSheet";
import { IphoneConnect } from "../components/plan/IphoneConnect";
import { YearView } from "../components/plan/YearView";
import { IconBack, IconChevron, IconPlus } from "../components/plan/icons";

// "Plan": goals with their steps, habits for the week and the calendar, on one
// page. Ticks happen at once on screen and are saved in the background.

interface Props {
  onBack: () => void;
  /** back to the coach, who starts planning the day */
  onPlanDay: () => void;
  /** bumped when the coach changed calendar entries */
  eventsVersion: number;
  /** bumped when the coach changed goals or habits */
  planVersion: number;
  /** open at the calendar with the iPhone connection unfolded (from Settings) */
  showConnect?: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Errors = { goals: string | null; habits: string | null; action: string | null };

export function Plan({ onBack, onPlanDay, eventsVersion, planVersion, showConnect }: Props) {
  const [goals, setGoals] = useState<Goal[] | null>(null); // all, incl. reached and dropped
  const [habits, setHabits] = useState<Habit[] | null>(null);
  // a load error goes away with the next good load, an action error with the next good action
  const [errors, setErrors] = useState<Errors>({ goals: null, habits: null, action: null });
  const [goalSheet, setGoalSheet] = useState<{ goal: Goal | null; focusEffort?: boolean } | null>(null);
  const [habitSheet, setHabitSheet] = useState<Habit | "new" | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const [version, setVersion] = useState(0);
  const [goalsTick, setGoalsTick] = useState(0); // only the goals (their hours), not the calendar
  const calendarRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  const today = dayOf();

  const setError = (key: keyof Errors, value: string | null) => setErrors((e) => (e[key] === value ? e : { ...e, [key]: value }));

  // Goals and habits load on their own, so one failing doesn't hide the other.
  useEffect(() => {
    let alive = true;
    backend
      .listGoals(true)
      .then((g) => {
        if (!alive) return;
        setGoals(g);
        setError("goals", null);
      })
      .catch((e) => alive && (setGoals((g) => g ?? []), setError("goals", message(e))));
    return () => {
      alive = false;
    };
  }, [planVersion, version, goalsTick]);

  useEffect(() => {
    let alive = true;
    backend
      .listHabits()
      .then((h) => {
        if (!alive) return;
        setHabits(h);
        setError("habits", null);
      })
      .catch((e) => alive && (setHabits((h) => h ?? []), setError("habits", message(e))));
    return () => {
      alive = false;
    };
  }, [planVersion, version]);

  // From Settings: go to the calendar once the lists above it are there (so it doesn't jump away).
  useEffect(() => {
    if (!showConnect || scrolled.current || !goals || !habits) return;
    scrolled.current = true;
    calendarRef.current?.scrollIntoView({ block: "start" });
  }, [showConnect, goals, habits]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const reloadGoals = useCallback(() => setGoalsTick((v) => v + 1), []);

  const ok = () => setError("action", null);
  const fail = (e: unknown) => {
    setError("action", message(e));
    reload(); // back to what is really stored
  };

  const toggleMilestone = (m: Milestone) => {
    const done = !m.done_at;
    setGoals((gs) =>
      gs!.map((g) => (g.id !== m.goal_id ? g : { ...g, milestones: g.milestones.map((x) => (x.id === m.id ? { ...x, done_at: done ? new Date().toISOString() : null } : x)) })),
    );
    backend.updateMilestone(m.id, { done }).then(ok, fail);
  };

  const addMilestone = async (goal: Goal, title: string) => {
    try {
      const m = await backend.addMilestone(goal.id, { title, due_date: null });
      setGoals((gs) => gs!.map((g) => (g.id === goal.id ? { ...g, milestones: [...g.milestones, m] } : g)));
      ok();
    } catch (e) {
      setError("action", message(e));
    }
  };

  const toggleHabit = (habit: Habit, day: string, done: boolean) => {
    setHabits((hs) =>
      hs!.map((h) => (h.id !== habit.id ? h : { ...h, done_days: done ? [...new Set([...h.done_days, day])].sort() : h.done_days.filter((d) => d !== day) })),
    );
    // D2: a habit with a goal and a length counts its minutes: the goal's time follows
    backend.setHabitDone(habit.id, day, done).then(() => (habit.goal_id && habit.minutes ? changed() : ok()), fail);
  };

  // a sheet saved or deleted something
  const changed = () => {
    ok();
    reload();
  };

  const planDay = () => {
    // this tap lets the coach's voice play on iPhone right away
    unlockAudio().catch(() => {});
    onPlanDay();
  };

  const all = goals ?? [];
  // active first, paused after; within each the backend's order (by target date)
  const shown = [...all.filter((g) => g.status === "active"), ...all.filter((g) => g.status === "paused")];
  // reached and dropped goals, folded away but still there to look at, restore or delete
  const finished = [...all.filter((g) => g.status === "done"), ...all.filter((g) => g.status === "dropped")];
  const goalTitle = (id: string | null) => (id ? all.find((g) => g.id === id)?.title ?? null : null);
  const error = errors.action ?? errors.goals ?? errors.habits;

  return (
    <main className="screen plan">
      <header className="topbar">
        <button className="dock-round" onClick={onBack} aria-label="Zurück">
          <IconBack />
        </button>
        <span className="pill">Plan</span>
      </header>

      <h1 className="title">Dein Plan</h1>
      <p className="lede">Worauf du hinarbeitest, was du regelmässig tust und was ansteht.</p>

      <button type="button" className="plan-coach" onClick={planDay}>
        <span className="plan-coach-orb" aria-hidden="true" />
        <span className="plan-coach-text">
          <span className="plan-coach-title">Tag mit dem Coach planen</span>
          <span className="plan-coach-sub">Er schlägt dir Zeit für das Wichtige vor.</span>
        </span>
        <IconChevron dir="right" />
      </button>

      {error && (
        <p className="form-error plan-error" role="alert">
          {error}
        </p>
      )}

      <section className="plan-section" aria-labelledby="plan-year">
        <div className="plan-section-head">
          <h2 id="plan-year" className="pill">
            Dein Jahr
          </h2>
        </div>
        <YearView goals={all} today={today} refresh={eventsVersion + planVersion + version} />
      </section>

      <section className="plan-section" aria-labelledby="plan-goals">
        <div className="plan-section-head">
          <h2 id="plan-goals" className="pill">
            Ziele
          </h2>
        </div>

        {goals && shown.length === 0 && <p className="plan-empty">Erzähl dem Coach, worauf du hinarbeitest, oder trag dein erstes Ziel selbst ein.</p>}

        {shown.map((g, i) => (
          <GoalCard
            key={g.id}
            goal={g}
            today={today}
            index={i}
            onOpen={() => setGoalSheet({ goal: g })}
            onEstimate={() => setGoalSheet({ goal: g, focusEffort: true })}
            onToggle={toggleMilestone}
            onAddMilestone={(t) => addMilestone(g, t)}
          />
        ))}

        <button type="button" className="btn ghost wide plan-add" onClick={() => setGoalSheet({ goal: null })}>
          <IconPlus size={16} />
          Ziel hinzufügen
        </button>

        {finished.length > 0 && (
          <div className="plan-reached">
            <button type="button" className="plan-reached-toggle" aria-expanded={showFinished} onClick={() => setShowFinished((s) => !s)}>
              Abgeschlossen · {finished.length}
              <span className={`plan-reached-chevron ${showFinished ? "open" : ""}`} aria-hidden="true">
                <IconChevron dir="down" />
              </span>
            </button>
            {showFinished && (
              <ul className="plan-reached-list">
                {finished.map((g) => (
                  <li key={g.id} className={g.status}>
                    <button type="button" onClick={() => setGoalSheet({ goal: g })} aria-label={`Ziel ansehen: ${g.title}, ${g.status === "done" ? "erreicht" : "aufgegeben"}`}>
                      <span className="plan-reached-title">{g.title}</span>
                      <span className="plan-reached-meta">
                        <span className="plan-reached-status">{g.status === "done" ? "Erreicht" : "Aufgegeben"}</span>
                        {g.target_date && <span className="plan-reached-date">{shortDay(g.target_date)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="plan-section" aria-labelledby="plan-habits">
        <div className="plan-section-head">
          <h2 id="plan-habits" className="pill">
            Gewohnheiten
          </h2>
        </div>

        {habits && habits.length === 0 && <p className="plan-empty">Kleine Dinge, die du regelmässig tun möchtest, z.B. dreimal pro Woche laufen.</p>}

        {habits && habits.length > 0 && (
          <ul className="card-glass habits">
            {habits.map((h) => (
              <HabitRow
                key={h.id}
                habit={h}
                goalTitle={goalTitle(h.goal_id)}
                today={today}
                onOpen={() => setHabitSheet(h)}
                onToggle={(day, done) => toggleHabit(h, day, done)}
              />
            ))}
          </ul>
        )}

        <button type="button" className="btn ghost wide plan-add" onClick={() => setHabitSheet("new")}>
          <IconPlus size={16} />
          Gewohnheit hinzufügen
        </button>
      </section>

      <section ref={calendarRef} className="plan-section" aria-labelledby="plan-calendar">
        <div className="plan-section-head">
          <h2 id="plan-calendar" className="pill">
            Kalender
          </h2>
        </div>
        <CalendarView goals={all} today={today} refresh={eventsVersion + planVersion + version} onTimeChanged={reloadGoals} />
      </section>

      <IphoneConnect initiallyOpen={showConnect} />

      {goalSheet && <GoalSheet goal={goalSheet.goal} focusEffort={goalSheet.focusEffort} onClose={() => setGoalSheet(null)} onChanged={changed} />}
      {habitSheet && <HabitSheet habit={habitSheet === "new" ? null : habitSheet} goals={all} onClose={() => setHabitSheet(null)} onChanged={changed} />}
    </main>
  );
}
