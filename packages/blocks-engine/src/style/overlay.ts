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

/**
 * The background longhands a browser pairs with the image's layers one by
 * one, each with the custom property holding the overlay layer's own entry
 * and that entry, its comma included: each longhand's initial value, which
 * a flat fill covers the box with. Written beside the layer, so a list the
 * image's longhands carry (`cover, contain`) keeps lining up with the image
 * once the layer is in front of it; without the entry, the layer would take
 * the image's first item and shift the rest.
 */
export const OVERLAY_ALIGNED: ReadonlyMap<
  string,
  { readonly property: string; readonly value: string }
> = new Map([
  [
    "background-position",
    { property: "--nx-pb-overlay-position", value: "0% 0%," },
  ],
  ["background-size", { property: "--nx-pb-overlay-size", value: "auto," }],
  [
    "background-repeat",
    { property: "--nx-pb-overlay-repeat", value: "repeat," },
  ],
  [
    "background-attachment",
    { property: "--nx-pb-overlay-attachment", value: "scroll," },
  ],
]);

/**
 * A background longhand's declared value, reading the overlay layer's entry in
 * front of it: as is when the property pairs with no layer, and for a CSS-wide
 * keyword, which names the whole value and takes nothing in front of it.
 */
export function alignedWithOverlay(
  cssProperty: string,
  text: string,
  cssWide: boolean
): string {
  const aligned = OVERLAY_ALIGNED.get(cssProperty);
  return aligned === undefined || cssWide
    ? text
    : `var(${aligned.property},) ${text}`;
}

/** What every custom property the overlay writes starts with, for a reader. */
export const OVERLAY_PREFIX: string = OVERLAY_COLOR;

/** The reset a sheet using the overlay carries, once: what stops it inheriting. */
export const OVERLAY_RESET: string = `:where(.${PAGE_ROOT_CLASS} *) { ${[
  OVERLAY_COLOR,
  OVERLAY_STRENGTH,
  OVERLAY_LAYER_PROPERTY,
  ...[...OVERLAY_ALIGNED.values()].map(aligned => aligned.property),
]
  .map(property => `${property}: initial;`)
  .join(" ")} }`;
