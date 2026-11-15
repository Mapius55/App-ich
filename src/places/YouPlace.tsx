// STUB (phase 0): Builder C replaces the body; the props are final.
import type { Coords } from "../lib/location";
import type { Palette } from "../lib/palette";
import type { Profile } from "../lib/types";

export interface YouPlaceProps {
  titleId: string;
  active: boolean; // Du is the settled place
  profile: Profile;
  palette: Palette;
  hasCoords: boolean;
  onProfile(patch: Partial<Profile>): void;
  onCoords(c: Coords | null): void;
}

export function YouPlace(props: YouPlaceProps) {
  return (
    <div className="stub" data-active={props.active || undefined}>
      <h2 id={props.titleId} className="stub-title" tabIndex={-1}>
        {props.profile.display_name?.trim() || "Du"}
      </h2>
      <p className="stub-sub">Du (Platzhalter)</p>
    </div>
  );
}
