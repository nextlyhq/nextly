/**
 * How a site spaces its blocks: the one switch between two spacing models.
 *
 * - `gaps`: a block carries no outer margin, and the space between two blocks
 *   is the gap of the container holding them (`childGap` on a container's
 *   definition). The default, and what a new site starts with.
 * - `classic`: the model before container gaps. Headings and paragraphs carry
 *   their own margins, containers write no gap, and the blocks that gained
 *   padding or a token-driven gap with container gaps keep the values they had
 *   before it. A site built under that model keeps its look by staying on it.
 *
 * The precedent is WordPress's `theme.json`: a theme that leaves
 * `spacing.blockGap` unset keeps the legacy block margins, and one that sets it
 * moves to the container's gap.
 *
 * ONE flag on the compile context rather than a test in every place spacing is
 * written. The engine reads it once, to decide whether container gaps are
 * written at all; the block library that owns the element and block defaults
 * swaps in its frozen classic table once, where it builds the context.
 *
 * @module style/spacing-mode
 */

/** A site's spacing model. See the module note. */
export type SpacingMode = "classic" | "gaps";

/** Every spacing model, in the order an editor offers them. */
export const SPACING_MODES: readonly SpacingMode[] = ["classic", "gaps"];

/** The model a site with no recorded choice compiles under. */
export const DEFAULT_SPACING_MODE: SpacingMode = "gaps";

/** Whether a value names a spacing model. */
export function isSpacingMode(value: unknown): value is SpacingMode {
  return value === "classic" || value === "gaps";
}

/**
 * The spacing model a stored or supplied value means.
 *
 * Anything that is not a model, absence included, is the default: a value this
 * build does not know is read as the model every site starts on rather than
 * refused, so one unreadable row cannot take a render down.
 */
export function spacingModeOf(value: unknown): SpacingMode {
  return isSpacingMode(value) ? value : DEFAULT_SPACING_MODE;
}
