/**
 * Colour conversions, as a server-safe entry point.
 *
 * Published at `@nextlyhq/ui/color` rather than from the root barrel, which carries a
 * `"use client"` banner: these are arithmetic on numbers with no React in them, and a colour a
 * server renders should not have to cross into client code to be converted.
 *
 * @module lib/color
 */

/**
 * @experimental sRGB channels in [0, 1], the shape every conversion here returns.
 */
export type { Rgb, Hsv, Oklch } from "./convert";

/**
 * @experimental An sRGB colour with its alpha, which a hex string can carry and `Rgb` cannot.
 */
export type { Rgba } from "./hex";

/**
 * @experimental Conversions between the models an editing surface needs.
 *
 * `hsvToRgb`/`rgbToHsv` are the picker's own geometry — a saturation-against-value square beside
 * a hue strip. `rgbToOklch`/`oklchToRgb` read and write the model this product's tokens are
 * written in; the OKLCH direction reduces chroma to reach the displayable gamut, so a colour a
 * screen cannot show is approximated by one of the SAME HUE rather than a different one.
 */
export {
  hsvToRgb,
  normalizeHue,
  oklchToRgb,
  rgbToHsv,
  rgbToOklch,
} from "./convert";

/**
 * @experimental Reading and writing the notation people type.
 *
 * `parseHex` answers `null` for anything that is not a colour yet, which is the ordinary state of a
 * field someone is part-way through typing into; `toHex` omits the alpha pair when the colour is
 * opaque, so a value reads back the way it was entered.
 */
export { parseHex, toHex } from "./hex";
