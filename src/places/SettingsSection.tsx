// Du › Einstellungen: name, location, your data (download; deleting the account as an
// inline two-step instead of native confirm), and the tour again. Logic copied from
// screens/Settings.tsx, which stays for the flag-off path.
import { useState } from "react";
import { backend } from "../lib/backend";
import { disablePush } from "../lib/push";
import { requestCoords, type Coords } from "../lib/location";
import type { Profile } from "../lib/types";
import { ConfirmDelete } from "../space/ConfirmDelete";
import { BirthYearSetting } from "./BirthYearSetting";
import { useSpace } from "../space/state";

export function SettingsSection({
  profile,
  hasCoords,
  onProfile,
  onCoords,
}: {
  profile: Profile;
  hasCoords: boolean;
  onProfile(patch: Partial<Profile>): void;
  onCoords(c: Coords | null): void;
}) {
  const { startTour } = useSpace();
  const [name, setName] = useState(profile.display_name ?? "");
  const [nameSaved, setNameSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void | string>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r) setMsg(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () =>
    run(async () => {
      const data = await backend.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `bucket-list-daten-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

  return (
    <div className="du-settings">
      {msg && (
        <p className="pl-hint" role="status">
          {msg}
        </p>
      )}

      <section className="du-set" aria-labelledby="du-set-name">
        <h4 id="du-set-name" className="pl-label">
          Dein Name
        </h4>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !name.trim() || name.trim() === profile.display_name) return;
            run(async () => {
              await backend.updateProfile({ display_name: name.trim() });
              onProfile({ display_name: name.trim() });
              setNameSaved(true);
            });
          }}
        >
          <input className="plain-input" value={name} onChange={(e) => (setName(e.target.value), setNameSaved(false))} aria-label="Name" enterKeyHint="done" />
          <button type="submit" className="btn primary" disabled={busy || !name.trim() || name.trim() === profile.display_name}>
            {nameSaved ? "Gespeichert" : "Speichern"}
          </button>
        </form>
        <p className="pl-hint">So spricht dich der Coach an. Angemeldet bist du als „{profile.username}“.</p>
      </section>

      <BirthYearSetting profile={profile} onProfile={onProfile} />

      <section className="du-set" aria-labelledby="du-set-place">
        <h4 id="du-set-place" className="pl-label">
          Standort
        </h4>
        <p className="pl-hint">{hasCoords ? "Freigegeben. Sonnenstand und Wetter an deinem Ort bestimmen die Farben." : "Nicht freigegeben. Die Farben richten sich nach Zürich."}</p>
        <div className="row wrap">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const c = await requestCoords();
                onCoords(c);
                return "Standort aktualisiert.";
              })
            }
          >
            {hasCoords ? "Neu bestimmen" : "Freigeben"}
          </button>
          {hasCoords && (
            <button
              type="button"
              className="btn quiet"
              onClick={() =>
                run(async () => {
                  try {
                    localStorage.removeItem("ich.coords");
                  } catch {
                    /* ignore */
                  }
                  await backend.updateProfile({ lat: null, lon: null });
                  onCoords(null);
                  return "Standort vergessen.";
                })
              }
            >
              Vergessen
            </button>
          )}
        </div>
      </section>

      <section className="du-set" aria-labelledby="du-set-data">
        <h4 id="du-set-data" className="pl-label">
          Deine Daten
        </h4>
        <p className="pl-hint">Alles, was die App über dich speichert: Profil, Erinnerungen, Gespräche, Termine.</p>
        <div className="row wrap">
          <button type="button" className="btn ghost" disabled={busy} onClick={download}>
            Herunterladen
          </button>
          <ConfirmDelete
            label="Konto löschen"
            question="Konto und alle Daten endgültig löschen?"
            onConfirm={() =>
              run(async () => {
                await disablePush().catch(() => {});
                await backend.deleteAccount();
              })
            }
          />
        </div>
      </section>

      <button type="button" className="pl-quiet" onClick={() => startTour()}>
        Einführung nochmal ansehen
      </button>
    </div>
  );
}
