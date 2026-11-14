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

export function Plan({ onBack, onPlanDay, eventsVersion, planVersion, showConnect }: Props) {
  const [goals, setGoals] = useState<Goal[] | null>(null); // all, incl. reached and dropped
  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goalSheet, setGoalSheet] = useState<Goal | "new" | null>(null);
  const [habitSheet, setHabitSheet] = useState<Habit | "new" | null>(null);
  const [showReached, setShowReached] = useState(false);
  const [version, setVersion] = useState(0);
  const calendarRef = useRef<HTMLElement>(null);
  const today = dayOf();

  // Goals and habits load on their own, so one failing doesn't hide the other.
  useEffect(() => {
    let alive = true;
    backend
      .listGoals(true)
      .then((g) => alive && setGoals(g))
      .catch((e) => alive && (setGoals((g) => g ?? []), setError(message(e))));
    backend
      .listHabits()
      .then((h) => alive && setHabits(h))
      .catch((e) => alive && (setHabits((h) => h ?? []), setError(message(e))));
    return () => {
      alive = false;
    };
  }, [planVersion, version]);

  useEffect(() => {
    if (showConnect) calendarRef.current?.scrollIntoView({ block: "start" });
  }, [showConnect]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const fail = (e: unknown) => {
    setError(message(e));
    reload(); // back to what is really stored
  };

  const toggleMilestone = (m: Milestone) => {
    const done = !m.done_at;
    setGoals((gs) =>
      gs!.map((g) => (g.id !== m.goal_id ? g : { ...g, milestones: g.milestones.map((x) => (x.id === m.id ? { ...x, done_at: done ? new Date().toISOString() : null } : x)) })),
    );
    backend.updateMilestone(m.id, { done }).catch(fail);
  };

  const addMilestone = async (goal: Goal, title: string) => {
    try {
      const m = await backend.addMilestone(goal.id, { title, due_date: null });
      setGoals((gs) => gs!.map((g) => (g.id === goal.id ? { ...g, milestones: [...g.milestones, m] } : g)));
    } catch (e) {
      setError(message(e));
    }
  };

  const toggleHabit = (habit: Habit, day: string, done: boolean) => {
    setHabits((hs) =>
      hs!.map((h) => (h.id !== habit.id ? h : { ...h, done_days: done ? [...new Set([...h.done_days, day])].sort() : h.done_days.filter((d) => d !== day) })),
    );
    backend.setHabitDone(habit.id, day, done).catch(fail);
  };

  const planDay = () => {
    // this tap lets the coach's voice play on iPhone right away
    unlockAudio().catch(() => {});
    onPlanDay();
  };

  const open = (goals ?? []).filter((g) => g.status === "active" || g.status === "paused");
  // active first, paused after; within each the backend's order (by target date)
  const shown = [...open.filter((g) => g.status === "active"), ...open.filter((g) => g.status === "paused")];
  const reached = (goals ?? []).filter((g) => g.status === "done");
  const linkable = (goals ?? []).filter((g) => g.status !== "dropped");
  const goalTitle = (id: string | null) => (id ? (goals ?? []).find((g) => g.id === id)?.title ?? null : null);

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
            onOpen={() => setGoalSheet(g)}
            onToggle={toggleMilestone}
            onAddMilestone={(t) => addMilestone(g, t)}
          />
        ))}

        <button type="button" className="btn ghost wide plan-add" onClick={() => setGoalSheet("new")}>
          <IconPlus size={16} />
          Ziel hinzufügen
        </button>

        {reached.length > 0 && (
          <div className="plan-reached">
            <button type="button" className="plan-reached-toggle" aria-expanded={showReached} onClick={() => setShowReached((s) => !s)}>
              Erreicht · {reached.length}
              <span className={`plan-reached-chevron ${showReached ? "open" : ""}`} aria-hidden="true">
                <IconChevron dir="down" />
              </span>
            </button>
            {showReached && (
              <ul className="plan-reached-list">
                {reached.map((g) => (
                  <li key={g.id}>
                    <button type="button" onClick={() => setGoalSheet(g)} aria-label={`Ziel bearbeiten: ${g.title}`}>
                      <span className="plan-reached-title">{g.title}</span>
                      {g.target_date && <span className="plan-reached-date">{shortDay(g.target_date)}</span>}
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
        <CalendarView goals={linkable} today={today} refresh={eventsVersion + planVersion + version} />
      </section>

      <IphoneConnect initiallyOpen={showConnect} />

      {goalSheet && <GoalSheet goal={goalSheet === "new" ? null : goalSheet} onClose={() => setGoalSheet(null)} onChanged={reload} />}
      {habitSheet && (
        <HabitSheet
          habit={habitSheet === "new" ? null : habitSheet}
          goals={linkable.filter((g) => g.status !== "done" || g.id === (habitSheet !== "new" ? habitSheet.goal_id : null))}
          onClose={() => setHabitSheet(null)}
          onChanged={reload}
        />
      )}
    </main>
  );
}
