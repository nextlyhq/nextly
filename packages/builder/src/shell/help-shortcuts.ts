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
import {
  chordMatches,
  parseKeys,
  type ActiveShortcut,
  type KeyChord,
  type KeySequence,
  type ModifierState,
} from "@nextlyhq/ui";

import { keyHint } from "./key-hint";

/** One line of the list: what happens, and every key that does it. */
export interface ShortcutRow {
  description: string;
  keys: readonly string[];
}

/** The keystroke a chord describes, as the event that would carry it. */
function pressOf(chord: KeyChord, apple: boolean): ModifierState {
  return {
    ctrlKey: chord.ctrl || (chord.mod && !apple),
    metaKey: chord.meta || (chord.mod && apple),
    altKey: chord.alt,
    shiftKey: chord.shift,
  };
}

/**
 * Whether two bindings take the same keys on this platform.
 *
 * Decided by the shortcut manager's own parser and matcher rather than by
 * comparing the spellings: `mod+k` and `ctrl+k` are one key off Apple and two
 * on it, and `shift+mod+z` is `Mod+Shift+Z`. Each step of one binding is
 * pressed as an event and asked of the other's matching step, as the manager
 * would ask it.
 */
function sameKeys(a: KeySequence, b: KeySequence, apple: boolean): boolean {
  return (
    a.length === b.length &&
    a.every((chord, step) => {
      const other = b[step];
      return (
        other !== undefined &&
        chordMatches(chord, other.key, pressOf(other, apple), apple)
      );
    })
  );
}

/** A spec as the manager parses it, or null for one it refuses. */
function sequenceOf(spec: string): KeySequence | null {
  try {
    return parseKeys(spec);
  } catch {
    return null;
  }
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
  const taken: KeySequence[] = [];
  const rows = new Map<string, string[]>();
  for (const shortcut of active) {
    const sequence = sequenceOf(shortcut.keys);
    // A spec the parser refuses names no key anyone can press.
    if (sequence === null) continue;
    // A sequence ("g d") is the admin's site navigation around the editor:
    // the editor binds none, and its Help explains what the editor does. A
    // sequence shares no key with a single press, so it takes none here.
    if (sequence.length > 1) continue;
    if (taken.some(earlier => sameKeys(earlier, sequence, apple))) continue;
    taken.push(sequence);
    if (shortcut.description.trim() === "") continue;
    const shown = keyHint(shortcut.keys, apple);
    if (shown === null) continue;
    const keys = rows.get(shortcut.description) ?? [];
    if (!keys.includes(shown)) keys.push(shown);
    rows.set(shortcut.description, keys);
  }
  return [...rows].map(([description, keys]) => ({ description, keys }));
}
