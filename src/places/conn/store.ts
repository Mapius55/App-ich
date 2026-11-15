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
