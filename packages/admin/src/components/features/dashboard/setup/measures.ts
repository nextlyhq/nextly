/**
 * The setup card's own measures, each named once as the class it is drawn with beside the pixels
 * that class draws, so a test can hold the expanded card to the body its 12 × 2 size gives it.
 *
 * Expanded, the card's body holds a progress bar and, under it, one row of tiles: at the size
 * `specs/dashboard-experience` R-6 gives the card (12 × 2), a 46 px body (`cardBodyHeightPx(2)`).
 * The count, "N of M done", is in the frame's header beside the title, so the body holds nothing
 * else. Each tile is two lines, its label and a one-line hint carrying its actions, in a fixed
 * height. Below 640 px the tiles wrap into two columns, and only then does the card grow to hold
 * them.
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
  hint: "text-[11px] leading-[14px]",
} as const;

/** The expanded body's height, in pixels, when its tiles are in one row. */
export const SETUP_ROW_BODY_PX = SETUP_BAR.px + SETUP_GAP.px + SETUP_TILE.px;
