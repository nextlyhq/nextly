/**
 * How wide a card is on the dashboard, and how a widget's declaration says
 * which widths it may take.
 *
 * The dashboard is one ordered list of cards on a grid of twelve tracks. A
 * card is one of five widths: a quarter, a third, a half, two thirds or the
 * full row. These are the arrangement's OWN words, stored on each placement,
 * and deliberately not the `sm`..`full` sizes a widget declares: those name a
 * declaration's span, and the admin uses "small", "medium" and "large" for the
 * layout a card picks by its rendered width, so reusing them for a stored
 * width would be read wrongly everywhere.
 *
 * 🔴 The one place the two vocabularies meet. A declared size reaches a width
 * only through {@link widthFromSize}, whether it comes from a widget's
 * `defaultSize` or from a placement saved in the column format, so a size
 * cannot convert one way on a read and another way in the default.
 *
 * @module domains/widgets/widths
 */

import type { WidgetSize } from "./definition";

/** The five widths, narrowest first. Order matters: it is the width ranking. */
export const WIDGET_WIDTHS = [
  "quarter",
  "third",
  "half",
  "twoThirds",
  "full",
] as const;
export type WidgetWidth = (typeof WIDGET_WIDTHS)[number];

/**
 * Each declared size and the width of the same span (3, 4, 6, 8 and 12 of 12
 * tracks). A `Map` rather than an object, so a size spelled like a prototype
 * key ("toString") is simply absent instead of resolving to a function.
 */
const WIDTH_BY_SIZE: ReadonlyMap<WidgetSize, WidgetWidth> = new Map([
  ["sm", "quarter"],
  ["md", "third"],
  ["lg", "half"],
  ["xl", "twoThirds"],
  ["full", "full"],
]);

/** Whether a value is one of the five widths. */
export function isWidgetWidth(value: unknown): value is WidgetWidth {
  return (
    typeof value === "string" &&
    (WIDGET_WIDTHS as readonly string[]).includes(value)
  );
}

/**
 * The width a declared size stands for.
 *
 * Anything this core does not know as a size, and a size that is missing,
 * becomes `full`. That is how the admin has always drawn such a card, so the
 * conversion keeps what the person was looking at. It never consults the
 * widget's current default: a stored placement converts the same way in every
 * release, whatever the widget declares by then.
 */
export function widthFromSize(size: unknown): WidgetWidth {
  return (
    (typeof size === "string"
      ? WIDTH_BY_SIZE.get(size as WidgetSize)
      : undefined) ?? "full"
  );
}

/**
 * The size of the same span as a width: the other direction of the one table
 * above, so the two can never disagree. Every width has one.
 */
export function sizeFromWidth(width: WidgetWidth): WidgetSize {
  for (const [size, spans] of WIDTH_BY_SIZE) {
    if (spans === width) return size;
  }
  return "full";
}

/** A declared bound's rank among the widths, or `undefined` when it is not one. */
function boundRank(size: unknown): number | undefined {
  if (typeof size !== "string") return undefined;
  const width = WIDTH_BY_SIZE.get(size as WidgetSize);
  return width === undefined ? undefined : WIDGET_WIDTHS.indexOf(width);
}

/**
 * The widths a widget allows, from the smallest and largest size it declares.
 *
 * A bound that is missing, or that this core cannot read (a newer plugin's
 * size), leaves that end open rather than closing the range: a widget is never
 * left with no width to draw at. The registry already refuses a minimum above
 * the maximum, and the same answer covers it here for the same reason.
 */
export function allowedWidths(
  minSize: unknown,
  maxSize: unknown
): readonly WidgetWidth[] {
  const low = boundRank(minSize) ?? 0;
  const high = boundRank(maxSize) ?? WIDGET_WIDTHS.length - 1;
  return low > high ? WIDGET_WIDTHS : WIDGET_WIDTHS.slice(low, high + 1);
}
