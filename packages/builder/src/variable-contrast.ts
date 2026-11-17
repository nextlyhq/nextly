/**
 * A colour's contrast in the Design panel's words: the WCAG 2 ratio to two
 * decimals ("4.83:1"), and what it is good for. "Readable as text" from
 * 4.5:1, the threshold for body text; "Large text only" from 3:1, the one
 * for large text and for controls; "Low contrast" below. The ratio is the
 * engine's own, so a figure here agrees with every other contrast check.
 *
 * @module variable-contrast
 */
import { checkContrast } from "@nextlyhq/blocks-engine";

/** What a ratio is good for, in words. */
export type ContrastBand = "Readable as text" | "Large text only" | "Low contrast";

/** One pair's contrast, as the colour's editor says it. */
export interface ContrastLine {
  /** The ratio to two decimals: "4.83:1". */
  readonly ratio: string;
  readonly band: ContrastBand;
}

/**
 * The contrast of `foreground` on `background`, or `undefined` when either
 * cannot be read as a colour (a `var()`, say): no figure is better than a
 * wrong one.
 */
export function contrastLine(
  foreground: string,
  background: string
): ContrastLine | undefined {
  const result = checkContrast(foreground, background);
  if (result === undefined) return undefined;
  return {
    ratio: `${shownRatio(result.ratio)}:1`,
    band:
      result.ratio >= 4.5
        ? "Readable as text"
        : result.ratio >= 3
          ? "Large text only"
          : "Low contrast",
  };
}

/**
 * The ratio to two places, rounded, except where rounding would carry it
 * over a threshold it does not meet: 4.497 shows as "4.49", not "4.50" beside
 * "Large text only".
 */
function shownRatio(ratio: number): string {
  const rounded = Math.round(ratio * 100) / 100;
  const crosses = [4.5, 3].some(edge => ratio < edge && rounded >= edge);
  return (crosses ? Math.floor(ratio * 100) / 100 : rounded).toFixed(2);
}
