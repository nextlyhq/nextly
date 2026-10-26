/**
 * A colour made readable on the surfaces it is drawn on, by its lightness
 * alone.
 *
 * For colours that are not known when the theme is built, such as a tenant's
 * brand colours drawn as chart marks, and so cannot be held to a contrast
 * minimum by the theme's own test. The colour is never refused: one that
 * already reads is returned exactly as given, and one that does not keeps the
 * hue and chroma the tenant chose and moves its OKLCH lightness, as little as
 * it takes, until it reads on every surface. OKLCH because its lightness is
 * perceptual, so the smallest step there is the smallest change a reader sees.
 *
 * @module lib/color/readable-on
 */

import { oklchToRgb, rgbToOklch, type Oklch, type Rgb } from "./convert";
import { contrastRatio } from "./wcag";

/** The step the lightness search takes, small beside what a reader can tell apart. */
const STEP = 0.001;

/**
 * The colour as it will be drawn: each channel rounded to the 8 bits a hex
 * value carries. The ratio is checked on THIS, so a colour written out as hex
 * keeps the ratio it was found at.
 */
function asDrawn(rgb: Rgb): Rgb {
  const round = (channel: number) => Math.round(channel * 255) / 255;
  return { r: round(rgb.r), g: round(rgb.g), b: round(rgb.b) };
}

/** The lowest ratio `color` has against any of `surfaces`. */
function lowestRatio(color: Rgb, surfaces: readonly Rgb[]): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const surface of surfaces) {
    lowest = Math.min(lowest, contrastRatio(color, surface));
  }
  return lowest;
}

/**
 * `color`, or the nearest colour of its hue and chroma that reaches `minimum`
 * against every one of `surfaces`.
 *
 * Searches outward from the colour's own lightness, one step each way at a
 * time, and takes the first lightness that reads; where both directions read
 * at the same distance, the one reading better. Should no lightness reach the
 * minimum on every surface, it returns the one that comes closest: a brand
 * colour is adjusted, never refused.
 *
 * Chroma is reduced only where the display cannot show it at the new
 * lightness, which is `oklchToRgb`'s own rule; hue is kept.
 *
 * @experimental
 */
export function readableOn(
  color: Rgb,
  surfaces: readonly Rgb[],
  minimum: number = 3
): Rgb {
  if (surfaces.length === 0 || lowestRatio(color, surfaces) >= minimum) {
    return color;
  }
  const oklch = rgbToOklch(color);
  const drawn = asDrawn(color);
  let best: Candidate = { rgb: drawn, ratio: lowestRatio(drawn, surfaces) };
  const steps = Math.ceil(1 / STEP);
  for (let i = 1; i <= steps; i += 1) {
    const candidates = candidatesAt(oklch, i * STEP, surfaces);
    best = betterOf(best, candidates);
    const reading = candidates.filter(c => c.ratio >= minimum);
    const [first] = reading;
    if (first !== undefined) return betterOf(first, reading).rgb;
  }
  return best.rgb;
}

/** A colour as drawn, with the lowest ratio it reaches on the surfaces. */
interface Candidate {
  rgb: Rgb;
  ratio: number;
}

/**
 * The colours `distance` either side of `oklch`'s lightness, darker first, as
 * drawn and with their lowest ratio; none past black or white.
 */
function candidatesAt(
  oklch: Oklch,
  distance: number,
  surfaces: readonly Rgb[]
): Candidate[] {
  return [oklch.l - distance, oklch.l + distance]
    .filter(lightness => lightness >= 0 && lightness <= 1)
    .map(lightness => {
      const rgb = asDrawn(oklchToRgb({ ...oklch, l: lightness }));
      return { rgb, ratio: lowestRatio(rgb, surfaces) };
    });
}

/** The best-reading of `current` and `candidates`, the earlier one on a tie. */
function betterOf(
  current: Candidate,
  candidates: readonly Candidate[]
): Candidate {
  return candidates.reduce(
    (kept, next) => (next.ratio > kept.ratio ? next : kept),
    current
  );
}
