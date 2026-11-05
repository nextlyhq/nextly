/**
 * A background's overlay: a colour laid over its image, under the content.
 *
 * Stored with the background as two values, a colour and a strength, and
 * compiled as two custom properties of their own, which the image's
 * declaration reads through one more layer in front of the image. Two
 * properties rather than one joined `background-image`, because the engine
 * compiles one device's values at a time: an overlay set at the base still
 * has to cover an image set at a narrower device, and each value keeps its
 * own entry in the trace.
 *
 * NOT inherited, so a section's overlay never darkens an image nested inside
 * it: every element in the page resets both to `initial` under a rule of no
 * specificity, which any block's own value beats, and each `var()` carries a
 * fallback, so an element with neither set paints its image uncovered. A reset
 * rather than an `@property` registration, which is not yet widely available.
 *
 * @module style/overlay
 */

import { PAGE_ROOT_CLASS } from "./node-class";

/** The overlay's colour, as its custom property. */
export const OVERLAY_COLOR = "--nx-pb-overlay";

/** How strongly the colour covers the image, 0 to 100, as its custom property. */
export const OVERLAY_STRENGTH = "--nx-pb-overlay-strength";

/** The strength an overlay has before one is chosen. */
const DEFAULT_STRENGTH = 50;

/** The colour the layer paints: the overlay's, mixed with clear by strength. */
const LAYER_COLOUR = `color-mix(in srgb, var(${OVERLAY_COLOR}, transparent) calc(var(${OVERLAY_STRENGTH}, ${DEFAULT_STRENGTH}) * 1%), transparent)`;

/** The layer laid in front of an image: a flat fill of the overlay's colour. */
const OVERLAY_LAYER = `linear-gradient(${LAYER_COLOUR}, ${LAYER_COLOUR})`;

/**
 * The overlay's layer, as a custom property the overlay's colour writes
 * beside itself, its comma included: an image reads it in front of itself,
 * so a background with no overlay keeps exactly the layers it had, and a
 * list of sizes or positions still lines up with its image.
 */
export const OVERLAY_LAYER_PROPERTY = "--nx-pb-overlay-layer";

/** What the overlay's colour writes into {@link OVERLAY_LAYER_PROPERTY}. */
export const OVERLAY_LAYER_VALUE: string = `${OVERLAY_LAYER},`;

/** The image's declared value, reading the overlay's layer in front of it. */
export function overlaid(image: string): string {
  return `var(${OVERLAY_LAYER_PROPERTY},) ${image}`;
}

/** The reset a sheet using the overlay carries, once: what stops it inheriting. */
export const OVERLAY_RESET: string = `:where(.${PAGE_ROOT_CLASS} *) { ${OVERLAY_COLOR}: initial; ${OVERLAY_STRENGTH}: initial; ${OVERLAY_LAYER_PROPERTY}: initial; }`;
