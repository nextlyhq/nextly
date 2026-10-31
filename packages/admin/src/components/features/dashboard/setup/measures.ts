/**
 * The setup card's own measures, each named once as the class it is drawn with beside the pixels
 * that class draws, so a test can hold the expanded card to the body its 12 × 2 size gives it.
 *
 * Expanded, the card's body holds a progress bar and, under it, one row of tiles: at the size
 * `specs/dashboard-experience` R-6 gives the card (12 × 2), a 46 px body (`cardBodyHeightPx(2)`).
 * The count, "N of M done", is in the frame's header beside the title, so the body holds nothing
 * else. Each tile is two lines, its label and a one-line hint carrying its actions, in a fixed
 * height. The tiles are one row only where the body gives each tile room to read in full
 * (`SETUP_TILE_MIN_PX`); narrower, they wrap into two columns, and only then does the card grow
 * to hold them.
 *
 * @module components/features/dashboard/setup/measures
 */

import { cn } from "@admin/lib/utils";

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
 * The least width a tile takes in the one row: its longest name ("Add your first entry", 113 px
 * of ink at the label's size) and the Singles' hint ("2 of 5 · Open · Skip") read in full beside
 * its mark, with the tile's padding.
 */
export const SETUP_TILE_MIN_PX = 160;

/**
 * The classes that lay `count` tiles out as one row where the body (an `@container`) is at least
 * `count` tiles of `SETUP_TILE_MIN_PX` and the gaps between them wide, over two columns
 * (`grid-cols-2`) where it is not. Written out whole, one entry per count, so the stylesheet keeps
 * every class; a count past the last is drawn in two columns.
 */
const SETUP_ONE_ROW_AT: Readonly<Record<number, string>> = {
  1: "@min-[160px]:grid-flow-col @min-[160px]:auto-cols-fr @min-[160px]:grid-cols-none",
  2: "@min-[324px]:grid-flow-col @min-[324px]:auto-cols-fr @min-[324px]:grid-cols-none",
  3: "@min-[488px]:grid-flow-col @min-[488px]:auto-cols-fr @min-[488px]:grid-cols-none",
  4: "@min-[652px]:grid-flow-col @min-[652px]:auto-cols-fr @min-[652px]:grid-cols-none",
  5: "@min-[816px]:grid-flow-col @min-[816px]:auto-cols-fr @min-[816px]:grid-cols-none",
  6: "@min-[980px]:grid-flow-col @min-[980px]:auto-cols-fr @min-[980px]:grid-cols-none",
};

/** The width at which `count` tiles fit one row: each `SETUP_TILE_MIN_PX`, `SETUP_GAP` between. */
export function setupOneRowPx(count: number): number {
  return count * SETUP_TILE_MIN_PX + (count - 1) * SETUP_GAP.px;
}

/** The tiles' grid classes for `count` tiles: one row where they fit, two columns elsewhere. */
export function setupRowClass(count: number): string {
  return cn("grid-cols-2", SETUP_ONE_ROW_AT[count]);
}
