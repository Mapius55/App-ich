// One goal in Ziele (§3.5): typography, not a card. Title (→ goal Unfold), date line,
// a 3 px progress line (hours if estimated, else steps), the hours line with the
// feasibility word, the next step to tick, and the other steps folded in place. Without an estimate
// only the hours invested show: «Aufwand schätzen» lives in the goal's detail, not under every goal.
import { useEffect, useRef, useState } from "react";
import { daysBetween, daysLeftLabel, durationLabel, goalEffort, goalProgress, hoursLabel, type GoalEffort } from "../lib/plan";
import { shortDay } from "../lib/dates";
import type { Goal, Milestone } from "../lib/types";
import { IconCheck, IconPlus } from "../components/plan/icons";
import { planData } from "../space/data";
import { useFresh, useSeenWhenVisible } from "../space/fresh";
import { useSpace } from "../space/state";
import { useRevealWhenFresh } from "./reveal";
import { SportsPicker } from "./conn/SportsPicker";
import { useNolioAvailable } from "./conn/store";

/** "So, 6. Dez · noch 22 Tage", or null for an open-ended goal */
export function goalMeta(goal: Pick<Goal, "target_date">, today: string): string | null {
  if (!goal.target_date) return null;
  return `${shortDay(goal.target_date)} · ${daysLeftLabel(daysBetween(today, goal.target_date))}`;
}

const nb = (s: string) => s.replace(/ /g, " "); // keeps "12 Std/Woche" on one line

/** "23 von ≈ 60 Std · 12 Std/Woche nötig", or null without an estimate */
export function hoursLine(e: GoalEffort): string | null {
  if (e.effort === null) return null;
  const parts = [`${hoursLabel(e.done)} von ${nb(`≈ ${hoursLabel(e.effort)} Std`)}`];
  if (e.remaining !== 0) {
    if (e.neededPerWeek !== null) parts.push(`${nb(`${hoursLabel(e.neededPerWeek)} Std/Woche`)} nötig`);
    else if (e.weeksToFinish !== null && e.available !== null) parts.push(`bei ${nb(`${hoursLabel(e.available)} Std/Woche`)} ${nb(`ca. ${durationLabel(e.weeksToFinish)}`)}`);
  }
  return parts.join(" · ");
}

function Feasibility({ e }: { e: GoalEffort }) {
  if (e.feasibility === "erreicht")
    return (
      <span className="gb-feas reached">
        <span aria-hidden="true">erreicht</span>
        <span className="sr-only">Die geschätzten Stunden sind erreicht.</span>
      </span>
    );
  if (e.feasibility !== "knapp" && e.feasibility !== "kaum machbar") return null;
  const tight = e.feasibility === "knapp";
  const detail = `etwa ${hoursLabel(e.neededPerWeek ?? 0)} Stunden pro Woche nötig, du hast ${hoursLabel(e.available ?? 0)}`;
  return (
    <span className={`gb-feas ${tight ? "tight" : "hard"}`}>
      <span aria-hidden="true">{e.feasibility}</span>
      <span className="sr-only">{tight ? `Wird knapp: ${detail}.` : `Kaum machbar: ${detail}.`}</span>
    </span>
  );
}

const JUST_DONE_MS = 1400; // a ticked next step stays a moment before the next one moves up

function StepRow({ m, label, next, onToggle }: { m: Milestone; label?: string; next?: boolean; onToggle(): void }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!m.done_at} className={`gb-step${next ? " next" : ""}${m.done_at ? " done" : ""}`} onClick={onToggle}>
      <span className="gb-check" aria-hidden="true">
        <IconCheck size={next ? 15 : 13} />
      </span>
      <span className="gb-step-text">
        <span className="gb-step-title">{m.title}</span>
        {label && <span className="gb-step-label">{label}</span>}
      </span>
    </button>
  );
}

function AddStep({ goal, first }: { goal: Goal; first: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" className="pl-quiet gb-add" onClick={() => setOpen(true)}>
        <IconPlus size={16} />
        {first ? "Erste Etappe hinzufügen" : "Etappe hinzufügen"}
      </button>
    );
  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await planData.addMilestone(goal, t);
      setTitle(""); // stay open: several steps are often added in a row
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="gb-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="plain-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault(); // keeps the space from leaving Ziele
          setOpen(false);
          setTitle("");
        }}
        placeholder="Nächster Schritt"
        aria-label="Neue Etappe"
        maxLength={200}
        autoFocus
      />
      <button type="submit" className="dock-main small" disabled={!title.trim() || busy} aria-label="Etappe hinzufügen">
        <IconPlus size={18} />
      </button>
      <button type="button" className="btn quiet" onClick={() => (setOpen(false), setTitle(""))}>
        Fertig
      </button>
    </form>
  );
}

export function GoalBlock({ goal, today, flash, active }: { goal: Goal; today: string; flash: boolean; active: boolean }) {
  const { open, reduced } = useSpace();
  const ref = useRef<HTMLElement>(null);
  const fresh = useFresh(goal.id);
  useSeenWhenVisible(ref, goal.id);
  useRevealWhenFresh(ref, fresh, active, reduced);
  const [expanded, setExpanded] = useState(false);
  const [justDone, setJustDone] = useState<string | null>(null);
  const timer = useRef(0);
  // which Nolio trainings count: only where Nolio is there (nothing else reads goals.sports)
  const nolio = useNolioAvailable();
  useEffect(() => () => clearTimeout(timer.current), []);

  const p = goalProgress(goal, today);
  const e = goalEffort(goal, today);
  const meta = goalMeta(goal, today);
  const paused = goal.status === "paused";
  const ms = [...goal.milestones].sort((a, b) => a.position - b.position);
  const step = (justDone && ms.find((m) => m.id === justDone)) || p.next;
  const others = ms.filter((m) => m.id !== step?.id);
  const further = others.filter((m) => !m.done_at).length;
  const line = hoursLine(e);

  const tickNext = (m: Milestone) => {
    clearTimeout(timer.current);
    planData.toggleMilestone(m);
    if (m.done_at) return setJustDone(null); // un-ticked again
    setJustDone(m.id);
    timer.current = window.setTimeout(() => setJustDone(null), JUST_DONE_MS);
  };

  const ratio = e.effort !== null ? Math.min(1, e.done / e.effort) : p.total > 0 ? p.ratio : null;
  const openGoal = () => open({ kind: "goal", goal }, ref.current);
  const regionId = `gb-more-${goal.id}`;

  return (
    <article ref={ref} data-id={goal.id} className={`gb${paused ? " paused" : ""}${fresh ? " is-fresh" : ""}${flash ? " is-flash" : ""}`}>
      <button type="button" className="gb-title" onClick={() => openGoal()} aria-label={`Ziel bearbeiten: ${goal.title}${fresh ? ", neu vom Coach" : ""}`}>
        {goal.title}
        {fresh && (
          <span className="fresh-tag" aria-hidden="true">
            neu
          </span>
        )}
      </button>
      {(meta || paused) && (
        <p className="gb-meta">
          {meta}
          {meta && paused ? " · " : ""}
          {paused ? "pausiert" : ""}
        </p>
      )}

      {ratio !== null && (
        <div
          className="gb-bar"
          role="progressbar"
          aria-label={`Fortschritt ${goal.title}`}
          aria-valuemin={0}
          aria-valuemax={e.effort ?? p.total}
          aria-valuenow={e.effort !== null ? Math.min(e.done, e.effort) : p.done}
          aria-valuetext={e.effort !== null ? `${hoursLabel(e.done)} von etwa ${hoursLabel(e.effort)} Stunden` : `${p.done} von ${p.total} Etappen`}
        >
          <span style={{ transform: `scaleX(${ratio})` }} />
        </div>
      )}

      {line !== null ? (
        <p className="gb-hours">
          <span>{line}</span>
          <Feasibility e={e} />
        </p>
      ) : (
        e.done > 0 && (
          <p className="gb-hours quiet">
            <span>{hoursLabel(e.done)} Std investiert</span>
          </p>
        )
      )}

      {step && <StepRow m={step} next label={`Als Nächstes · ${p.done} von ${p.total} Etappen`} onToggle={() => tickNext(step)} />}

      {others.length > 0 ? (
        <>
          <button type="button" className="pl-quiet gb-more" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded((x) => !x)}>
            {expanded ? "Weniger anzeigen" : further > 0 ? `+ ${further} weitere ${further === 1 ? "Etappe" : "Etappen"}` : "Alle Etappen"}
          </button>
          <div id={regionId} className="pl-unfold" data-open={expanded || undefined} inert={!expanded}>
            <div className="pl-unfold-inner">
              {others.map((m) => (
                <StepRow key={m.id} m={m} onToggle={() => planData.toggleMilestone(m)} />
              ))}
              <AddStep goal={goal} first={false} />
            </div>
          </div>
        </>
      ) : (
        <AddStep goal={goal} first={ms.length === 0} />
      )}
      {nolio && <SportsPicker goal={goal} />}
    </article>
  );
}
