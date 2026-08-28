/**
 * A binding, spelled the way this keyboard spells it.
 *
 * The editor stores its shortcuts as specs — `alt+ArrowUp` — because that is
 * what the shortcut manager matches against. A person reads none of that: the
 * key on their keyboard says Option or Alt depending on the machine, and the
 * arrow is a glyph rather than a word.
 *
 * ## Why this is not a fixed string
 *
 * The block toolbar records the reason it shows no hint at all: a binding
 * spelled `mod` is Command on Apple platforms and Control everywhere else, so
 * any fixed string is wrong on one of them, and teaching "Ctrl+D" to a Mac
 * author teaches a keystroke that does nothing. `alt` has the same problem
 * more quietly — the same physical key is labelled Alt on one platform and
 * Option on another.
 *
 * `@nextlyhq/ui` owns that decision in `detectApplePlatform`, and it is on the
 * public entry, so the hint can be resolved rather than guessed.
 *
 * ## Why it parses rather than splits
 *
 * The spec grammar is not "split on `+`" — a lone `+` is a key, and a trailing
 * one is too, so `mod++` is the zoom shortcut rather than a malformed chord.
 * `parseKeys` is the one implementation of that grammar, and re-deriving it
 * here would produce a hint that disagrees with the binding it describes for
 * exactly the specs that are hardest to read.
 *
 * @module key-hint
 */

import { detectApplePlatform, parseKeys } from "@nextlyhq/ui";

/**
 * Glyphs for keys whose NAME is not what a keyboard shows.
 *
 * Arrows only. A named key like `Enter` or `Escape` is written on the key in
 * words, so a symbol would be the less recognisable of the two.
 */
const KEY_GLYPHS: Readonly<Record<string, string>> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  /*
   * The space bar, which the parser canonicalises to the character it produces
   * rather than to the word a spec spells it with. Passing that through would
   * print a hint with a blank where the key should be — the one key whose name
   * is unreadable precisely because the value IS readable to the browser.
   */
  " ": "Space",
};

/** The modifier labels, in the order a keyboard shortcut is conventionally written. */
function modifierLabels(
  chord: ReturnType<typeof parseKeys>[number],
  apple: boolean
): string[] {
  const labels: string[] = [];
  // `mod` first, because it is the outermost modifier in every convention that
  // writes more than one.
  if (chord.mod) labels.push(apple ? "⌘" : "Ctrl");
  if (chord.ctrl) labels.push(apple ? "⌃" : "Ctrl");
  if (chord.alt) labels.push(apple ? "⌥" : "Alt");
  if (chord.shift) labels.push(apple ? "⇧" : "Shift");
  if (chord.meta) labels.push(apple ? "⌘" : "Meta");
  return labels;
}

/**
 * One binding as a person would read it, or `null` when the spec cannot be read.
 *
 * `null` rather than a best guess: a hint is a promise that pressing something
 * does something, and a spec this cannot parse is one whose keystroke it does
 * not know. Showing a wrong one is worse than showing none, which is the same
 * judgement the toolbar made when it showed none at all.
 */
export function keyHint(
  spec: string,
  apple = detectApplePlatform()
): string | null {
  let chords;
  try {
    chords = parseKeys(spec);
  } catch {
    return null;
  }
  return chords
    .map(chord => {
      const key = KEY_GLYPHS[chord.key.toLowerCase()] ?? capitalize(chord.key);
      return [...modifierLabels(chord, apple), key].join(apple ? "" : "+");
    })
    .join(" ");
}

/**
 * A single character is shown upper case; a named key keeps the spelling the
 * spec used, because that is already the name written on the key.
 */
function capitalize(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}
