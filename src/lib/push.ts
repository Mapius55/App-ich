// Web push in the app: ask permission, subscribe this device, store it.
// On iPhone this works from iOS 16.4 on, and only when the app was added
// to the home screen (Safari → Teilen → Zum Home-Bildschirm).

import { backend } from "./backend";
import type { Profile } from "./types";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission (if needed) and registers this device. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("Dieser Browser kann keine Benachrichtigungen empfangen.");
  if (isIos() && !isStandalone()) throw new Error("Auf dem iPhone zuerst „Zum Home-Bildschirm“ hinzufügen und die App von dort öffnen.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt. Das lässt sich in den Einstellungen des iPhones ändern.");
  const key = await backend.pushPublicKey();
  if (!key) throw new Error("Benachrichtigungen brauchen den Server (Supabase).");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await saveSubscription(sub);
  const uid = await backend.currentUserId();
  if (uid) setDeviceChoice(`on:${uid}`); // she allowed them here herself
}

/** Stores this device's subscription with the app's current address (app_url: where a tap opens). */
async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await backend.savePushSubscription({
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    app_url: new URL(import.meta.env.BASE_URL, location.origin).href,
  });
}

// Whose choice it is on THIS device: "on:<user id>" once that person switched notifications on here (or
// was found subscribed here, confirmed by the server); "off" once someone switched them off here ("Auf
// diesem Gerät ausschalten" keeps the times for other devices and the permission granted). The browser's
// permission and this key belong to the whole browser, not to one account: only "on" for the person logged
// in now lets the app subscribe again without asking. Missing (or the older plain "on") means: don't.
// Same origin at both addresses, so the choice survives the move.
const DEVICE_KEY = "ich.push";

/** "on" only when this device's choice is "on" for exactly this account */
export function choiceFor(raw: string | null, userId: string): "on" | "off" | null {
  if (raw === "off") return "off";
  return raw === `on:${userId}` ? "on" : null;
}

function deviceChoiceRaw(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

function setDeviceChoice(v: "off" | `on:${string}`): void {
  try {
    localStorage.setItem(DEVICE_KEY, v);
  } catch {
    /* private mode: nothing to remember */
  }
}

// ---------- after the move to a new address (/App-ich/ → /bucket-list/) ----------
// The service worker at the new address starts without a push subscription, so notifications the person
// allowed would silently stop. On app start (logged in) the app subscribes again, without asking, and
// stores it (which also updates app_url), but only when all of this holds:
//   - notifications are allowed (Notification.permission === "granted": no prompt, ever),
//   - the person wants them (notify_morning or notify_evening set),
//   - this device has no subscription,
//   - and this device's choice is "on" for the person logged in now (see DEVICE_KEY): never on someone
//     else's consent, never after "Auf diesem Gerät ausschalten", never on a device whose choice is unknown.
// A device that still has its subscription (e.g. at /App-ich/ before the move, subscribed by older code
// that wrote no choice) is marked "on" for its account, once the server confirms the subscription is hers.

export interface ResubscribeFacts {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  notifyMorning: string | null | undefined;
  notifyEvening: string | null | undefined;
  hasSubscription: boolean;
  /** this device's choice for the person logged in now: "on" (hers), "off" (switched off here), null (unknown) */
  choice: "on" | "off" | null;
}

/** Whether to subscribe again silently (pure; the conditions above). */
export function shouldResubscribe(f: ResubscribeFacts): boolean {
  return f.supported && f.permission === "granted" && (!!f.notifyMorning || !!f.notifyEvening) && !f.hasSubscription && f.choice === "on";
}

/** What resubscribePushIfNeeded uses from the browser and the server (replaceable in tests). */
export interface ResubscribeDeps {
  supported(): boolean;
  permission(): NotificationPermission | "unsupported";
  /** the active service worker's registration, or null (none within a few seconds: e.g. dev mode) */
  registration(): Promise<ServiceWorkerRegistration | null>;
  publicKey(): Promise<string | null>;
  save(sub: PushSubscription): Promise<void>;
  /** this device's stored choice, as it is (see DEVICE_KEY) */
  choice(): string | null;
  /** remembers "on" for this account on this device */
  markOn(userId: string): void;
  /** the account logged in right now (checked again right before storing) */
  userId(): Promise<string | null>;
  /** whether this endpoint is stored for the account logged in now (the server only shows her own) */
  owns(endpoint: string): Promise<boolean>;
}

const READY_TIMEOUT_MS = 10_000;

const browserDeps: ResubscribeDeps = {
  supported: pushSupported,
  permission: () => ("Notification" in window ? Notification.permission : "unsupported"),
  registration: () =>
    Promise.race([
      navigator.serviceWorker.ready as Promise<ServiceWorkerRegistration | null>,
      new Promise<null>((r) => setTimeout(() => r(null), READY_TIMEOUT_MS)),
    ]),
  publicKey: () => backend.pushPublicKey(),
  save: saveSubscription,
  choice: deviceChoiceRaw,
  markOn: (uid) => setDeviceChoice(`on:${uid}`),
  userId: () => backend.currentUserId(),
  owns: (endpoint) => backend.ownsPushSubscription(endpoint),
};

export type ResubscribeResult = "resubscribed" | "marked" | "skipped" | "failed";

/** "resubscribed": subscribed again and stored; "marked": still subscribed, now remembered as hers;
 *  "skipped": nothing to do; "failed": tried, it didn't work. */
async function resubscribe(profile: Pick<Profile, "id" | "notify_morning" | "notify_evening">, deps: ResubscribeDeps): Promise<ResubscribeResult> {
  const uid = profile.id;
  const raw = deps.choice();
  const wants = !!profile.notify_morning || !!profile.notify_evening;
  // the cheap checks first: no service worker wait, no server call when notifications are off anyway
  if (!uid || !deps.supported() || deps.permission() !== "granted" || !wants || raw === "off") return "skipped";
  try {
    const reg = await deps.registration();
    if (!reg) return "skipped";
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // still subscribed here (older code wrote no choice): remember it as hers, if it is hers
      if (choiceFor(raw, uid) === null && (await deps.owns(existing.endpoint)) && (await deps.userId()) === uid) {
        deps.markOn(uid);
        return "marked";
      }
      return "skipped";
    }
    if (!shouldResubscribe({ supported: true, permission: deps.permission(), notifyMorning: profile.notify_morning, notifyEvening: profile.notify_evening, hasSubscription: false, choice: choiceFor(raw, uid) })) return "skipped";
    const key = await deps.publicKey();
    if (!key) return "skipped"; // no server (demo)
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    // someone else signed in meanwhile (the service worker can take seconds): not on their account
    if ((await deps.userId()) !== uid) {
      await sub.unsubscribe().catch(() => {});
      return "skipped";
    }
    await deps.save(sub);
    return "resubscribed";
  } catch {
    return "failed"; // silent: Du › Benachrichtigungen can still switch them on again by hand
  }
}

const started = new Map<string, Promise<ResubscribeResult>>();

/** Once per app start (and sign-in) and account, when logged in: subscribes this device again if this person allowed and
 *  wants notifications here but the subscription is gone (a new address means a new service worker, signing
 *  out removes it). Never asks, never throws. */
export function resubscribePushIfNeeded(profile: Pick<Profile, "id" | "notify_morning" | "notify_evening">, deps: ResubscribeDeps = browserDeps): Promise<ResubscribeResult> {
  let run = started.get(profile.id);
  if (!run) {
    run = resubscribe(profile, deps);
    started.set(profile.id, run);
  }
  return run;
}

/** Tests only: forget that it already ran. */
export function resetResubscribeForTests(): void {
  started.clear();
}

export async function disablePush(): Promise<void> {
  setDeviceChoice("off");
  const sub = await currentSubscription();
  if (!sub) return;
  await backend.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

/** Signing out: this device stops getting this person's notifications (a shared computer must not show her
 *  day to the next person). Her choice stays, so when she signs in here again they come back without asking;
 *  someone else signing in here doesn't get them. Never blocks signing out. */
export async function signOutDevice(): Promise<void> {
  started.clear(); // the next sign-in may renew it
  try {
    const sub = await currentSubscription();
    if (sub) {
      await backend.deletePushSubscription(sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* signing out goes on */
  }
  await backend.signOut();
}
