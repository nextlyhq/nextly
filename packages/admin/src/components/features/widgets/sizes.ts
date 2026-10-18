/**
 * The one place a card's drawn width is decided.
 *
 * The dashboard is ONE ordered list of cards on twelve tracks, and each card is
 * one of five widths. Which tracks a width takes depends on how wide the
 * DASHBOARD is, not the window: the grid sits in an `@container/dashboard`
 * wrapper and every span below answers to it, so a dashboard squeezed by an
 * open sidebar draws the band that fits it.
 *
 * | width       | < 640px | 640-1023px | >= 1024px |
 * |-------------|---------|------------|-----------|
 * | `quarter`   | 12      | 6          | 3         |
 * | `third`     | 12      | 6          | 4         |
 * | `half`      | 12      | 6          | 6         |
 * | `twoThirds` | 12      | 12         | 8         |
 * | `full`      | 12      | 12         | 12        |
 *
 * Every class is written out IN FULL. Tailwind resolves utilities by scanning
 * source TEXT, so a `col-span-${n}` template literal produces a `className` at
 * runtime that has no rule behind it in the built stylesheet.
 *
 * @module components/features/widgets/sizes
 */

import { WIDGET_WIDTHS, isWidgetWidth } from "nextly/config";

import type { WidgetWidth } from "@admin/types/dashboard/widgets";

/**
 * The five widths, narrowest first, and whether a value from the wire is one:
 * core's own, from `nextly/config`. The order is the width ranking the
 * nearest-width rule below reads, so it must be the server's, not a copy.
 */
export { WIDGET_WIDTHS, isWidgetWidth };

/**
 * Span classes per width, the table above as class text. Frozen because this
 * is the shared map, not a starting point a caller may edit for one grid.
 */
export const WIDTH_SPAN_CLASSES: Readonly<Record<WidgetWidth, string>> =
  Object.freeze({
    quarter:
      "col-span-12 @min-[640px]/dashboard:col-span-6 @min-[1024px]/dashboard:col-span-3",
    third:
      "col-span-12 @min-[640px]/dashboard:col-span-6 @min-[1024px]/dashboard:col-span-4",
    half: "col-span-12 @min-[640px]/dashboard:col-span-6 @min-[1024px]/dashboard:col-span-6",
    twoThirds:
      "col-span-12 @min-[640px]/dashboard:col-span-12 @min-[1024px]/dashboard:col-span-8",
    full: "col-span-12",
  });

/** How many of the grid's twelve tracks each width spans when drawn as chosen. */
const WIDTH_TRACKS: Readonly<Record<WidgetWidth, number>> = Object.freeze({
  quarter: 3,
  third: 4,
  half: 6,
  twoThirds: 8,
  full: 12,
});

/** What each width is called in the card menu, and its short label. */
export const WIDTH_NAMES: Readonly<
  Record<WidgetWidth, { name: string; fraction: string }>
> = Object.freeze({
  quarter: { name: "Quarter width", fraction: "¼" },
  third: { name: "Third width", fraction: "⅓" },
  half: { name: "Half width", fraction: "½" },
  twoThirds: { name: "Two-thirds width", fraction: "⅔" },
  full: { name: "Full width", fraction: "Full" },
});

/** A width's place in the ranking; a width this admin does not know ranks as full. */
function widthRank(width: string): number {
  return isWidgetWidth(width)
    ? WIDGET_WIDTHS.indexOf(width)
    : WIDGET_WIDTHS.length - 1;
}

/**
 * The width a stored placement is DRAWN at.
 *
 * The stored width while the widget still allows it. Otherwise the NEAREST
 * width it does allow, and the WIDER of two equally near: a card shown a little
 * too wide stays legible, one shown too narrow may not. The stored value itself
 * is never changed by this; it comes back if the widget allows it again.
 *
 * A width from a newer core counts as full, which is how the server reads one
 * too. With no allowed widths to go on (a widget missing from the read), the
 * stored width is drawn as it is.
 */
export function drawnWidth(
  stored: string,
  allowed: readonly WidgetWidth[] | undefined
): WidgetWidth {
  const rank = widthRank(stored);
  const own = WIDGET_WIDTHS[rank];
  if (!allowed || allowed.length === 0 || allowed.includes(own)) return own;
  // Nearness is measured in TRACKS, the width a reader actually sees, so a
  // two-thirds card the widget no longer allows draws at half (2 tracks
  // narrower) rather than full (4 tracks wider). Only a real tie in tracks
  // falls to the wider width.
  const tracks = WIDTH_TRACKS[own];
  let best = allowed[0];
  for (const candidate of allowed) {
    const distance = Math.abs(WIDTH_TRACKS[candidate] - tracks);
    const bestDistance = Math.abs(WIDTH_TRACKS[best] - tracks);
    // On a tie the higher rank replaces the current pick, so the wider of two
    // equally near wins whatever order the allowed list arrives in.
    if (
      distance < bestDistance ||
      (distance === bestDistance && widthRank(candidate) > widthRank(best))
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * The span classes for one card: its stored width, drawn at the nearest width
 * its widget allows. The one function the grid draws a card's width through.
 */
export function cardSpanClass(
  stored: string,
  allowed: readonly WidgetWidth[] | undefined
): string {
  return WIDTH_SPAN_CLASSES[drawnWidth(stored, allowed)];
}

/**
 * The width of a widget's declared size, for the cards drawn before any
 * arrangement has been read.
 *
 * Only that fallback asks this: once a read lands, every card carries the width
 * the server gave it. It is core's own conversion (`widthFromSize`), so a card
 * drawn before the read and the same card after it agree; anything that is not
 * a size, or nothing, is full, as the server reads it.
 */
export { widthFromSize as widthFromDeclaredSize } from "nextly/config";

/**
 * The deprecated `size?: "full" | "half"` alias, as a real size.
 *
 * Re-exported from core rather than defined here. The server reduces the same
 * contributed declaration to a canonical summary and has to read the same
 * alias, so the mapping belongs beside the vocabulary it translates into --
 * where both callers can ask it. Kept exported from this module because this is
 * where the dashboard's size questions are answered from.
 */
export { legacySizeToWidgetSize } from "nextly/config";
