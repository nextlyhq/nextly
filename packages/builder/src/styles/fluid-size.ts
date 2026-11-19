/**
 * The px a length comes to at a given page width, for a plain length or a
 * fluid `clamp(min, preferred, max)`, and a fluid length's range. Used to
 * draw a spacing's preview at the desktop width, and to say a fluid one as
 * "Fluid · 16–20px". No React.
 *
 * Plain lengths are read by {@link lengthInPx}, the inspector's own reading,
 * so a value is measured the same way in both places. The preferred term of
 * a clamp may also hold `vw` and a sum or difference of terms
 * (`0.875rem + 0.5vw`), as the built-in spacing writes it.
 *
 * @module fluid-size
 */
import type { FluidRangeWidths, FluidSizes } from "@nextlyhq/blocks-engine";

/**
 * The CSS pixels a root-relative length is at the browser's default size.
 *
 * `em` is read as `rem` is: what it resolves to depends on the element it is
 * used on, and a sample has no element, so the default size is the honest
 * single answer.
 */
const ROOT_PX = 16;

/**
 * How many CSS pixels a length is, or `undefined` for one this cannot measure
 * without a page: a percentage, a viewport unit, `clamp()`, a keyword.
 *
 * One reading of a length for every sample that sizes itself by one, the
 * Design panel's type specimen and the inspector's bars, so the two draw the
 * same variable at the same scale.
 */
export function lengthInPx(value: string): number | undefined {
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const unit = match[2];
  // Only zero may go without a unit; any other bare number is not a length.
  if (unit === undefined) return amount === 0 ? 0 : undefined;
  return unit === "px" ? amount : amount * ROOT_PX;
}

/** The smallest and largest a fluid length comes to, in px. */
export interface FluidRange {
  readonly minPx: number;
  readonly maxPx: number;
}

const CLAMP = /^clamp\(\s*([^,]+),\s*([^,]+),\s*([^,]+)\)$/i;

/** One term at a page width: a length, or so many `vw`. */
function termPx(term: string, width: number): number | undefined {
  const vw = /^(-?\d*\.?\d+)vw$/i.exec(term.trim());
  if (vw !== null) return (Number(vw[1]) * width) / 100;
  return lengthInPx(term);
}

/** A sum or difference of terms, as `0.875rem + 0.5vw` writes one. */
function sumPx(expression: string, width: number): number | undefined {
  const parts = expression.trim().split(/\s+([+-])\s+/);
  let total = termPx(parts[0] ?? "", width);
  for (let at = 1; at < parts.length && total !== undefined; at += 2) {
    const term = termPx(parts[at + 1] ?? "", width);
    if (term === undefined) return undefined;
    total = parts[at] === "-" ? total - term : total + term;
  }
  return total;
}

/**
 * What a length comes to at a page `width`, in px: a plain length as it
 * is, a clamp held between its bounds; `undefined` for what cannot be read.
 */
export function pxAtWidth(value: string, width: number): number | undefined {
  const clamp = CLAMP.exec(value.trim());
  if (clamp === null) return sumPx(value, width);
  const [min, preferred, max] = [clamp[1], clamp[2], clamp[3]].map(part =>
    sumPx(part ?? "", width)
  );
  if (min === undefined || preferred === undefined || max === undefined) {
    return undefined;
  }
  // As CSS works it out: the minimum wins where it is larger than the
  // maximum, so `clamp(32px, 2vw, 16px)` is 32px.
  return Math.max(min, Math.min(preferred, max));
}

/** A fluid length's range, from its clamp's bounds; `undefined` otherwise. */
export function fluidRange(value: string): FluidRange | undefined {
  const clamp = CLAMP.exec(value.trim());
  if (clamp === null) return undefined;
  const minPx = lengthInPx(clamp[1] ?? "");
  const maxPx = lengthInPx(clamp[3] ?? "");
  return minPx === undefined || maxPx === undefined
    ? undefined
    : { minPx, maxPx };
}

// The value a size made with Fluid… takes is a rule of the stored data, so
// it is the engine's; the editor reads it from there.
export {
  DEFAULT_FLUID_RANGE,
  fluidValue,
  type FluidRangeWidths,
  type FluidSizes,
} from "@nextlyhq/blocks-engine";
/**
 * The two sizes a written value comes to at the range's ends, rounded to
 * the px, to start "Fluid…" from on a value written by hand; `undefined`
 * for one that can't be read.
 */
export function nearestFluidSizes(
  value: string,
  range: FluidRangeWidths
): FluidSizes | undefined {
  const small = pxAtWidth(value, range.min);
  const large = pxAtWidth(value, range.max);
  return small === undefined || large === undefined
    ? undefined
    : { small: Math.round(small), large: Math.round(large) };
}
