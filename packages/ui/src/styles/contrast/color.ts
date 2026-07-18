/**
 * Color math for the token-contrast check.
 *
 * The genuinely hard, gamut-sensitive step (OKLCH -> sRGB) is delegated to
 * culori, which implements CSS Color Module Level 4. Everything WCAG-specific
 * (alpha compositing, relative luminance, contrast ratio) is done here in a few
 * bounded, well-known formulas so it can be unit-tested directly and read at a
 * glance. A test cross-checks this luminance against culori's own to guard
 * against a formula typo.
 */
import { converter, parse } from "culori";

const toRgb = converter("rgb");

/** An sRGB color with gamma-encoded channels in [0, 1] and an alpha in [0, 1]. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Parse a resolved CSS color string (oklch, hex, ...) to gamma-encoded sRGB.
 *
 * Channels are clamped to [0, 1]: an OKLCH value can fall outside the sRGB
 * gamut, and a browser can only display what fits, so the contrast a user
 * actually sees is computed from the clamped color.
 */
export function toClampedRgb(color: string): Rgb {
  const parsed = parse(color);
  const rgb = parsed ? toRgb(parsed) : undefined;
  if (!rgb) {
    throw new Error(`could not parse color: ${JSON.stringify(color)}`);
  }
  return {
    r: clamp01(rgb.r),
    g: clamp01(rgb.g),
    b: clamp01(rgb.b),
    alpha: rgb.alpha ?? 1,
  };
}

/**
 * Composite a (possibly translucent) foreground over an opaque background with
 * the standard source-over operator, in gamma-encoded sRGB.
 *
 * This is deliberately done in gamma space rather than linear light: it matches
 * how a browser paints a translucent border over its surface, so the contrast
 * asserted here is the contrast that renders. Compositing in linear light would
 * be more colorimetrically pure but would not match the pixels on screen. This
 * is the step the Primer color system got wrong at first: our borders are alpha
 * (`oklch(0 0 0 / 0.13)`), and asserting on the raw translucent value is
 * meaningless until it is blended onto the surface it sits on.
 */
export function compositeOver(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.alpha;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    alpha: 1,
  };
}

/** Linearize one gamma-encoded sRGB channel (the WCAG 2.x transfer function). */
function channelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a gamma-encoded sRGB color (alpha ignored). */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  );
}

/**
 * WCAG 2.x contrast ratio between two OPAQUE colors, from 1:1 to 21:1. Any
 * translucent color must be composited (see {@link compositeOver}) first — the
 * alpha channel is not consulted here.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolve a color token to an OPAQUE sRGB color, compositing over `base` when
 * the token is itself translucent. Surfaces are expected to be opaque; the
 * `base` fallback keeps the check correct if one ever gains an alpha.
 */
export function toOpaque(color: string, base: Rgb): Rgb {
  const rgb = toClampedRgb(color);
  return rgb.alpha < 1 ? compositeOver(rgb, base) : rgb;
}

/** `#rrggbb` for a color, for human-readable failure messages. */
export function toHex(rgb: Rgb): string {
  const channel = (c: number): string =>
    Math.round(clamp01(c) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}
