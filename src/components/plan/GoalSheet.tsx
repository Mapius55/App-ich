import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { dayOf, durationLabel, goalEffort, hoursLabel, PLAN_B_MAX } from "../../lib/plan";
import { shortDay } from "../../lib/dates";
import type { Goal, GoalKind, GoalStatus } from "../../lib/types";
import { unlockAudio } from "../../lib/voice";
import { fulfilledDay, fulfilledLabel, tellText } from "../../places/bucket";
import { markWashed, WASH_MS } from "../../places/fulfilled";
import { closeDecision } from "../../space/closeDecision";
import * as coachBus from "../../space/coachBus";
import { ConfirmDelete as ConfirmInline } from "../../space/ConfirmDelete";
import { SpaceContext, type CloseVia } from "../../space/state";
import { Unfold, useUnfold, useUnfoldClose } from "../../space/Unfold";
import { ConfirmDelete, Sheet } from "./Sheet";
import { IconClose, IconPlus } from "./icons";

export const GOAL_STATUS: { key: GoalStatus; label: string }[] = [
  { key: "active", label: "Aktiv" },
  { key: "paused", label: "Pausiert" },
  { key: "done", label: "Erreicht" },
  { key: "dropped", label: "Aufgegeben" },
];
/** a dream in the detail: fulfilling it is its own action («Erfüllt»), letting go is gentle */
const DREAM_STATUS: { key: GoalStatus; label: string }[] = [
  { key: "active", label: "Aktiv" },
  { key: "paused", label: "Pausiert" },
  { key: "dropped", label: "Losgelassen" },
];
/** a dream in the old sheet (flag off): all four, done reads «Erfüllt» */
const DREAM_STATUS_SHEET: { key: GoalStatus; label: string }[] = [
  { key: "active", label: "Aktiv" },
  { key: "paused", label: "Pausiert" },
  { key: "done", label: "Erfüllt" },
  { key: "dropped", label: "Losgelassen" },
];

interface Draft {
  key: string;
  id?: string; // existing milestone
  title: string;
  removed?: boolean;
}

// Hours as typed: "1,5", "1.5" or "10'000"; "" = not set, NaN = not a number.
function parseHours(v: string): number | null {
  const t = v.trim().replace(/['’\s]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN;
}
const hoursText = (n: number | null | undefined) => (n ? String(n) : "");

const HOURS_FIELDS = [
  { key: "effort", label: "Aufwand gesamt (Std)", placeholder: "z.B. 120", max: 100000 },
  { key: "weekly", label: "Zeit pro Woche (Std)", placeholder: "z.B. 6", max: 168 },
  { key: "prior", label: "Schon investiert (Std)", placeholder: "0", max: 100000 },
] as const;
type HoursKey = (typeof HOURS_FIELDS)[number]["key"];

function hoursProblem(key: HoursKey, n: number | null): string | null {
  if (n === null) return null;
  if (Number.isNaN(n) || n < 0) return "Bitte die Stunden als Zahl, z.B. 120 oder 1,5.";
  if (key === "weekly" && n > 168) return "Eine Woche hat höchstens 168 Stunden.";
  if (n > 100000) return "Höchstens 100'000 Stunden.";
  return null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface GoalFormProps {
  goal: Goal | null; // null = new goal
  /** opened from "Aufwand schätzen": start in the effort fields */
  focusEffort?: boolean;
  /** a new one starts on the Bucket List (kind dream) */
  dream?: boolean;
  /** the toggle «Auf der Bucket List» changed (the detail's kind pill follows) */
  onKind?: (dream: boolean) => void;
  /** "sheet": the old bottom sheet (flag off); "detail": inside an Unfold */
  variant: "sheet" | "detail";
  /** sheet only: closes the sheet */
  close?: () => void;
  /** after saving or deleting (with the stored goal when saved) */
  onChanged: (saved?: Goal) => void;
  /** detail: whether there are local edits (a coach update then waits) */
  onDirty?: (dirty: boolean) => void;
  /** detail: the goal no longer exists (deleted elsewhere): closing never saves */
  gone?: boolean;
}

/** The goal form body: shared by the old sheet and the Unfold detail. */
export function GoalForm({ goal, focusEffort, dream: newDream, onKind, variant, close, onChanged, onDirty, gone }: GoalFormProps) {
  const detail = variant === "detail";
  const space = useContext(SpaceContext);
  const unfold = useUnfold();
  const [kind, setKindState] = useState<GoalKind>(goal ? (goal.kind ?? "goal") : newDream ? "dream" : "goal");
  const isDream = kind === "dream";
  const setKind = (k: GoalKind) => {
    setKindState(k);
    onKind?.(k === "dream");
  };
  const [memory, setMemory] = useState(goal?.memory ?? "");
  // «Erfüllt» pressed here: the colour-flow wash runs once over the item, then «Wie war es?»
  const [washing, setWashing] = useState(false);
  const washTimer = useRef(0);
  const fulfilledHere = useRef(false);
  useEffect(() => () => clearTimeout(washTimer.current), []);
  const tellRef = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState(goal?.title ?? "");
  const [target, setTarget] = useState(goal?.target_date ?? "");
  const [why, setWhy] = useState(goal?.why ?? "");
  // her Plan B, one if-then sentence (the coach asks once for a serious goal; she can write or change it here)
  const [planB, setPlanB] = useState(goal?.plan_b ?? "");
  // a dream shows the field only when it has a Plan B (stored, or written while it was a goal); once shown it
  // stays while she empties it, so clearing it never pulls the field away under her fingers
  const [planBShown, setPlanBShown] = useState(() => !!goal?.plan_b?.trim());
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? "active");
  const [hours, setHours] = useState<Record<HoursKey, string>>({
    effort: hoursText(goal?.effort_hours),
    weekly: hoursText(goal?.weekly_hours),
    prior: hoursText(goal?.prior_hours),
  });
  const [effortShown, setEffortShown] = useState(() => !!focusEffort || Object.values(hours).some((v) => v !== ""));
  const hintId = useId();
  const statusId = useId();
  const kindId = useId();
  // a reached or dropped goal opens with its status first: setting it back is the likely reason to open it
  const finished = goal?.status === "done" || goal?.status === "dropped";
  const [steps, setSteps] = useState<Draft[]>(() =>
    [...(goal?.milestones ?? [])].sort((a, b) => a.position - b.position).map((m) => ({ key: m.id, id: m.id, title: m.title })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  // detail: the values as loaded, to tell local edits apart
  const values = JSON.stringify([kind, title, target, why, planB, status, memory, hours, steps.filter((x) => !x.removed).map((x) => [x.id ?? "", x.title])]);
  const loaded = useRef(values);
  const dirty = values !== loaded.current;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const release = useRef(false); // saved, discarded or deleted: closing needs nothing more
  const askRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) askRef.current?.focus({ preventScroll: true });
  }, [asking]);

  const parsed = { effort: parseHours(hours.effort), weekly: parseHours(hours.weekly), prior: parseHours(hours.prior) };
  const valid = (n: number | null) => (n === null || Number.isNaN(n) ? null : n);
  // what the numbers mean, live while typing
  const effort = goalEffort(
    {
      effort_hours: valid(parsed.effort),
      weekly_hours: valid(parsed.weekly),
      prior_hours: valid(parsed.prior) ?? 0,
      target_date: target || null,
      time: goal?.time ?? { logged_minutes: 0, block_minutes: 0 },
    },
    dayOf(),
  );
  const tracked = goal ? Math.round((goal.time.logged_minutes + goal.time.block_minutes) / 6) / 10 : 0;

  /** what is missing or wrong, else null */
  const problem = (): string | null => {
    if (!title.trim()) return isDream ? "Wie heisst dein Traum?" : "Wie heisst dein Ziel?";
    for (const f of HOURS_FIELDS) {
      const p = hoursProblem(f.key, parsed[f.key]);
      if (p) return p;
    }
    return null;
  };

  /** stores the goal and its steps; the stored goal */
  const store = async (): Promise<Goal> => {
    // the Plan B only when it changed: her own sentence then replaces the coach's note of the obstacle (its «Wenn» says it)
    const plan = planB.trim() || null;
    const planPatch = plan !== (goal?.plan_b?.trim() || null) ? { plan_b: plan, ...(goal ? { obstacle: null } : {}) } : {};
    const input = {
      title: title.trim(),
      kind,
      target_date: target || null,
      why: why.trim() || null,
      effort_hours: parsed.effort || null,
      weekly_hours: parsed.weekly || null,
      prior_hours: parsed.prior ?? 0,
      memory: memory.trim() || null,
      ...planPatch,
    };
    if (!goal) {
      const ms = steps.filter((s) => !s.removed && s.title.trim()).map((s) => ({ title: s.title.trim(), due_date: null }));
      return backend.addGoal(input, ms);
    }
    const saved = await backend.updateGoal(goal.id, { ...input, status });
    const before = new Map(goal.milestones.map((m) => [m.id, m]));
    for (const s of steps) {
      const t2 = s.title.trim();
      if (s.id && (s.removed || !t2)) await backend.deleteMilestone(s.id);
      else if (s.id && t2 !== before.get(s.id)?.title) await backend.updateMilestone(s.id, { title: t2 });
      else if (!s.id && !s.removed && t2) await backend.addMilestone(goal.id, { title: t2, due_date: null });
    }
    return saved;
  };

  // the old sheet: save, then close
  const save = async (closeSheet: () => void) => {
    const p = problem();
    if (p) return setError(p);
    setBusy(true);
    setError(null);
    try {
      await store();
      onChanged();
      closeSheet();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  // the detail: store it; false keeps the panel open with the error
  const commit = async (): Promise<boolean> => {
    const p = problem();
    if (p) {
      setError(p);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await store();
      release.current = true;
      // the wash already ran here: the Bucket List doesn't wash it a second time
      if (saved.kind === "dream" && saved.status === "done" && fulfilledHere.current) markWashed(saved.id);
      onChanged(saved);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // every close path of the Unfold asks here first (D6)
  useUnfoldClose(async (via: CloseVia) => {
    if (gone || release.current) return true;
    if (busy) return false;
    const p = problem();
    const action = closeDecision({ isNew: !goal, dirty, valid: !p, titled: !!title.trim() }, via);
    if (action === "close") return true;
    if (action === "ask") {
      setAsking(true);
      return false;
    }
    if (action === "stay") {
      setError(p);
      return false;
    }
    return commit();
  });

  const add = async () => {
    if (await commit()) unfold?.requestClose("done");
  };

  // «Erfüllt»: done (stored on close, like every edit here), the wash (none under reduced
  // motion), then «Wie war es? Erzähl es mir.» takes the focus
  const fulfil = () => {
    setStatus("done");
    fulfilledHere.current = true;
    if (!space?.reduced) {
      setWashing(true);
      clearTimeout(washTimer.current);
      washTimer.current = window.setTimeout(() => setWashing(false), WASH_MS);
    }
    requestAnimationFrame(() => tellRef.current?.focus({ preventScroll: true }));
  };
  // «Wieder offen»: back on the list as an open dream
  const reopen = () => {
    setStatus("active");
    fulfilledHere.current = false;
    setWashing(false);
  };
  // «Wie war es? Erzähl es mir.»: store it, close, and the coach asks by voice
  const tell = () => {
    void unlockAudio(); // inside the tap (iPhone)
    const text = tellText(title || goal?.title || "");
    void (unfold ? unfold.requestClose("done") : Promise.resolve(true)).then((closed) => {
      if (closed) coachBus.ask(text);
    });
  };

  const statusOptions = isDream ? (detail ? DREAM_STATUS : DREAM_STATUS_SHEET) : GOAL_STATUS;
  const statusField = goal && (
    <div className="sheet-field">
      <span id={statusId}>Status</span>
      <div className={`segmented ${statusOptions.length === 3 ? "three" : "four"}`} role="radiogroup" aria-labelledby={statusId}>
        {statusOptions.map((s) => (
          <button key={s.key} type="button" role="radio" aria-checked={status === s.key} className={status === s.key ? "on" : ""} onClick={() => setStatus(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );

  const kindField = (
    <label className="toggle-row sheet-toggle uf-kind">
      <span id={kindId}>Auf der Bucket List</span>
      <input type="checkbox" className="switch" role="switch" checked={isDream} onChange={(e) => setKind(e.target.checked ? "dream" : "goal")} aria-labelledby={kindId} />
    </label>
  );

  const memoryField = (
    <label className="sheet-field">
      <span>Erinnerung</span>
      <textarea value={memory} onChange={(e) => setMemory(e.target.value)} rows={3} maxLength={1000} placeholder="Wie war es?" />
    </label>
  );

  // a dream in the detail: «Erfüllt» while it is open, the fulfilled block once it came true
  const doneDream = isDream && status === "done";
  const fulfilledAt = goal?.status === "done" && goal.done_at ? goal : { done_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const dreamTop =
    detail && isDream && goal ? (
      doneDream ? (
        <div className="uf-fulfilled">
          <p className={`uf-fulfilled-date${washing ? " bl-wash" : ""}`} role="status">
            <span className="bl-flow">{fulfilledLabel(fulfilledAt, true)}</span>
          </p>
          {!goal.memory && space && (
            <button ref={tellRef} type="button" className="uf-link uf-tell" onClick={tell}>
              Wie war es? Erzähl es mir.
            </button>
          )}
          {memoryField}
          <button type="button" className="btn quiet uf-reopen" onClick={reopen}>
            Wieder offen
          </button>
        </div>
      ) : status !== "dropped" ? (
        <button type="button" className="uf-fulfil" onClick={fulfil}>
          <span className="uf-fulfil-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.2 4.2L19 7" />
            </svg>
          </span>
          <span className="bl-flow">Erfüllt</span>
        </button>
      ) : null
    ) : null;

  // «Im Jahr ansehen»: a goal opens this year filtered to its time; a dream opens the year it came
  // true or is planned for (no filter: a dream rarely has logged time), else its time if it has
  // some, else nothing
  const yearLink = ((): { label: string; go: { day?: string; yearGoal: string | null } } | null => {
    if (!goal) return null;
    const timed = goal.time.logged_minutes + goal.time.block_minutes > 0;
    if (!isDream) return { label: "Im Jahr ansehen", go: { yearGoal: goal.id } };
    const day = doneDream ? fulfilledDay(fulfilledAt) : target || null;
    const y = day ? Number(day.slice(0, 4)) : null;
    if (day && y !== null && y <= Number(dayOf().slice(0, 4)) + 1) return { label: `Im Jahr ${y} ansehen`, go: { day, yearGoal: null } };
    if (timed) return { label: "Im Jahr ansehen", go: { yearGoal: goal.id } };
    return null;
  })();

  const setStep = (key: string, patch: Partial<Draft>) => setSteps((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const titleInput = detail ? (
    // a dream's name is often a whole sentence: in the detail it wraps (one line, no Enter)
    <TitleArea
      value={title}
      onChange={setTitle}
      placeholder={isDream ? "z.B. Polarlichter sehen" : "z.B. Halbmarathon"}
      label={isDream ? "Was möchtest du erleben?" : "Worauf arbeitest du hin?"}
      autoFocus={!goal}
    />
  ) : (
    <input
      className="plain-input"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder={isDream ? "z.B. Polarlichter sehen" : "z.B. Halbmarathon"}
      maxLength={200}
      data-autofocus={goal ? undefined : true}
    />
  );

  const targetField = (
    <label className="sheet-field">
      <span>{isDream ? "Wann? (optional)" : "Bis wann? (optional)"}</span>
      <span className="row">
        <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        {target && (
          <button type="button" className="dock-round small" onClick={() => setTarget("")} aria-label="Datum entfernen">
            <IconClose />
          </button>
        )}
      </span>
    </label>
  );

  // a dream rarely needs hours: in the detail its effort fields show once there are some (or on request)
  const showEffort = !isDream || effortShown || !detail;
  const rest = (
    <>
      {showEffort ? (
        <fieldset className="sheet-field effort-fields" aria-describedby={hintId}>
          <legend>Aufwand (optional)</legend>
          <div className="effort-box">
            {HOURS_FIELDS.map((f, i) => (
              <label key={f.key} className="effort-row">
                <span>{f.label}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  enterKeyHint={i < 2 ? "next" : "done"}
                  value={hours[f.key]}
                  onChange={(e) => setHours((h) => ({ ...h, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  aria-invalid={!!hoursProblem(f.key, parsed[f.key])}
                  data-autofocus={focusEffort && i === 0 ? true : undefined}
                />
              </label>
            ))}
          </div>
          <p id={hintId} className="sheet-hint">
            {effortHint(effort, target, tracked)}
          </p>
        </fieldset>
      ) : (
        <button type="button" className="uf-link uf-effort" onClick={() => setEffortShown(true)}>
          Aufwand schätzen
        </button>
      )}

      <label className="sheet-field">
        <span>Warum ist es dir wichtig? (optional)</span>
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={1000} />
      </label>

      {/* a goal's Plan B; a dream shows one only if it has it (nothing stored stays out of sight) */}
      {(!isDream || planBShown) && (
        <label className="sheet-field">
          <span>Plan B (optional)</span>
          <textarea
            value={planB}
            onChange={(e) => {
              setPlanB(e.target.value);
              if (e.target.value.trim()) setPlanBShown(true);
            }}
            rows={2}
            maxLength={PLAN_B_MAX}
            placeholder="Wenn …, dann …"
          />
        </label>
      )}

      {!finished && !(detail && isDream && status === "done") && statusField}

      <div className="sheet-field">
        <span>Etappen</span>
        <ul className="sheet-steps">
          {steps
            .filter((s) => !s.removed)
            .map((s, i) => (
              <li key={s.key}>
                <input
                  className="plain-input"
                  value={s.title}
                  onChange={(e) => setStep(s.key, { title: e.target.value })}
                  placeholder={`Etappe ${i + 1}`}
                  aria-label={`Etappe ${i + 1}`}
                  maxLength={200}
                />
                <button type="button" className="dock-round small" onClick={() => setStep(s.key, { removed: true })} aria-label={`Etappe ${s.title || i + 1} entfernen`}>
                  <IconClose />
                </button>
              </li>
            ))}
        </ul>
        <button type="button" className="milestone-add" onClick={() => setSteps((xs) => [...xs, { key: `new-${Date.now()}`, title: "" }])}>
          <IconPlus size={16} />
          Etappe hinzufügen
        </button>
      </div>
    </>
  );

  if (!detail)
    return (
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(close ?? (() => {}));
        }}
        onChange={() => error && setError(null)}
      >
        {finished && statusField}

        <label className="sheet-field">
          <span>{isDream ? "Was möchtest du erleben?" : "Worauf arbeitest du hin?"}</span>
          {titleInput}
        </label>

        {kindField}
        {targetField}
        {isDream && status === "done" && memoryField}
        {rest}

        <div className="sheet-actions">
          {error && (
            <p className="form-error sheet-error" role="alert">
              {error}
            </p>
          )}
          {goal && (
            <ConfirmDelete
              label="Löschen"
              question={isDream ? "Traum mit allen Etappen löschen?" : "Ziel mit allen Etappen löschen?"}
              onConfirm={async () => {
                try {
                  await backend.deleteGoal(goal.id);
                  onChanged();
                  close?.();
                } catch (e) {
                  setError(message(e));
                }
              }}
            />
          )}
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={busy}>
            {goal ? "Speichern" : "Hinzufügen"}
          </button>
        </div>
      </form>
    );

  return (
    <form
      className="uf-form"
      onSubmit={(e) => {
        e.preventDefault();
        unfold?.requestClose("done");
      }}
      onChange={() => {
        if (error) setError(null);
        if (asking) setAsking(false);
      }}
      noValidate
    >
      <div className="uf-titlebox" data-unfold-head="">
        {titleInput}
      </div>
      <div className="unfold-body sheet-form">
        {dreamTop}
        {kindField}
        {finished && !doneDream && statusField}
        {targetField}
        {rest}
        {detail && space && goal && yearLink && (
          <button type="button" className="uf-link" onClick={() => space.goLevel(3, yearLink.go)}>
            {yearLink.label}
          </button>
        )}
        <div className="uf-actions">
          {error && (
            <p className="form-error uf-error" role="alert">
              {error}
            </p>
          )}
          {asking ? (
            <div className="uf-ask" role="alert">
              <span>Noch nicht eingetragen.</span>
              <span className="row">
                <button
                  type="button"
                  className="btn quiet"
                  onClick={() => {
                    release.current = true;
                    unfold?.requestClose("done");
                  }}
                >
                  Verwerfen
                </button>
                <button ref={askRef} type="button" className="btn primary" disabled={busy} onClick={add}>
                  Hinzufügen
                </button>
              </span>
            </div>
          ) : (
            <>
              {goal && (
                <ConfirmInline
                  label="Löschen"
                  question={isDream ? "Traum mit allen Etappen löschen?" : "Ziel mit allen Etappen löschen?"}
                  onConfirm={async () => {
                    try {
                      await backend.deleteGoal(goal.id);
                      release.current = true;
                      onChanged();
                      unfold?.requestClose("done");
                    } catch (e) {
                      setError(message(e));
                    }
                  }}
                />
              )}
              <span className="spacer" />
              {!goal && (
                <button type="button" className="btn primary" disabled={busy} onClick={add}>
                  Hinzufügen
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </form>
  );
}

interface Props {
  goal: Goal | null; // null = new goal
  /** opened from "Aufwand schätzen": start in the effort fields */
  focusEffort?: boolean;
  onClose: () => void;
  /** after saving or deleting: reload from the backend */
  onChanged: () => void;
}

/** the old bottom sheet (flag off) */
export function GoalSheet({ goal, focusEffort, onClose, onChanged }: Props) {
  return (
    <Sheet title={goal ? (goal.kind === "dream" ? "Traum" : "Ziel") : "Neues Ziel"} onClose={onClose}>
      {(close) => <GoalForm goal={goal} focusEffort={focusEffort} variant="sheet" close={close} onChanged={() => onChanged()} />}
    </Sheet>
  );
}

export interface GoalDetailProps {
  goal: Goal | null;
  focusEffort?: boolean;
  /** a new one starts on the Bucket List */
  dream?: boolean;
  origin: HTMLElement | null;
  onRequestClose(via: CloseVia): Promise<boolean>;
  onChanged: (saved?: Goal) => void;
  onDirty?: (dirty: boolean) => void;
  gone?: boolean;
  /** remounts the form with fresh values (a coach update while there are no local edits) */
  version?: string;
}

/** the goal as an Unfold (flag on) */
export function GoalDetail({ goal, focusEffort, dream: newDream, origin, onRequestClose, onChanged, onDirty, gone, version }: GoalDetailProps) {
  // the kind pill follows the toggle «Auf der Bucket List»
  const [dream, setDream] = useState(goal ? goal.kind === "dream" : !!newDream);
  const label = dream ? (goal ? "Traum" : "Neuer Traum") : goal ? "Ziel" : "Neues Ziel";
  return (
    <Unfold kindLabel={label} origin={origin} onRequestClose={onRequestClose}>
      <GoalForm key={version} goal={goal} focusEffort={focusEffort} dream={newDream} onKind={setDream} variant="detail" onChanged={onChanged} onDirty={onDirty} gone={gone} />
    </Unfold>
  );
}

/** One calm sentence about what the hours mean; gentle when the time per week won't be enough. */
function effortHint(e: ReturnType<typeof goalEffort>, target: string, tracked: number): string {
  const sofar = tracked > 0 ? ` In der App bisher ${hoursLabel(tracked)} Std.` : "";
  if (e.effort === null)
    return `Wie viele Stunden es etwa braucht. Der Coach schätzt es mit dir, z.B. ein Halbmarathon etwa 60 Std.${sofar}`;
  if (e.remaining === 0) return `Die geschätzten Stunden sind erreicht.${sofar}`;
  if (e.neededPerWeek !== null && target) {
    const need = `Bis ${shortDay(target)} braucht es etwa ${hoursLabel(e.neededPerWeek)} Std pro Woche.`;
    if (e.available === null || e.feasibility === null) return need + sofar;
    const have = `Mit ${hoursLabel(e.available)} Std pro Woche`;
    if (e.feasibility === "machbar") return `${need} ${have} geht das gut.`;
    if (e.feasibility === "knapp") return `${need} ${have} wird es knapp.`;
    return `${need} ${have} ist das kaum machbar. Mehr Zeit pro Woche, ein Zwischenziel oder ein späteres Datum können helfen.`;
  }
  if (e.weeksToFinish !== null && e.available !== null)
    return `Noch etwa ${hoursLabel(e.remaining ?? 0)} Std. Mit ${hoursLabel(e.available)} Std pro Woche sind das ca. ${durationLabel(e.weeksToFinish)}.`;
  return `Noch etwa ${hoursLabel(e.remaining ?? 0)} Std.${sofar}`;
}

/** the detail's big title as a textarea that grows with its text: a long dream wraps instead of
 * being cut. Enter doesn't break the line (it finishes, like the one-line field did). */
function TitleArea({ value, onChange, placeholder, label, autoFocus }: { value: string; onChange(v: string): void; placeholder: string; label: string; autoFocus: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  // a new width (rotation, the font arriving) wraps it anew; outside the observer's
  // callback, so changing the height never loops
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let w = el.clientWidth;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(el);
    void document.fonts?.ready.then(() => fit());
    return () => (ro.disconnect(), cancelAnimationFrame(raf));
  }, []);
  return (
    <textarea
      ref={ref}
      className="uf-title"
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      maxLength={200}
      aria-label={label}
      enterKeyHint="done"
      data-autofocus={autoFocus ? true : undefined}
    />
  );
}
