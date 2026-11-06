// "/" on a field card opens the field picker right after that field.
import type React from "react";

/**
 * Whether a key press on a field card is the "/" that adds a field after it.
 *
 * Only the card's own key press counts: a "/" typed on its drag handle (which
 * keeps focus through a keyboard drag) or another control inside it does not.
 * A "/" with Ctrl or Cmd is a browser or assistive-technology shortcut and is
 * left alone; Shift and AltGr are how some layouts type "/" and are allowed.
 */
export function isSlashToAdd(event: React.KeyboardEvent): boolean {
  if (event.key !== "/" || event.target !== event.currentTarget) return false;
  return !event.metaKey && !(event.ctrlKey && !event.altKey);
}
