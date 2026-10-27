/**
 * A widget's size bounds for a test fixture, through core's own filling-in.
 *
 * A card `w` columns by `h` rows by default; its minimum is that size, and its
 * maximum the full width at that height, as a declaration stating only a
 * default gets.
 */
import { sizeBounds, type WidgetSizeBounds } from "nextly/config";

export function gridBounds(w = 4, h = 3): WidgetSizeBounds {
  return sizeBounds({ default: { w, h } });
}
