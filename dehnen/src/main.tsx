// Entry of Kehrwasser: styles, the app, and the service worker (production only, registered by hand).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/**
 * The service worker makes the app work offline. A new version takes over in the background
 * (skipWaiting + clientsClaim), but the page is only ever reloaded while nobody is looking at it
 * and never while a session is open: a stretch must not be interrupted by an update.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  let controlled = Boolean(sw.controller);
  let stale = false;

  const inSession = (): boolean => window.location.hash.startsWith("#/session");
  const reloadWhenUnseen = (): void => {
    if (stale && document.visibilityState === "hidden" && !inSession()) window.location.reload();
  };

  sw.addEventListener("controllerchange", () => {
    // the very first worker taking control is not an update
    if (!controlled) {
      controlled = true;
      return;
    }
    stale = true;
    reloadWhenUnseen();
  });
  document.addEventListener("visibilitychange", reloadWhenUnseen);

  const register = (): void => {
    const base = import.meta.env.BASE_URL;
    sw.register(base + "sw.js", { scope: base })
      .then((reg) => {
        // coming back to the app is a good moment to look for a new version
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible" && !inSession()) reg.update().catch(() => undefined);
        });
      })
      .catch(() => undefined);
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

registerServiceWorker();
