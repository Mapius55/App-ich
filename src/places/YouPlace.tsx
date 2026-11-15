// Du (§3.6): the left side of Jetzt. The name, the coach's summary, five collapsible
// rows (what I know, body, connections, notifications, settings) and a footer with
// today's colours and "Abmelden". The dock "+" notes something about you.
import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import type { Coords } from "../lib/location";
import type { Palette } from "../lib/palette";
import type { Memory, Profile } from "../lib/types";
import { useSpace, type DuSection } from "../space/state";
import { BodySection } from "./BodySection";
import { Connections } from "./Connections";
import { useBodyValue, useConnectionsValue } from "./conn/Body";
import { DuRow } from "./DuRow";
import { MemoryList } from "./MemoryList";
import { NotificationsSection, notifyValue } from "./NotificationsSection";
import { SettingsSection } from "./SettingsSection";

export interface YouPlaceProps {
  titleId: string;
  active: boolean; // Du is the settled place
  profile: Profile;
  palette: Palette;
  hasCoords: boolean;
  onProfile(patch: Partial<Profile>): void;
  onCoords(c: Coords | null): void;
}

const ORDER: DuSection[] = ["memories", "body", "connections", "notifications", "settings"];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function YouPlace({ titleId, active, profile, palette, hasCoords, onProfile, onCoords }: YouPlaceProps) {
  const { duSection, reduced, registerAdd, setDuOpen } = useSpace();
  const bodyValue = useBodyValue();
  const connValue = useConnectionsValue();
  const [openRow, setOpenRow] = useState<DuSection | null>(duSection);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [memError, setMemError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const reveal = useRef<DuSection | null>(duSection);

  // the memories: fresh on every visit (the coach notes things while you talk)
  const loadMemories = useCallback(() => {
    backend
      .listMemories()
      .then((m) => {
        setMemories(m);
        setMemError(null);
      })
      .catch((e) => setMemError(message(e)));
  }, []);
  useEffect(() => {
    if (active) loadMemories();
  }, [active, loadMemories]);

  // go("du", { duSection }) and #du/verbindungen: open that row and bring it up
  useEffect(() => {
    if (!duSection) return;
    setOpenRow(duSection);
    reveal.current = duSection;
  }, [duSection]);

  // the hash follows the open row ("#du/verbindungen"), however it opened
  useEffect(() => setDuOpen(openRow), [openRow, setDuOpen]);

  // a row that should come into view: put it where the title sits, once the row that
  // closed above it has folded away (its 240 ms), else on the next frame
  const closedAbove = useRef(false);
  useEffect(() => {
    const id = reveal.current;
    if (!id || openRow !== id) return;
    reveal.current = null;
    const go = () => {
      const root = rootRef.current;
      const side = root?.closest<HTMLElement>(".side");
      const row = root?.querySelector<HTMLElement>(`[data-section="${id}"]`);
      const title = root?.querySelector<HTMLElement>(".pl-title");
      if (!side || !row || !title) return;
      // the scroll position at which the row sits where the title sits at the top
      const top = Math.max(0, row.getBoundingClientRect().top - title.getBoundingClientRect().top);
      if (Math.abs(top - side.scrollTop) > 4) side.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    };
    const wait = closedAbove.current && !reduced;
    closedAbove.current = false;
    const t = wait ? window.setTimeout(go, 260) : requestAnimationFrame(go);
    return () => (wait ? clearTimeout(t) : cancelAnimationFrame(t));
  }, [openRow, reduced]);

  const openSection = (id: DuSection) => {
    closedAbove.current = openRow !== null && ORDER.indexOf(openRow) < ORDER.indexOf(id);
    reveal.current = id;
    setOpenRow(id);
  };
  // a row that opens comes up only when the one closing above it would pull it out of place
  const toggle = (id: DuSection) => {
    if (openRow === id) return setOpenRow(null);
    if (openRow !== null && ORDER.indexOf(openRow) < ORDER.indexOf(id)) openSection(id);
    else setOpenRow(id);
  };

  // the dock "+" here: "Etwas über dich notieren" (the memories with the add form)
  useEffect(() => {
    registerAdd("du", () => {
      reveal.current = "memories";
      setOpenRow("memories");
      setAdding(true);
    });
    return () => registerAdd("du", null);
  }, [registerAdd]);

  const name = profile.display_name?.trim() || "Du";
  const row = (id: DuSection) => ({ id, open: openRow === id, dim: openRow !== null && openRow !== id, onToggle: () => toggle(id) });

  return (
    <div ref={rootRef} className="pl du" data-active={active || undefined}>
      <h2 id={titleId} className="pl-title" tabIndex={-1}>
        {name}
      </h2>
      {profile.summary?.trim() && <p className="du-summary">{profile.summary.trim()}</p>}

      <div className="du-rows">
        <DuRow {...row("memories")} title="Was ich über dich weiss" value={memories ? String(memories.length) : null}>
          <MemoryList items={memories} error={memError} onItems={(fn) => setMemories((xs) => fn(xs ?? []))} adding={adding} setAdding={setAdding} />
        </DuRow>
        <DuRow {...row("body")} title="Dein Körper" value={bodyValue}>
          <BodySection onConnections={() => openSection("connections")} />
        </DuRow>
        <DuRow {...row("connections")} title="Verbindungen" value={connValue}>
          <Connections />
        </DuRow>
        <DuRow {...row("notifications")} title="Benachrichtigungen" value={notifyValue(profile)}>
          <NotificationsSection profile={profile} onProfile={onProfile} />
        </DuRow>
        <DuRow {...row("settings")} title="Einstellungen">
          <SettingsSection profile={profile} hasCoords={hasCoords} onProfile={onProfile} onCoords={onCoords} />
        </DuRow>
      </div>

      <footer className="du-foot">
        <p className="du-colors">
          <span className="du-colors-label">Farben heute:</span>{" "}
          <span className="du-colors-names">{palette.names.join(" · ")}</span>
          <span className="du-swatches" aria-hidden="true">
            {palette.colors.map((c, i) => (
              <span key={i} className="du-swatch" style={{ background: c }} />
            ))}
          </span>
        </p>
        <button type="button" className="pl-quiet du-signout" onClick={() => backend.signOut()}>
          Abmelden
        </button>
      </footer>
    </div>
  );
}
