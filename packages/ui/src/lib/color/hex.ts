/**
 * Hex is the notation people type, so it is the picker's front door.
 *
 * It lives beside the conversions rather than in the component that reads it, for the same reason
 * they do: parsing `#3b82f6` is arithmetic on a string, a server rendering a token swatch needs it
 * as much as an editing surface does, and pulling it into client code would put it behind the
 * `"use client"` boundary for no benefit.
 *
 * @module lib/color/hex
 */

import type { Rgb } from "./convert";

/**
 * An sRGB colour with its alpha, which is what a hex string can carry and {@link Rgb} cannot.
 *
 * `alpha` is in [0, 1] like the channels, rather than 0-255, so it composes with the conversions
 * without a second unit in play.
 *
 * @experimental
 */
export interface Rgba extends Rgb {
  alpha: number;
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, with the hash optional and case ignored. */
const HEX = /^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** A channel byte as a two-digit lowercase pair. */
function pair(channel: number): string {
  // A non-finite channel becomes 0 rather than passing through. `clamp01(NaN)` is NaN, because
  // both of its comparisons are false, and formatting that yields the three characters "NaN" —
  // producing `#NaN0000`, which is exactly the string this module documents itself as never
  // returning.
  const value = Number.isFinite(channel) ? clamp01(channel) : 0;
  return Math.round(value * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * Read a hex colour, or `null` if the input is not one.
 *
 * Returns `null` rather than throwing or substituting black: this reads what someone is part-way
 * through typing, where "not a colour yet" is the ordinary case and neither an exception nor a
 * silent black is a useful answer. A caller decides whether to hold the last good value, show a
 * message, or wait.
 *
 * Both short forms are accepted because both are what people paste. `#abc` expands by REPEATING
 * each digit rather than padding with zero — `#abc` is `#aabbcc`, not `#a0b0c0` — which is what CSS
 * does and the only expansion under which `#fff` is white.
 *
 * @experimental
 */
export function parseHex(input: string): Rgba | null {
  const text = input.trim();
  if (!HEX.test(text)) return null;

  const digits = text.replace("#", "");
  const short = digits.length < 6;
  const size = short ? 1 : 2;
  const channel = (index: number): number => {
    const slice = digits.slice(index * size, index * size + size);
    return parseInt(short ? slice + slice : slice, 16) / 255;
  };

  const hasAlpha = digits.length === 4 || digits.length === 8;
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    alpha: hasAlpha ? channel(3) : 1,
  };
}

/**
 * Write a colour as `#rrggbb`, or `#rrggbbaa` when it is not fully opaque.
 *
 * The alpha pair is omitted at 1 rather than always written, because `#3b82f6ff` is the same colour
 * and the shorter form is what someone expects to see in a field they typed `#3b82f6` into.
 *
 * Channels outside [0, 1] are clamped, so the result is always a valid six- or eight-digit hex
 * string whatever a caller passes. Not for floating-point drift, which rounds to the right byte on
 * its own: it is for a value that is wrong by a lot — a channel still in 0-255, or a computation
 * that overshot — where the alternative is emitting `#17f00-80`, a string nothing downstream can
 * parse and no error explains.
 *
 * @experimental
 */
export function toHex(color: Rgb, alpha = 1): string {
  // A non-finite alpha falls back to 1, not to 0 as a channel does. Both are "nothing was
  // specified", and for alpha that is this parameter's own default — where treating it as 0 would
  // turn a colour invisible on a stray NaN, silently and with no way to tell from the output.
  const opacity = Number.isFinite(alpha) ? clamp01(alpha) : 1;
  const opaque = `#${pair(color.r)}${pair(color.g)}${pair(color.b)}`;
  return opacity === 1 ? opaque : `${opaque}${pair(opacity)}`;
}
