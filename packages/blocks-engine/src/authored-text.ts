/**
 * Whether a stored value is text an author actually put there.
 *
 * A prop schema describes what an EDITOR offers, not what a document holds. A
 * stored node can carry a number where a string was declared — a legacy row, a
 * migration, an import — so every reader of authored text has to decide what a
 * non-string means, and they have to decide it the SAME way. Here rather than
 * in each reader because the two that exist disagreed: the renderer drew a
 * stored `0` as the word "0" while the plain-text projection skipped it, so a
 * page's description omitted a label the page itself displayed.
 *
 * A number is text a person would recognise, and a stored `0` or `2024` is
 * almost always a value someone typed. Booleans, objects and null are not:
 * `false` and `[object Object]` are artefacts of the conversion rather than
 * anything an author wrote.
 *
 * Separate from {@link authoredText} because a few readers need to tell a
 * MISSING value from an empty one, and `authoredText` maps both to `""`. An
 * image's `alt` is the case that matters: absent means "nobody said", while an
 * explicit `""` is the documented way to mark an image decorative, and those
 * call for opposite behaviour.
 */
export function isAuthoredText(value: unknown): boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/**
 * A stored value as the text a reader will show, or the fallback.
 *
 * The projection every surface shares, so what a page DRAWS and what a
 * description SAYS about that page are derived from one decision rather than
 * two that agree until one of them is edited.
 */
export function authoredText(value: unknown, fallback = ""): string {
  return isAuthoredText(value) ? String(value) : fallback;
}
