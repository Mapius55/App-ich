// What closing a detail means (D6), pure so it can be tested as a table.
//
// Existing items save on close, whatever the path (✓, Escape, the scrim, pull-down,
// a navigation). New items need an explicit "Eintragen"/"Hinzufügen", and ✓ counts as
// that; any other way of closing a titled new item asks in place first. An empty
// title is never saved.
import type { CloseVia } from "./state";

export interface CloseState {
  isNew: boolean;
  /** something differs from what was loaded */
  dirty: boolean;
  /** the form would pass its own checks (title, times, hours) */
  valid: boolean;
  /** the title field holds more than whitespace */
  titled: boolean;
}

/**
 * close: just close, nothing to save (or discard an untitled new item)
 * save:  commit first; close only if that worked (else the panel shows the error)
 * ask:   „Noch nicht eingetragen.“ [Verwerfen] [Eintragen], the panel stays
 * stay:  the panel stays and shows the validation error
 */
export type CloseAction = "close" | "save" | "ask" | "stay";

export function closeDecision(s: CloseState, via: CloseVia): CloseAction {
  if (s.isNew) {
    if (!s.titled) return "close";
    if (via === "done") return s.valid ? "save" : "stay";
    return "ask";
  }
  if (!s.dirty) return "close";
  return s.valid ? "save" : "stay";
}
