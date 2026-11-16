// Du › Was ich über dich weiss: the memories grouped by category, edited in place
// (MemoryRow moved from screens/Memories.tsx), plus "Etwas notieren".
import { useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import type { Memory, MemoryCategory } from "../lib/types";

export const CATEGORIES: { key: MemoryCategory; label: string }[] = [
  { key: "person", label: "Über dich" },
  { key: "arbeit", label: "Was du machst" },
  { key: "werte", label: "Was dir wichtig ist" },
  { key: "rhythmus", label: "Dein Rhythmus" },
  { key: "ziel", label: "Ziele" },
  { key: "termin", label: "Termine & Rennen" },
  { key: "ort", label: "Orte & Unterwegs" },
  { key: "natur", label: "Natur, die du magst" },
  { key: "anderes", label: "Anderes" },
];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function formatDate(d: string) {
  return new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00"));
}

function MemoryRow({ m, onChange, onDelete }: { m: Memory; onChange: (m: Memory) => void; onDelete: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const [date, setDate] = useState(m.event_date ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    // Edited by you = confirmed: the coach's clean-up will leave it alone.
    const patch = { content: text.trim(), event_date: date || null, source: "person" as const };
    if (!patch.content) return;
    try {
      await backend.updateMemory(m.id, patch);
      onChange({ ...m, ...patch });
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };
  const cancel = () => {
    setEditing(false);
    setText(m.content);
    setDate(m.event_date ?? "");
    setError(null);
  };

  if (!editing) {
    return (
      <li className="mem">
        <button type="button" className="mem-text" onClick={() => setEditing(true)} aria-label={`Bearbeiten: ${m.content}`}>
          {m.event_date && <span className="mem-date">{formatDate(m.event_date)}</span>}
          {m.content}
        </button>
      </li>
    );
  }
  return (
    <li className="mem editing">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), cancel())}
        rows={3}
        aria-label="Text"
        autoFocus
      />
      <label className="date-field">
        <span>Datum (optional)</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn quiet danger" onClick={() => onDelete().catch((e) => setError(message(e)))}>
          Löschen
        </button>
        <span className="spacer" />
        <button type="button" className="btn quiet" onClick={cancel}>
          Abbrechen
        </button>
        <button type="button" className="btn primary" onClick={save}>
          Speichern
        </button>
      </div>
    </li>
  );
}

export function MemoryList({
  items,
  error,
  onItems,
  adding,
  setAdding,
}: {
  items: Memory[] | null;
  error: string | null;
  onItems: (fn: (xs: Memory[]) => Memory[]) => void;
  adding: boolean;
  setAdding: (on: boolean) => void;
}) {
  const [newText, setNewText] = useState("");
  const [newCat, setNewCat] = useState<MemoryCategory>("anderes");
  const [newDate, setNewDate] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const addRef = useRef<HTMLTextAreaElement>(null);

  // opened from the dock "+": the field takes the focus
  useEffect(() => {
    if (adding) addRef.current?.focus({ preventScroll: true });
  }, [adding]);

  const add = async () => {
    if (!newText.trim()) return;
    try {
      const m = await backend.addMemory({ content: newText.trim(), category: newCat, event_date: newDate || null });
      onItems((xs) => [...xs, m]);
      setNewText("");
      setNewDate("");
      setAdding(false);
      setAddError(null);
    } catch (e) {
      setAddError(message(e));
    }
  };

  return (
    <div className="mem-list">
      <p className="pl-hint">Das merke ich mir. Unwichtiges und zu Persönliches räume ich selbst wieder weg. Was du hier änderst oder hinzufügst, bleibt.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {items && items.length === 0 && <p className="du-serif">Noch nichts. Erzähl mir etwas über dich.</p>}

      {items &&
        CATEGORIES.map(({ key, label }) => {
          const list = items.filter((m) => m.category === key);
          if (!list.length) return null;
          if (key === "termin" || key === "ort") list.sort((a, b) => (a.event_date ?? "9").localeCompare(b.event_date ?? "9"));
          return (
            <section key={key} className="mem-group">
              <h4 className="pl-label">{label}</h4>
              <ul>
                {list.map((m) => (
                  <MemoryRow
                    key={m.id}
                    m={m}
                    onChange={(nm) => onItems((xs) => xs.map((x) => (x.id === nm.id ? nm : x)))}
                    onDelete={async () => {
                      await backend.deleteMemory(m.id);
                      onItems((xs) => xs.filter((x) => x.id !== m.id));
                    }}
                  />
                ))}
              </ul>
            </section>
          );
        })}

      {adding ? (
        <div className="mem-add">
          <textarea
            ref={addRef}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), setAdding(false))}
            rows={3}
            placeholder="Was soll ich mir merken?"
            aria-label="Was soll ich mir merken?"
          />
          <div className="row">
            <select value={newCat} onChange={(e) => setNewCat(e.target.value as MemoryCategory)} aria-label="Kategorie">
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="Datum (optional)" />
          </div>
          {addError && (
            <p className="form-error" role="alert">
              {addError}
            </p>
          )}
          <div className="row">
            <span className="spacer" />
            <button type="button" className="btn quiet" onClick={() => setAdding(false)}>
              Abbrechen
            </button>
            <button type="button" className="btn primary" onClick={add}>
              Merken
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="pl-quiet" onClick={() => setAdding(true)}>
          Etwas notieren
        </button>
      )}
    </div>
  );
}
