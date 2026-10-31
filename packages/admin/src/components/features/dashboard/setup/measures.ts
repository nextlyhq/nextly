/**
 * The setup card's own measures, each named once as the class it is drawn with beside the pixels
 * that class draws, so a test can hold the expanded card to the body its 12 × 2 size gives it.
 *
 * Expanded, the card's body holds a progress bar and, under it, one row of tiles: at the size
 * `specs/dashboard-experience` R-6 gives the card (12 × 2), a 46 px body (`cardBodyHeightPx(2)`).
 * The count, "N of M done", is in the frame's header beside the title, so the body holds nothing
 * else. Each tile is two lines, its label and a one-line hint carrying its actions, in a fixed
 * height. The tiles are one row at every width (`SETUP_ROW`), so the body is this height whatever
 * the card's width, and the card is drawn at its stored rows from its first paint: where the body
 * is too narrow for every tile to read in full, the row scrolls sideways inside the card rather
 * than wrapping into rows the card would have to grow to hold.
 *
 * @module components/features/dashboard/setup/measures
 */

/** The progress bar: a thin line. */
export const SETUP_BAR = { className: "h-1", px: 4 } as const;

/** The space between the bar and the tiles, and between two tiles. */
export const SETUP_GAP = { className: "gap-1", px: 4 } as const;

/**
 * One tile: a 1 px border, 2 px of padding top and bottom, a 16 px label line and a 14 px hint
 * line, in a fixed height so a tile never grows the row.
 */
export const SETUP_TILE = { className: "h-9", px: 36 } as const;

/** The two lines inside a tile, as their classes draw them. */
export const SETUP_TILE_LINES = {
  label: "text-xs leading-4",
  hint: "text-xs leading-[14px]",
} as const;

/** The expanded body's height, in pixels, when its tiles are in one row. */
export const SETUP_ROW_BODY_PX = SETUP_BAR.px + SETUP_GAP.px + SETUP_TILE.px;

/**
 * The tiles' row, one tile high at every width, so the card's body never needs more than
 * `SETUP_ROW_BODY_PX` whatever the card's width or the number of steps:
 * - one column per tile, flowing along the row (`grid-flow-col`), never wrapping;
 * - each column shares the row equally where the body has room, and is never narrower than its
 *   own tile's name and actions (`minmax(max-content, 1fr)`): only a step's detail words, which
 *   take no width of their own (`SETUP_TILE_DETAIL`), are cut short;
 * - where the body is narrower than the tiles at that width, a phone's or a narrow card's, the row
 *   scrolls sideways inside the card, a tile at a time, the next one cut by the card's edge to
 *   show there is more. Its scrollbar is not drawn, since the row has no height to spare for one:
 *   a tile's links and buttons scroll it into view as they take focus, and a touch or a trackpad
 *   scrolls it directly.
 */
export const SETUP_ROW = {
  className:
    "grid-flow-col auto-cols-[minmax(max-content,1fr)] overflow-x-auto overscroll-x-contain snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  tile: "snap-start",
} as const;

/**
 * A step's detail words in its tile's hint line, which give the tile none of its width
 * (`contain: inline-size`): a tile is as wide as its name and its actions, and its detail fills
 * what is left, cut short with its whole words on hover.
 */
export const SETUP_TILE_DETAIL = "[contain:inline-size]";
