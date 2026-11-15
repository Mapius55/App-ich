// The shared connection state: a status answer that was on its way when a newer value was put (a
// confirm, a login change) must not overwrite it.
import { describe, expect, it, vi } from "vitest";
import type { WhoopStatus } from "../src/lib/types";

const pending: ((v: WhoopStatus | null) => void)[] = [];
vi.mock("../src/lib/backend", () => ({
  backend: {
    whoopStatus: () => new Promise<WhoopStatus | null>((r) => pending.push(r)),
    nolioStatus: () => Promise.resolve(null),
    onAuthChange: () => () => {},
  },
}));

const { connStore } = await import("../src/places/conn/store");

const status = (s: Partial<WhoopStatus>): WhoopStatus => ({
  available: true,
  connected: false,
  status: null,
  consent_ai: false,
  connected_at: null,
  last_sync_at: null,
  last_error: null,
  attribution: "Daten von WHOOP",
  days: [],
  ...s,
});

describe("connection store", () => {
  it("drops a status answer that arrives after a confirm put a newer one", async () => {
    connStore.reset();
    const load = connStore.loadWhoop();
    connStore.setWhoop(status({ connected: true, status: "connected" })); // the confirm's answer
    pending.shift()!(status({ status: "pending" })); // the page-load status, late
    await load;
    expect(connStore.whoop().value?.status).toBe("connected");
  });

  it("uses only the newest of two loads", async () => {
    connStore.reset();
    const a = connStore.loadWhoop();
    const b = connStore.loadWhoop(true);
    const [first, second] = [pending.shift()!, pending.shift()!];
    second(status({ status: "pending" }));
    first(status({ connected: true, status: "connected" }));
    await Promise.all([a, b]);
    expect(connStore.whoop().value?.status).toBe("pending");
  });

  it("forgets everything when the login changes", async () => {
    connStore.setWhoop(status({ connected: true, status: "connected" }));
    const load = connStore.loadWhoop(true);
    connStore.reset();
    pending.shift()!(status({ connected: true, status: "connected" }));
    await load;
    expect(connStore.whoop().value).toBeUndefined();
  });
});
