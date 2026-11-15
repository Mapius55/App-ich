// Connecting WHOOP, shared by Du › Verbindungen and the onboarding chooser: "Verbinden" goes to WHOOP's
// consent page; back in the app (whoopReturn.ts kept the code), the pending link is confirmed with the
// person's login and the result shown in place.
import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../../lib/backend";
import { setWhoopFrom, takeWhoopReturn, WHOOP_RETURN_EVENT } from "../../lib/whoopReturn";
import type { WhoopReturn } from "../../lib/connections";
import { connStore } from "./store";

export type WhoopOutcome = "ok" | "mismatch" | "expired" | "taken" | "error" | "denied";

/** one calm sentence per outcome (success has its own line) */
export const WHOOP_OUTCOME_TEXT: Record<WhoopOutcome, string> = {
  ok: "WHOOP ist verbunden.",
  mismatch: "Die Verbindung liess sich nicht bestätigen. Der Link war schon benutzt oder gehört zu einem anderen Konto.",
  expired: "Das hat etwas zu lange gedauert. Verbinde WHOOP bitte nochmal.",
  taken: "Dieses WHOOP-Konto ist schon mit einem anderen Konto in der App verbunden.",
  error: "Das hat gerade nicht geklappt.",
  denied: "Du hast bei WHOOP nicht zugestimmt. Das ist in Ordnung.",
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useWhoopConnect(from: "space" | "onboarding", onOutcome?: (o: WhoopOutcome) => void) {
  const [busy, setBusy] = useState<"starting" | "confirming" | null>(null);
  const [outcome, setOutcome] = useState<WhoopOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;

  const finish = useCallback((o: WhoopOutcome) => {
    setOutcome(o);
    setBusy(null);
    // a failed confirm removed the pending link on the server: the row shows what is left
    if (o !== "ok") void connStore.loadWhoop(true);
    onOutcomeRef.current?.(o);
  }, []);

  const confirm = useCallback(
    async (r: WhoopReturn) => {
      setWhoopFrom(null);
      setError(null);
      if (r.result === "error" || r.result === "denied" || r.result === "taken") return finish(r.result);
      setBusy("confirming");
      try {
        if (r.result === "connected") {
          // the older callback connected on its own: just look
          await connStore.loadWhoop(true);
          return finish(connStore.whoop().value?.connected ? "ok" : "error");
        }
        const res = await backend.whoopConfirm(r.code!);
        if (res.ok === false) return finish(res.reason === "expired" || res.reason === "mismatch" || res.reason === "taken" ? res.reason : "error");
        connStore.setWhoop({ ...res });
        finish("ok");
      } catch {
        finish("error");
      }
    },
    [finish],
  );

  // a return waiting from the page load (also after a login), or one arriving now
  useEffect(() => {
    const take = () => {
      const r = takeWhoopReturn();
      if (r) confirm(r);
    };
    take();
    window.addEventListener(WHOOP_RETURN_EVENT, take);
    return () => window.removeEventListener(WHOOP_RETURN_EVENT, take);
  }, [confirm]);

  const start = useCallback(async () => {
    setBusy("starting");
    setOutcome(null);
    setError(null);
    try {
      setWhoopFrom(from);
      const { url } = await backend.whoopStart();
      window.location.assign(url);
      // the demo "returns" without leaving the page (the hashchange brings the code); a real trip
      // to WHOOP keeps "Einen Moment …" until the page goes
      if (url.startsWith("#")) setBusy((b) => (b === "starting" ? null : b));
    } catch (e) {
      setWhoopFrom(null);
      setError(message(e));
      setBusy(null);
    }
  }, [from]);

  return { busy, outcome, error, start, clear: () => (setOutcome(null), setError(null)) };
}
