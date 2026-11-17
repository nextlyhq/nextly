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
import { lengthInPx } from "./style-variables";

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
  return Math.min(max, Math.max(min, preferred));
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
