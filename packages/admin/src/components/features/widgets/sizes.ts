/**
 * The one place a widget's width is decided.
 *
 * Sizes are named steps on a 12-column grid, and the map below is the design's
 * responsive table written as class text:
 *
 * | size   | < md | md | >= lg |
 * |--------|------|----|-------|
 * | `sm`   | 12   | 6  | 3     |
 * | `md`   | 12   | 6  | 4     |
 * | `lg`   | 12   | 12 | 6     |
 * | `xl`   | 12   | 12 | 8     |
 * | `full` | 12   | 12 | 12    |
 *
 * Two properties this file exists to hold.
 *
 * The BASE span is 12 for every size, with no exceptions. Below `md` a
 * dashboard is one column: an unprefixed `col-span-6` is half a phone screen,
 * which is what the grid this replaces shipped.
 *
 * And every class is written out IN FULL. Tailwind resolves utilities by
 * scanning source TEXT, so a `col-span-${n}` template literal produces a
 * `className` at runtime that has no rule behind it in the built stylesheet —
 * the element gets the attribute and no width. The `md:col-span-12` entries are
 * therefore literal and deliberate even where they restate the base: they make
 * the map readable as the table it is, and cost one scanned class each.
 *
 * @module components/features/widgets/sizes
 */

import type { WidgetSize } from "nextly/config";

/**
 * Span classes per size. Frozen because this is the shared map, not a starting
 * point a caller may edit for one grid.
 */
export const WIDGET_SPAN_CLASSES: Readonly<Record<WidgetSize, string>> =
  Object.freeze({
    sm: "col-span-12 md:col-span-6 lg:col-span-3",
    md: "col-span-12 md:col-span-6 lg:col-span-4",
    lg: "col-span-12 md:col-span-12 lg:col-span-6",
    xl: "col-span-12 md:col-span-12 lg:col-span-8",
    full: "col-span-12",
  });

/**
 * The span classes for `size`, falling back to full width.
 *
 * The fallback is not defensive decoration: `size` reaches here from a plugin's
 * declaration over the wire, so a value outside the enum is a shape the admin
 * has to survive. Full width is the safe answer — a widget too wide is legible,
 * a widget with no span class at all collapses to the grid's implicit one.
 */
export function widgetSpanClass(size: WidgetSize | undefined): string {
  if (!size) return WIDGET_SPAN_CLASSES.full;
  // `Object.hasOwn`, not a plain lookup with `??`. The value arrives over the
  // wire from a plugin declaration, so it can be any string -- and `constructor`
  // or `toString` resolve to inherited `Object.prototype` members rather than
  // `undefined`, which means the fallback never runs and the grid is handed a
  // FUNCTION where it expected a class list. `__proto__` returns an object the
  // same way.
  //
  // The fallback below is what makes an unknown size survivable at all, so a
  // lookup that can silently skip it defeats the boundary rather than guarding
  // it.
  return Object.hasOwn(WIDGET_SPAN_CLASSES, size)
    ? WIDGET_SPAN_CLASSES[size]
    : WIDGET_SPAN_CLASSES.full;
}

/**
 * The deprecated `size?: "full" | "half"` alias, as a real size.
 *
 * Plugin declarations still carry it, and `half` meant "6 of 12" — which is
 * `lg` in the enum. Mapping it here rather than at the call site is what stops
 * the old vocabulary reaching the span map, where it would miss and silently
 * become full width for every half widget on the dashboard.
 */
export function legacySizeToWidgetSize(
  size: "full" | "half" | undefined
): WidgetSize {
  return size === "half" ? "lg" : "full";
}
