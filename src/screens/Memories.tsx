import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import type { Memory, MemoryCategory } from "../lib/types";

const CATEGORIES: { key: MemoryCategory; label: string }[] = [
  { key: "person", label: "Über dich" },
  { key: "arbeit", label: "Was du machst" },
  { key: "werte", label: "Was dir wichtig ist" },
  { key: "rhythmus", label: "Dein Rhythmus" },
  { key: "ziel", label: "Ziele" },
  { key: "termin", label: "Termine & Rennen" },
  { key: "natur", label: "Natur, die du magst" },
  { key: "anderes", label: "Anderes" },
];

function formatDate(d: string) {
  return new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00"));
}

function MemoryRow({ m, onChange, onDelete }: { m: Memory; onChange: (m: Memory) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const [date, setDate] = useState(m.event_date ?? "");

  const save = async () => {
    const patch = { content: text.trim(), event_date: date || null };
    if (!patch.content) return;
    await backend.updateMemory(m.id, patch);
    onChange({ ...m, ...patch });
    setEditing(false);
  };

  if (!editing) {
    return (
      <li className="memory">
        <button className="memory-text" onClick={() => setEditing(true)} aria-label={`Bearbeiten: ${m.content}`}>
          {m.event_date && <span className="memory-date">{formatDate(m.event_date)}</span>}
          {m.content}
        </button>
      </li>
    );
  }
  return (
    <li className="memory editing">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Text" autoFocus />
      <label className="date-field">
        <span>Datum (optional)</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn soft danger" onClick={onDelete}>
          Löschen
        </button>
        <span className="spacer" />
        <button className="btn soft" onClick={() => (setEditing(false), setText(m.content), setDate(m.event_date ?? ""))}>
          Abbrechen
        </button>
        <button className="btn primary" onClick={save}>
          Speichern
        </button>
      </div>
    </li>
  );
}

export function Memories({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [newCat, setNewCat] = useState<MemoryCategory>("anderes");
  const [newDate, setNewDate] = useState("");

  useEffect(() => {
    backend
      .listMemories()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const add = async () => {
    if (!newText.trim()) return;
    const m = await backend.addMemory({ content: newText.trim(), category: newCat, event_date: newDate || null });
    setItems((xs) => [...(xs ?? []), m]);
    setNewText("");
    setNewDate("");
    setAdding(false);
  };

  return (
    <main className="screen memories">
      <header className="topbar">
        <button className="icon-btn ghost" onClick={onBack} aria-label="Zurück">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      </header>
      <h1 className="title">Was ich über dich weiss</h1>
      <p className="subtitle">Das merkt sich dein Coach. Tippe auf einen Eintrag, um ihn zu ändern oder zu löschen.</p>

      {error && <p className="form-error">{error}</p>}
      {items && items.length === 0 && <p className="subtitle">Noch nichts. Erzähl mir etwas über dich.</p>}

      {items &&
        CATEGORIES.map(({ key, label }) => {
          const list = items.filter((m) => m.category === key);
          if (!list.length) return null;
          if (key === "termin") list.sort((a, b) => (a.event_date ?? "9").localeCompare(b.event_date ?? "9"));
          return (
            <section key={key} className="memory-group">
              <h2>{label}</h2>
              <ul>
                {list.map((m) => (
                  <MemoryRow
                    key={m.id}
                    m={m}
                    onChange={(nm) => setItems((xs) => xs!.map((x) => (x.id === nm.id ? nm : x)))}
                    onDelete={async () => {
                      await backend.deleteMemory(m.id);
                      setItems((xs) => xs!.filter((x) => x.id !== m.id));
                    }}
                  />
                ))}
              </ul>
            </section>
          );
        })}

      {adding ? (
        <div className="card form add-memory">
          <textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={3} placeholder="Was soll ich mir merken?" autoFocus />
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
          <div className="row">
            <span className="spacer" />
            <button className="btn soft" onClick={() => setAdding(false)}>
              Abbrechen
            </button>
            <button className="btn primary" onClick={add}>
              Merken
            </button>
          </div>
        </div>
      ) : (
        <button className="btn soft wide" onClick={() => setAdding(true)}>
          + Etwas hinzufügen
        </button>
      )}
    </main>
  );
}
