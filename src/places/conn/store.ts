// The connection states (WHOOP, Nolio), loaded once and shared: Du › Verbindungen, the onboarding
// chooser and the goal's sports picker read the same snapshot. Cleared when another person logs in
// (not on the auth events of the same person: supabase-js sends SIGNED_IN on every return to the app
// and TOKEN_REFRESHED about hourly), and loaded again by whoever shows it.
import { useEffect, useSyncExternalStore } from "react";
import { backend } from "../../lib/backend";
import type { NolioStatus, WhoopStatus } from "../../lib/types";

/** value: undefined = loading, null = not deployed / unreachable; failed = the call errored otherwise */
export interface Loaded<T> {
  value: T | null | undefined;
  failed: boolean;
}

const INITIAL = { value: undefined, failed: false } as const;
let whoop: Loaded<WhoopStatus> = INITIAL;
let nolio: Loaded<NolioStatus> = INITIAL;
let whoopRun: Promise<void> | null = null;
let nolioRun: Promise<void> | null = null;
// Every load and every set takes a ticket; an answer is used only while its ticket is the newest for
// that service. So a status call that was on its way when a confirm (or a reset at a login change)
// put a newer value can't overwrite it.
const ticket = { whoop: 0, nolio: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function run<T>(key: keyof typeof ticket, call: () => Promise<T | null>, put: (l: Loaded<T>) => void): Promise<void> {
  const at = ++ticket[key];
  return call().then(
    (value) => {
      if (at === ticket[key]) put({ value, failed: false });
    },
    () => {
      if (at === ticket[key]) put({ value: null, failed: true });
    },
  );
}

export const connStore = {
  whoop: (): Loaded<WhoopStatus> => whoop,
  nolio: (): Loaded<NolioStatus> => nolio,
  subscribe(fn: () => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  /** loads once; `force` asks again (after a change or "Nochmal versuchen") */
  loadWhoop(force = false): Promise<void> {
    if (whoopRun && !force) return whoopRun;
    if (!force && whoop.value !== undefined && !whoop.failed) return Promise.resolve();
    const p = run(
      "whoop",
      () => backend.whoopStatus(),
      (l) => {
        whoop = l;
        emit();
      },
    ).finally(() => {
      if (whoopRun === p) whoopRun = null;
    });
    whoopRun = p;
    return p;
  },
  loadNolio(force = false): Promise<void> {
    if (nolioRun && !force) return nolioRun;
    if (!force && nolio.value !== undefined && !nolio.failed) return Promise.resolve();
    const p = run(
      "nolio",
      () => backend.nolioStatus(),
      (l) => {
        nolio = l;
        emit();
      },
    ).finally(() => {
      if (nolioRun === p) nolioRun = null;
    });
    nolioRun = p;
    return p;
  },
  setWhoop(value: WhoopStatus | null): void {
    ticket.whoop++;
    whoop = { value, failed: false };
    emit();
  },
  setNolio(value: NolioStatus | null): void {
    ticket.nolio++;
    nolio = { value, failed: false };
    emit();
  },
  reset(): void {
    ticket.whoop++;
    ticket.nolio++;
    whoop = INITIAL;
    nolio = INITIAL;
    whoopRun = null;
    nolioRun = null;
    emit();
  },
};

/**
 * Resets the store only when the person really changes. `undefined` = not known yet: the first answer
 * (the current login, or the first auth event) only sets it.
 */
export function watchLogin(source: Pick<typeof backend, "onAuthChange" | "currentUserId">, onChange: () => void): () => void {
  let last: string | null | undefined;
  const seen = (id: string | null) => {
    if (last === undefined) {
      last = id;
      return;
    }
    if (id === last) return;
    last = id;
    onChange();
  };
  source.currentUserId().then(
    (id) => {
      if (last === undefined) last = id;
    },
    () => {},
  );
  return source.onAuthChange(seen);
}

watchLogin(backend, () => connStore.reset());

/** the WHOOP state, loaded on first use and again whenever it was cleared (another login) */
export function useWhoop(): Loaded<WhoopStatus> {
  const snap = useSyncExternalStore(connStore.subscribe, connStore.whoop, connStore.whoop);
  useEffect(() => {
    if (snap.value === undefined && !snap.failed) void connStore.loadWhoop();
  }, [snap]);
  return snap;
}

/** the Nolio state, loaded on first use and again whenever it was cleared (another login) */
export function useNolio(): Loaded<NolioStatus> {
  const snap = useSyncExternalStore(connStore.subscribe, connStore.nolio, connStore.nolio);
  useEffect(() => {
    if (snap.value === undefined && !snap.failed) void connStore.loadNolio();
  }, [snap]);
  return snap;
}

/** Nolio can be used by this account (the owner): the goal's sports picker shows only then */
export function useNolioAvailable(): boolean {
  const n = useNolio();
  return !!n.value?.available;
}
