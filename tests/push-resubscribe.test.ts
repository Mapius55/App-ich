// Silent push re-subscribe after the move to a new address (/App-ich/ → /bucket-list/): the new service
// worker has no subscription. The decision (pure) and the flow with fake browser parts. The consent is
// this person's, on this device: never another account's, never "unknown", never after switching it off.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeBackend = vi.hoisted(() => ({ signedOut: 0, deleted: [] as string[] }));
vi.mock("../src/lib/backend", () => ({
  backend: {
    signOut: async () => void fakeBackend.signedOut++,
    deletePushSubscription: async (e: string) => void fakeBackend.deleted.push(e),
  },
}));

import { choiceFor, disablePush, resetResubscribeForTests, resubscribePushIfNeeded, shouldResubscribe, signOutDevice, type ResubscribeDeps, type ResubscribeFacts } from "../src/lib/push";

const wants: ResubscribeFacts = { supported: true, permission: "granted", notifyMorning: "07:30:00", notifyEvening: null, hasSubscription: false, choice: "on" };

describe("shouldResubscribe", () => {
  it("subscribes again when allowed, wanted, hers and gone", () => {
    expect(shouldResubscribe(wants)).toBe(true);
    expect(shouldResubscribe({ ...wants, notifyMorning: null, notifyEvening: "21:00:00" })).toBe(true);
    expect(shouldResubscribe({ ...wants, notifyEvening: "21:00:00" })).toBe(true);
  });
  it("never without granted permission (it never asks)", () => {
    for (const permission of ["default", "denied", "unsupported"] as const) expect(shouldResubscribe({ ...wants, permission })).toBe(false);
  });
  it("not when no notification time is set", () => {
    expect(shouldResubscribe({ ...wants, notifyMorning: null, notifyEvening: null })).toBe(false);
    expect(shouldResubscribe({ ...wants, notifyMorning: undefined, notifyEvening: undefined })).toBe(false);
    expect(shouldResubscribe({ ...wants, notifyMorning: "", notifyEvening: "" })).toBe(false);
  });
  it("not when this device still has its subscription", () => {
    expect(shouldResubscribe({ ...wants, hasSubscription: true })).toBe(false);
  });
  it("not when the browser can't do push, or the choice is off or unknown", () => {
    expect(shouldResubscribe({ ...wants, supported: false })).toBe(false);
    expect(shouldResubscribe({ ...wants, choice: "off" })).toBe(false);
    expect(shouldResubscribe({ ...wants, choice: null })).toBe(false);
  });
});

describe("choiceFor", () => {
  it("is 'on' only for the account that switched them on here", () => {
    expect(choiceFor("on:A", "A")).toBe("on");
    expect(choiceFor("on:A", "B")).toBe(null);
    expect(choiceFor("off", "A")).toBe("off");
    expect(choiceFor(null, "A")).toBe(null);
    expect(choiceFor("on", "A")).toBe(null); // no account in it: unknown
  });
});

// ---------- the flow ----------

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

function fakes(o: { permission?: NotificationPermission; existing?: boolean; reg?: boolean; key?: string | null; subscribeFails?: boolean; choice?: string | null; session?: () => string | null; owns?: boolean } = {}) {
  const log: string[] = [];
  const sub = { endpoint: "https://push.example/new", unsubscribe: async () => (log.push("unsubscribe"), true) } as unknown as PushSubscription;
  const reg = {
    pushManager: {
      getSubscription: async () => (o.existing ? ({ endpoint: "https://push.example/old" } as PushSubscription) : null),
      subscribe: async (opts: PushSubscriptionOptionsInit) => {
        log.push(`subscribe:${opts.userVisibleOnly}:${(opts.applicationServerKey as Uint8Array).length}`);
        if (o.subscribeFails) throw new DOMException("no gesture", "NotAllowedError");
        return sub;
      },
    },
  } as unknown as ServiceWorkerRegistration;
  let marker = o.choice === undefined ? "on:A" : o.choice;
  const deps: ResubscribeDeps = {
    supported: () => true,
    permission: () => o.permission ?? "granted",
    registration: async () => {
      log.push("registration");
      return o.reg === false ? null : reg;
    },
    publicKey: async () => {
      log.push("key");
      return o.key === undefined ? KEY : o.key;
    },
    save: async (s) => {
      log.push(`save:${o.session ? o.session() : "A"}:${s.endpoint}`);
    },
    choice: () => marker,
    markOn: (uid) => {
      marker = `on:${uid}`;
      log.push(`mark:${uid}`);
    },
    userId: async () => (o.session ? o.session() : "A"),
    owns: async (endpoint) => {
      log.push(`owns:${endpoint}`);
      return o.owns ?? false;
    },
  };
  return { deps, log, marker: () => marker };
}

const profile = { id: "A", notify_morning: "07:30:00", notify_evening: null };

describe("resubscribePushIfNeeded", () => {
  beforeEach(() => resetResubscribeForTests());

  it("subscribes again silently and stores it (which updates app_url)", async () => {
    const { deps, log } = fakes();
    expect(await resubscribePushIfNeeded(profile, deps)).toBe("resubscribed");
    expect(log).toEqual(["registration", "key", "subscribe:true:65", "save:A:https://push.example/new"]);
  });

  it("runs once per app start", async () => {
    const { deps, log } = fakes();
    const a = resubscribePushIfNeeded(profile, deps);
    const b = resubscribePushIfNeeded(profile, deps);
    expect(await a).toBe("resubscribed");
    expect(await b).toBe("resubscribed");
    expect(await resubscribePushIfNeeded(profile, deps)).toBe("resubscribed");
    expect(log.filter((l) => l.startsWith("subscribe"))).toHaveLength(1);
  });

  it("does nothing (no service worker wait, no server call) without permission, wish, or when switched off here", async () => {
    for (const [p, o] of [
      [profile, { permission: "default" as const }],
      [profile, { permission: "denied" as const }],
      [{ id: "A", notify_morning: null, notify_evening: null }, {}],
      [profile, { choice: "off" }],
    ] as const) {
      resetResubscribeForTests();
      const { deps, log } = fakes(o);
      expect(await resubscribePushIfNeeded(p, deps)).toBe("skipped");
      expect(log).toEqual([]);
    }
  });

  it("a device switched off before this release (no choice stored) is left alone", async () => {
    const { deps, log } = fakes({ choice: null });
    expect(await resubscribePushIfNeeded(profile, deps)).toBe("skipped");
    expect(log).toEqual(["registration"]);
    resetResubscribeForTests();
    const old = fakes({ choice: "on" }); // the plain "on" without an account
    expect(await resubscribePushIfNeeded(profile, old.deps)).toBe("skipped");
    expect(old.log.some((l) => l.startsWith("subscribe"))).toBe(false);
  });

  it("never on another account's consent: A switched them on here, B is logged in", async () => {
    const { deps, log } = fakes({ choice: "on:A", session: () => "B" });
    expect(await resubscribePushIfNeeded({ id: "B", notify_morning: "07:30:00", notify_evening: null }, deps)).toBe("skipped");
    expect(log.some((l) => l.startsWith("subscribe") || l.startsWith("save"))).toBe(false);
  });

  it("race: someone else signs in while the service worker starts: nothing is stored for them", async () => {
    let session = "A";
    const { deps, log } = fakes({ session: () => session });
    const slow = deps.registration;
    deps.registration = async () => {
      session = "B"; // A signs out, B signs in meanwhile
      return slow();
    };
    expect(await resubscribePushIfNeeded(profile, deps)).toBe("skipped");
    expect(log.some((l) => l.startsWith("save"))).toBe(false);
    expect(log).toContain("unsubscribe");
  });

  it("a device still subscribed (older code, no choice) is remembered as hers once the server confirms it", async () => {
    const mine = fakes({ existing: true, choice: null, owns: true });
    expect(await resubscribePushIfNeeded(profile, mine.deps)).toBe("marked");
    expect(mine.marker()).toBe("on:A");
    expect(mine.log).toEqual(["registration", "owns:https://push.example/old", "mark:A"]);
    resetResubscribeForTests();
    const theirs = fakes({ existing: true, choice: null, owns: false });
    expect(await resubscribePushIfNeeded(profile, theirs.deps)).toBe("skipped");
    expect(theirs.marker()).toBe(null);
  });

  it("keeps an existing subscription (choice known: no server call)", async () => {
    const { deps, log } = fakes({ existing: true });
    expect(await resubscribePushIfNeeded(profile, deps)).toBe("skipped");
    expect(log).toEqual(["registration"]);
  });

  it("skips without a service worker (dev mode) or a server key (demo)", async () => {
    const a = fakes({ reg: false });
    expect(await resubscribePushIfNeeded(profile, a.deps)).toBe("skipped");
    expect(a.log).toEqual(["registration"]);
    resetResubscribeForTests();
    const b = fakes({ key: null });
    expect(await resubscribePushIfNeeded(profile, b.deps)).toBe("skipped");
    expect(b.log).toEqual(["registration", "key"]);
  });

  it("never throws: a refused subscribe is 'failed', nothing stored", async () => {
    const { deps, log } = fakes({ subscribeFails: true });
    expect(await resubscribePushIfNeeded(profile, deps)).toBe("failed");
    expect(log.some((l) => l.startsWith("save"))).toBe(false);
  });
});

describe("switched off on this device, signing out", () => {
  it("disablePush remembers it, so the silent re-subscribe leaves this device alone", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    try {
      await disablePush();
      expect(store.get("ich.push")).toBe("off");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("signing out removes this device's subscription, keeps her choice and lets the next sign-in renew it", async () => {
    const store = new Map<string, string>([["ich.push", "on:A"]]);
    const log: string[] = [];
    const sub = { endpoint: "https://push.example/mine", unsubscribe: async () => (log.push("unsubscribe"), true) };
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) } });
    vi.stubGlobal("window", { PushManager: class {}, Notification: class {} });
    vi.stubGlobal("Notification", class {});
    resetResubscribeForTests();
    const first = fakes();
    await resubscribePushIfNeeded(profile, first.deps);
    try {
      fakeBackend.deleted.length = 0;
      const before = fakeBackend.signedOut;
      await signOutDevice();
      expect(fakeBackend.deleted).toEqual(["https://push.example/mine"]);
      expect(log).toEqual(["unsubscribe"]);
      expect(fakeBackend.signedOut).toBe(before + 1);
      expect(store.get("ich.push")).toBe("on:A");
    } finally {
      vi.unstubAllGlobals();
    }
    // signed in again (same app start): it may run once more
    const again = fakes();
    expect(await resubscribePushIfNeeded(profile, again.deps)).toBe("resubscribed");
  });
});
