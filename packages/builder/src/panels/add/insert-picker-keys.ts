/**
 * How the in-place picker's highlight moves with the keyboard, decided
 * without a DOM: the six at rest are a grid of three columns, where every
 * arrow moves, and the search's results are a list, where Up and Down do.
 *
 * The picker publishes the matching structure to assistive technology (a
 * grid of rows and cells, or a listbox), so what a screen reader says about
 * the highlight is what the arrow keys do with it.
 *
 * @module insert-picker-keys
 */

/** How the picker's choices are laid out: the six at rest, or results. */
export type PickerLayout = "grid" | "list";

/** How many cells a row of the six holds. */
export const PICKER_COLUMNS = 3;

/**
 * Where the highlight goes for a key, or `undefined` for a key that does not
 * move it (the key then does what it would in the search field).
 *
 * The highlight never wraps: at an edge the key keeps it where it is, so a
 * repeated press cannot carry an author from the last block to the first
 * without them noticing.
 *
 * @param layout - grid at rest, list while searching
 * @param index - the highlighted choice
 * @param count - how many choices there are
 * @param key - the pressed key's `key`
 * @returns the new highlighted index, or `undefined`
 */
export function movedHighlight(
  layout: PickerLayout,
  index: number,
  count: number,
  key: string
): number | undefined {
  if (count === 0) return undefined;
  const last = count - 1;
  const clamp = (next: number): number => Math.min(Math.max(next, 0), last);
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (layout === "list") {
    if (key === "ArrowDown") return clamp(index + 1);
    if (key === "ArrowUp") return clamp(index - 1);
    return undefined;
  }
  return gridMove(index, last, key);
}

/** One arrow key in the grid; a row move that leaves the grid stays put. */
function gridMove(
  index: number,
  last: number,
  key: string
): number | undefined {
  const step: Readonly<Record<string, number>> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: PICKER_COLUMNS,
    ArrowUp: -PICKER_COLUMNS,
  };
  const delta = step[key];
  if (delta === undefined) return undefined;
  const next = index + delta;
  return next < 0 || next > last ? index : next;
}

/** The grid's rows: each a run of {@link PICKER_COLUMNS} choices. */
export function gridRows<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += PICKER_COLUMNS) {
    rows.push(items.slice(start, start + PICKER_COLUMNS));
  }
  return rows;
}
