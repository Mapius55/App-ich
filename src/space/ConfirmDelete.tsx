// Two-step delete in place (copied from plan/Sheet.tsx for the space): no native
// confirm, the question replaces the button until answered.
import { useState } from "react";

export function ConfirmDelete({
  label,
  question,
  yes = "Ja, löschen",
  onConfirm,
  also,
}: {
  label: string;
  question: string;
  yes?: string;
  onConfirm: () => void | Promise<void>;
  /** a second way to confirm (a day of a weekly rhythm: «Alle kommenden» next to «Nur diesen Termin») */
  also?: { label: string; onConfirm: () => void | Promise<void> };
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <button type="button" className="btn quiet danger" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <div className="confirm-inline">
      <span role="alert">{question}</span>
      <span className="row">
        <button type="button" className="btn quiet" onClick={() => setAsking(false)} autoFocus>
          Nein
        </button>
        {[{ label: yes, onConfirm }, ...(also ? [also] : [])].map((c) => (
          <button
            key={c.label}
            type="button"
            className="btn quiet danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await c.onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {c.label}
          </button>
        ))}
      </span>
    </div>
  );
}
