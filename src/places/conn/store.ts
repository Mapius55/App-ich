// The connection states (WHOOP, Nolio), loaded once and shared: Du › Verbindungen, the onboarding
// chooser and the goal's sports picker read the same snapshot. Cleared when the login changes.
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
let epoch = 0; // bumps on reset, so a late answer for the previous login is dropped
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function run<T>(call: () => Promise<T | null>, put: (l: Loaded<T>) => void): Promise<void> {
  const at = epoch;
  return call().then(
    (value) => {
      if (at === epoch) put({ value, failed: false });
    },
    () => {
      if (at === epoch) put({ value: null, failed: true });
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
    whoop = { value, failed: false };
    emit();
  },
  setNolio(value: NolioStatus | null): void {
    nolio = { value, failed: false };
    emit();
  },
  reset(): void {
    epoch++;
    whoop = INITIAL;
    nolio = INITIAL;
    whoopRun = null;
    nolioRun = null;
    emit();
  },
};

backend.onAuthChange(() => connStore.reset());

/** the WHOOP state, loaded on first use */
export function useWhoop(): Loaded<WhoopStatus> {
  const snap = useSyncExternalStore(connStore.subscribe, connStore.whoop, connStore.whoop);
  useEffect(() => {
    connStore.loadWhoop();
  }, []);
  return snap;
}

/** the Nolio state, loaded on first use */
export function useNolio(): Loaded<NolioStatus> {
  const snap = useSyncExternalStore(connStore.subscribe, connStore.nolio, connStore.nolio);
  useEffect(() => {
    connStore.loadNolio();
  }, []);
  return snap;
}

/** Nolio can be used by this account (the owner): the goal's sports picker shows only then */
export function useNolioAvailable(): boolean {
  const n = useNolio();
  return !!n.value?.available;
}
