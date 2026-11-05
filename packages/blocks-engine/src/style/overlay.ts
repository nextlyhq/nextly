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
 * Registered as NOT inherited, so a section's overlay never darkens an image
 * nested inside it; each `var()` carries a fallback, so where the
 * registration is absent the image still paints.
 *
 * @module style/overlay
 */

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

/** The image's declared value with the overlay's layer in front of it. */
export function overlaid(image: string): string {
  return `${OVERLAY_LAYER}, ${image}`;
}

/** The registrations a sheet using the overlay carries, once. */
export const OVERLAY_REGISTRATION = [
  `@property ${OVERLAY_COLOR} { syntax: "<color>"; inherits: false; initial-value: transparent; }`,
  `@property ${OVERLAY_STRENGTH} { syntax: "<number>"; inherits: false; initial-value: ${DEFAULT_STRENGTH}; }`,
].join("\n");
