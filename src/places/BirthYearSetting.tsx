// Du › Einstellungen › Geburtsjahr (Bucket List round, owned by Builder F): the year
// «Leben» needs for life in weeks. Change it or remove it; only the year, nothing else.
import { useEffect, useMemo, useState } from "react";
import { backend } from "../lib/backend";
import type { Profile } from "../lib/types";
import { useSpace } from "../space/state";
import { birthYearOptions } from "../time/lifeGrid";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BirthYearSetting({ profile, onProfile }: { profile: Profile; onProfile(patch: Partial<Profile>): void }) {
  const { today } = useSpace();
  const stored = typeof profile.birth_year === "number" ? profile.birth_year : null;
  const asText = (y: number | null) => (y === null ? "" : String(y));
  const [year, setYear] = useState(asText(stored));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  // the coach or «Leben» may set it meanwhile
  useEffect(() => setYear(asText(stored)), [stored]);
  const years = useMemo(() => birthYearOptions(Number(today.slice(0, 4)), stored), [today, stored]);
  const changed = year !== asText(stored);

  const save = async (value: number | null) => {
    setBusy(true);
    setNote(null);
    try {
      await backend.updateProfile({ birth_year: value });
      onProfile({ birth_year: value });
      setSaved(value !== null);
      if (value === null) setNote({ text: "Entfernt. «Leben» fragt dich wieder, wenn du es ansiehst.", error: false });
    } catch (e) {
      setNote({ text: message(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="du-set" aria-labelledby="du-set-birth">
      <h4 id="du-set-birth" className="pl-label">
        Geburtsjahr
      </h4>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && changed && year) save(Number(year));
        }}
      >
        <select className="plain-input" value={year} onChange={(e) => (setYear(e.target.value), setSaved(false), setNote(null))} aria-label="Geburtsjahr" disabled={busy}>
          {stored === null && <option value="">Jahr wählen</option>}
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button type="submit" className="btn primary" disabled={busy || !changed || !year}>
          {saved && !changed ? "Gespeichert" : "Speichern"}
        </button>
      </form>
      <p className="pl-hint">Für «Leben», dein Leben in Wochen. Nur das Jahr, nichts weiter.</p>
      {note && (
        <p className={note.error ? "form-error" : "pl-hint"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {stored !== null && (
        <div className="row wrap">
          <button type="button" className="btn quiet" disabled={busy} onClick={() => save(null)}>
            Entfernen
          </button>
        </div>
      )}
    </section>
  );
}
