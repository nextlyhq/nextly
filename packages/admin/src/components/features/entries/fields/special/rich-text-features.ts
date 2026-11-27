/**
 * Which of a rich-text field's features it offers: the one reading of
 * `features` that the toolbar and the editor's own plugins share, so a link
 * the editor makes by itself is only ever made where the toolbar offers the
 * way to remove it.
 *
 * @module components/entries/fields/special/rich-text-features
 */

/**
 * Whether a field listing `features` offers `feature`. A field that lists
 * none offers every feature.
 */
export function offersRichTextFeature(
  features: readonly string[] | undefined,
  feature: string
): boolean {
  return (
    features === undefined ||
    features.length === 0 ||
    features.includes(feature)
  );
}
