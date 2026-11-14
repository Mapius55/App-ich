// Web push in the app: ask permission, subscribe this device, store it.
// On iPhone this works from iOS 16.4 on, and only when the app was added
// to the home screen (Safari → Teilen → Zum Home-Bildschirm).

import { backend } from "./backend";

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
  const json = sub.toJSON();
  await backend.savePushSubscription({
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    app_url: new URL(import.meta.env.BASE_URL, location.origin).href,
  });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await backend.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
