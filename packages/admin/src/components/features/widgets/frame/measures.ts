/**
 * The frame's measures that decide how tall a card's body is, each named once as the class the
 * frame draws with beside the pixels that class draws.
 *
 * The pixels are core's (`CARD_FRAME_PX` in `nextly/card-geometry`), and so is the body height
 * worked out from them, the one a widget's server `load` counts its rows by: the classes here are
 * what the frame draws those numbers with, and the frame's tests read the classes back off a drawn
 * card. Pixels rather than rem throughout, as the grid's rows are, so neither follows the root
 * font size.
 *
 * @module components/features/widgets/frame/measures
 */

import { CARD_FRAME_PX } from "nextly/card-geometry";

// The body height a card of `h` rows has: core's, so the frame and a server `load` read one.
export { cardBodyHeightPx } from "nextly/card-geometry";

/** The padding inside the card's border, on every side. */
export const FRAME_PADDING = {
  className: "p-4",
  px: CARD_FRAME_PX.padding,
} as const;

/** The header: the title, the subtitle beneath it and the card's controls, in one fixed line. */
export const FRAME_HEADER = {
  className: "h-10",
  px: CARD_FRAME_PX.header,
} as const;

/** The space between the header and the body. */
export const FRAME_BODY_GAP = {
  className: "pt-3",
  px: CARD_FRAME_PX.bodyGap,
} as const;

/** The space above the footer's link, whose one line is set in `text-xs`. */
export const FRAME_FOOTER_GAP = {
  className: "pt-3",
  px: CARD_FRAME_PX.footerGap,
} as const;
