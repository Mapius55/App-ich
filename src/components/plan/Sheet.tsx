import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

// A bottom sheet as a modal dialog: slides up, closes on the backdrop, Escape
// or the close button, keeps Tab inside and gives focus back when it closes.
// Rendered into <body> so no transformed ancestor (screen animations) can
// break its fixed position.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  onClose: () => void;
  children: (close: () => void) => React.ReactNode;
}

export function Sheet({ title, onClose, children }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Let the slide-out play before unmounting (instant with reduced motion).
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => onCloseRef.current(), reduced ? 0 : 240);
  }, []);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    // focus the first field (or the dialog itself), not the close button
    const first = el.querySelector<HTMLElement>("[data-autofocus]") ?? el;
    first.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === ref.current)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  return createPortal(
    <div className={`sheet-backdrop ${closing ? "closing" : ""}`} onClick={close}>
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <span className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          <h2 id={id} className="sheet-title">
            {title}
          </h2>
          <button type="button" className="dock-round small" onClick={close} aria-label="Schliessen">
            <IconClose />
          </button>
        </header>
        <div className="sheet-body">{children(close)}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Two-step delete inside a sheet: no native confirm, the question appears in place. */
export function ConfirmDelete({ label, question, onConfirm }: { label: string; question: string; onConfirm: () => void | Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <button type="button" className="btn quiet danger" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <div className="sheet-confirm">
      <span role="alert">{question}</span>
      <span className="row">
        <button type="button" className="btn quiet" onClick={() => setAsking(false)} autoFocus>
          Nein
        </button>
        <button
          type="button"
          className="btn quiet danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          Ja, löschen
        </button>
      </span>
    </div>
  );
}
