/**
 * The WCAG 2.x contrast ratio, the one implementation of it in this package.
 *
 * Not exported from `@nextlyhq/ui/color`: which formula, which compositing
 * rule and which gamut-edge behaviour a contrast check uses are decisions this
 * package may need to revise, and publishing them would freeze them. It lives
 * here, with no imports, so the theme's build-time contrast check and the
 * runtime adjustment of brand colours ({@link readableOn}) read the same
 * formula rather than two copies of it.
 *
 * @module lib/color/wcag
 */

import type { Rgb } from "./convert";

/** Linearize one gamma-encoded sRGB channel (the WCAG 2.x transfer function). */
function channelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a gamma-encoded sRGB colour. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  );
}

/**
 * WCAG 2.x contrast ratio between two OPAQUE colours, from 1:1 to 21:1. A
 * translucent colour must be composited over its surface first.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
