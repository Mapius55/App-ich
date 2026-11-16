/// <reference lib="webworker" />
// Service worker: offline app shell + notifications from the coach.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/\/functions\//, /\/rest\//, /\/auth\//] }));

interface PushMessage {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  let msg: PushMessage = {};
  try {
    msg = event.data?.json() ?? {};
  } catch {
    msg = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title ?? "Bucket List", {
      // no question: the server always sends a body; this is only for a broken payload
      body: msg.body ?? "Bucket List",
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: msg.url ?? self.registration.scope },
      tag: "i-am-coach",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
