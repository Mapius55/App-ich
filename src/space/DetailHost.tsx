// The open detail (entry, goal, habit) as an Unfold. After a save it reloads the plan
// data; once the panel has closed it moves Tag to the entry's new day and lets the
// item glow. A change by the coach refreshes the form when there are no local
// edits (else the local edits win on save); an item the coach deleted closes.
import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import { localMidnightIso } from "../lib/dates";
import { addDays, dayOf } from "../lib/plan";
import type { CalendarEvent, Goal, Habit } from "../lib/types";
import { EventDetail } from "../components/plan/EventSheet";
import { GoalDetail } from "../components/plan/GoalSheet";
import { HabitDetail } from "../components/plan/HabitSheet";
import { planData, usePlanData } from "./data";
import { useSpace, type CloseVia, type Detail } from "./state";

interface After {
  anchor?: string;
  flash?: string;
}

/** the form's dirty flag, the "our own change" mark, and closing when the item is gone */
function useLive(onRequestClose: (via: CloseVia) => Promise<boolean>) {
  const dirty = useRef(false);
  const self = useRef(false); // we saved or deleted: the reload that follows is ours
  const onDirty = useCallback((v: boolean) => void (dirty.current = v), []);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (gone) onRequestClose("nav");
  }, [gone, onRequestClose]);
  return { dirty, self, onDirty, gone, setGone };
}

function EventHost({ d, origin, goals, onRequestClose, after }: { d: Extract<Detail, { kind: "event" }>; origin: HTMLElement | null; goals: Goal[]; onRequestClose: (via: CloseVia) => Promise<boolean>; after: React.MutableRefObject<After | null> }) {
  const { eventsVersion } = usePlanData();
  const live = useLive(onRequestClose);
  const [event, setEvent] = useState<CalendarEvent | null>(d.event);
  const [version, setVersion] = useState(d.event?.updated_at ?? "0");
  const seen = useRef(eventsVersion);
  const firstDay = d.event ? dayOf(new Date(d.event.starts_at)) : d.day;

  // entries changed somewhere (the coach): look the open one up again
  useEffect(() => {
    const id = d.event?.id;
    if (!id || eventsVersion === seen.current || live.self.current) return;
    seen.current = eventsVersion;
    let alive = true;
    const today = dayOf();
    const from = addDays(firstDay < today ? firstDay : today, -1);
    backend
      .listEvents(localMidnightIso(from), localMidnightIso(addDays(today, 400)))
      .then((list) => {
        if (!alive || live.self.current) return;
        const found = list.find((x) => x.id === id);
        if (!found) return live.setGone(true);
        setEvent(found);
        if (!live.dirty.current) setVersion(found.updated_at ?? String(eventsVersion));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsVersion]);

  const onChanged = useCallback(
    (day?: string, saved?: CalendarEvent) => {
      live.self.current = true;
      planData.bumpEvents();
      if (saved) after.current = { flash: saved.id, anchor: day && day !== firstDay ? day : undefined };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firstDay],
  );

  return (
    <EventDetail
      event={event}
      day={d.day}
      time={d.time}
      goals={goals}
      origin={origin}
      onRequestClose={onRequestClose}
      onChanged={onChanged}
      onDirty={live.onDirty}
      gone={live.gone}
      version={version}
    />
  );
}

function GoalHost({ d, origin, goals, onRequestClose, after }: { d: Extract<Detail, { kind: "goal" }>; origin: HTMLElement | null; goals: Goal[] | null; onRequestClose: (via: CloseVia) => Promise<boolean>; after: React.MutableRefObject<After | null> }) {
  const live = useLive(onRequestClose);
  const current = d.goal && goals ? (goals.find((g) => g.id === d.goal!.id) ?? null) : d.goal;
  const [version, setVersion] = useState(d.goal?.updated_at ?? "0");
  useEffect(() => {
    if (!d.goal || !goals || live.self.current) return;
    if (!current) return live.setGone(true);
    if (!live.dirty.current && current.updated_at !== version) setVersion(current.updated_at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.updated_at, goals]);

  const onChanged = useCallback(
    (saved?: Goal) => {
      live.self.current = true;
      planData.bumpPlan();
      if (saved) after.current = { flash: saved.id };
      else planData.bumpEvents(); // deleted: its entries lost their goal
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <GoalDetail
      goal={current ?? d.goal}
      focusEffort={d.focusEffort}
      dream={d.dream}
      origin={origin}
      onRequestClose={onRequestClose}
      onChanged={onChanged}
      onDirty={live.onDirty}
      gone={live.gone}
      version={version}
    />
  );
}

const habitVersion = (h: Habit) => JSON.stringify([h.title, h.per_week, h.goal_id]);

function HabitHost({ d, origin, goals, habits, onRequestClose, after }: { d: Extract<Detail, { kind: "habit" }>; origin: HTMLElement | null; goals: Goal[]; habits: Habit[] | null; onRequestClose: (via: CloseVia) => Promise<boolean>; after: React.MutableRefObject<After | null> }) {
  const live = useLive(onRequestClose);
  const current = d.habit && habits ? (habits.find((h) => h.id === d.habit!.id) ?? null) : d.habit;
  const [version, setVersion] = useState(d.habit ? habitVersion(d.habit) : "0");
  useEffect(() => {
    if (!d.habit || !habits || live.self.current) return;
    if (!current) return live.setGone(true);
    const v = habitVersion(current);
    if (!live.dirty.current && v !== version) setVersion(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, habits]);

  const onChanged = useCallback(
    (saved?: Habit) => {
      live.self.current = true;
      planData.bumpPlan();
      if (saved) after.current = { flash: saved.id };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <HabitDetail
      habit={current ?? d.habit}
      goals={goals}
      origin={origin}
      onRequestClose={onRequestClose}
      onChanged={onChanged}
      onDirty={live.onDirty}
      gone={live.gone}
      version={version}
    />
  );
}

export function DetailHost() {
  const { detail, detailOrigin, close, setAnchor, flash } = useSpace();
  const { goals, habits } = usePlanData();
  const after = useRef<After | null>(null);
  const keys = useRef(new WeakMap<Detail, number>());
  const seq = useRef(0);

  // once the panel has closed: Tag follows a moved entry, the saved item glows
  useEffect(() => {
    if (detail || !after.current) return;
    const a = after.current;
    after.current = null;
    if (a.anchor) setAnchor(a.anchor);
    if (a.flash) flash(a.flash);
  }, [detail, setAnchor, flash]);

  if (!detail) return null;
  let key = keys.current.get(detail);
  if (key === undefined) {
    key = ++seq.current;
    keys.current.set(detail, key);
  }
  const all = goals ?? [];
  if (detail.kind === "event") return <EventHost key={key} d={detail} origin={detailOrigin} goals={all} onRequestClose={close} after={after} />;
  if (detail.kind === "goal") return <GoalHost key={key} d={detail} origin={detailOrigin} goals={goals} onRequestClose={close} after={after} />;
  return <HabitHost key={key} d={detail} origin={detailOrigin} goals={all} habits={habits} onRequestClose={close} after={after} />;
}
