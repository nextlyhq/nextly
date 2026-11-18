/**
 * The value a size made from two sizes takes: small on the smallest screen of
 * the site's fluid range, large on its largest, growing evenly between.
 *
 * Here rather than in the editor, because it is a rule of the stored data: a
 * token carrying `fluid` holds this value for the set's `fluidRange`. The
 * editor writes it, and a save that merges two authors' edits writes it again
 * from what the merge kept, so the stored value and the sizes "Fluid…" shows
 * never disagree.
 *
 * @module style/fluid-value
 */

/** The page widths a fluid size grows across, in px. */
export interface FluidRangeWidths {
  readonly min: number;
  readonly max: number;
}

/** The site's fluid range until it sets its own: a phone to a laptop. */
export const DEFAULT_FLUID_RANGE: FluidRangeWidths = { min: 360, max: 1280 };

/** A fluid size's two sizes, in px: on small screens and on large ones. */
export interface FluidSizes {
  readonly small: number;
  readonly large: number;
}

/** px as rem, to four places: a site's root size scales what it writes. */
function rem(px: number): string {
  return `${String(Math.round((px / 16) * 10000) / 10000)}rem`;
}

/**
 * The size that is `small` at the range's narrow end, `large` at its wide
 * end, grows evenly between them and stays at each end outside it: a
 * `clamp()` of the smaller and the larger around a line through the two
 * points. Written in rem so it follows the reader's text size.
 */
export function fluidValue(sizes: FluidSizes, range: FluidRangeWidths): string {
  const slope = (sizes.large - sizes.small) / (range.max - range.min);
  const intercept = sizes.small - slope * range.min;
  const vw = Math.round(slope * 100 * 10000) / 10000;
  const preferred = `${rem(intercept)} + ${String(vw)}vw`;
  const low = Math.min(sizes.small, sizes.large);
  const high = Math.max(sizes.small, sizes.large);
  return `clamp(${rem(low)}, ${preferred}, ${rem(high)})`;
}
