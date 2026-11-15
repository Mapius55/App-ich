// STUB (phase 0): Builder C builds the real Unfold (FLIP, focus trap, pull-down);
// the props, useUnfoldClose and the closer wiring below are the contract.
import { createContext, useContext, useEffect, useRef } from "react";
import { useSpace, type CloseVia } from "./state";

type CloseHandler = (via: CloseVia) => Promise<boolean> | boolean;

export interface UnfoldProps {
  kindLabel: string; // "Eintrag", "Neuer Eintrag", "Ziel", "Neues Ziel", "Gewohnheit", "Neue Gewohnheit"
  origin: HTMLElement | null; // the tapped row (grow from / collapse into it)
  /** every close path inside the panel (scrim, Escape, pull) goes here; usually space.close */
  onRequestClose(via: CloseVia): Promise<boolean>;
  children: React.ReactNode;
}

const HandlerSlot = createContext<((h: CloseHandler | null) => void) | null>(null);

export function Unfold({ kindLabel, origin, onRequestClose, children }: UnfoldProps) {
  const { registerCloser } = useSpace();
  const handler = useRef<CloseHandler | null>(null);
  const setHandler = useRef((h: CloseHandler | null) => (handler.current = h)).current;
  void origin;

  // Space.close(via) → this closer → the form's handler (save / ask) → true closes
  useEffect(() => {
    registerCloser(async (via) => {
      const h = handler.current;
      return h ? await h(via) : true;
    });
    return () => registerCloser(null);
  }, [registerCloser]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onRequestClose("escape");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onRequestClose]);

  return (
    <HandlerSlot.Provider value={setHandler}>
      <div className="unfold-scrim" onClick={() => onRequestClose("backdrop")} />
      <div className="unfold" role="dialog" aria-modal="true" aria-label={kindLabel}>
        <span className="pill">{kindLabel}</span>
        {children}
      </div>
    </HandlerSlot.Provider>
  );
}

/** a form inside an Unfold decides what closing means (save, ask, refuse) */
export function useUnfoldClose(handler: CloseHandler): void {
  const set = useContext(HandlerSlot);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!set) return;
    set((via) => ref.current(via));
    return () => set(null);
  }, [set]);
}
