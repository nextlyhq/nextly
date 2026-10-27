/**
 * The frame's measures that decide how tall a card's body is, each named once as the class the
 * frame draws with and the pixels that class draws.
 *
 * One source for both, so the body height worked out from a card's `h` cannot come to disagree
 * with the frame the body is drawn in: change a class here and the height follows it. Pixels
 * rather than rem throughout, as the grid's rows are, so neither follows the root font size.
 *
 * @module components/features/widgets/frame/measures
 */

import { cardHeightPx } from "../sizes";

/** The card's own border, drawn by the UI kit's `Card`: one pixel, top and bottom. */
const FRAME_BORDER_PX = 1;

/** The padding inside the card's border, on every side. */
export const FRAME_PADDING = { className: "p-4", px: 16 } as const;

/** The header: the title, the subtitle beneath it and the card's controls, in one fixed line. */
export const FRAME_HEADER = { className: "h-10", px: 40 } as const;

/** The space between the header and the body. */
export const FRAME_BODY_GAP = { className: "pt-3", px: 12 } as const;

/** The space above the footer's link. */
export const FRAME_FOOTER_GAP = { className: "pt-3", px: 12 } as const;

/** The footer link's one line: set in `text-xs`, whose line is 16 px. */
const FRAME_FOOTER_LINE_PX = 16;

/**
 * The height a card's body has, in pixels, when the card spans `h` rows.
 *
 * The card's height (`cardHeightPx`: its rows and the gaps between them) less what the frame
 * draws around the body: its border and padding top and bottom, the header, the gap under it,
 * and the footer's height. The footer is counted whether or not it shows a link: a list keeps
 * its room (foundations R-9), so the rows it draws do not change when "View all" appears.
 *
 * The same at every dashboard width: a card keeps its `h` in every band, and the gap down the
 * grid does not widen with the dashboard as the gap across does.
 */
export function cardBodyHeightPx(h: number): number {
  return (
    cardHeightPx(h) -
    2 * (FRAME_BORDER_PX + FRAME_PADDING.px) -
    FRAME_HEADER.px -
    FRAME_BODY_GAP.px -
    (FRAME_FOOTER_GAP.px + FRAME_FOOTER_LINE_PX)
  );
}
