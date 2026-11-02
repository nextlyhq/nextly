/**
 * The keyboard shortcuts the Help dialog lists, from the registry that holds
 * them — so a rebound key moves in Help with it, and a shortcut nobody bound
 * cannot appear there.
 *
 * One registry, not one per provider: a provider nested on the page's target
 * shares the page's manager rather than building a second, so the editor's
 * bindings and the page's around it (the save the document's form binds, its
 * Escape) arrive in one list, most precedent first. A key several layers bind
 * is listed once, with the binding that comes first, because that is the one
 * the key runs here; listing the others would describe a keystroke that does
 * something else.
 *
 * @module help-shortcuts
 */
import type { ActiveShortcut } from "@nextlyhq/ui";

import { keyHint } from "./key-hint";

/** One line of the list: what happens, and every key that does it. */
export interface ShortcutRow {
  description: string;
  keys: readonly string[];
}

/** One spelling per key spec, for telling two layers' bindings of a key apart. */
function specOf(shortcut: ActiveShortcut): string {
  return shortcut.keys.trim().toLowerCase();
}

/**
 * The bindings as rows, from the manager's list in its own order.
 *
 * Each key keeps only its first binding, the one that takes it. Rows are one
 * per description, carrying every key that does it — Delete and Backspace are
 * one action — and only keys this platform can spell. A binding with no
 * description says nothing to an author and is left out, but it still takes
 * its key from the layers below it.
 */
export function helpShortcuts(
  active: readonly ActiveShortcut[],
  apple: boolean
): ShortcutRow[] {
  const taken = new Set<string>();
  const rows = new Map<string, string[]>();
  for (const shortcut of active) {
    const spec = specOf(shortcut);
    if (taken.has(spec)) continue;
    taken.add(spec);
    if (shortcut.description.trim() === "") continue;
    const shown = keyHint(shortcut.keys, apple);
    if (shown === null) continue;
    const keys = rows.get(shortcut.description) ?? [];
    if (!keys.includes(shown)) keys.push(shown);
    rows.set(shortcut.description, keys);
  }
  return [...rows].map(([description, keys]) => ({ description, keys }));
}
