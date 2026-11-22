/**
 * The site's colour order: which colour variables the colour picker lists
 * first, by identity. One rule for what an order the site can store is,
 * which the stored site style is checked by and a design token file's order
 * is read by, so a file can never carry an order the save then refuses.
 *
 * @module style/colour-order
 */
import { MAX_TOKEN_NAME_LENGTH } from "./declarations";

/** The most colours an order may list: far beyond any palette. */
const MAX_COLOUR_ORDER = 1000;

/**
 * Whether `value` is a colour order the site can store: identities, each
 * once, none empty or longer than a code name can be, and no more than
 * {@link MAX_COLOUR_ORDER}. A colour the order does not name is listed
 * after the ones it does, so an order naming a colour since removed is
 * harmless.
 */
export function isColourOrder(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_COLOUR_ORDER &&
    value.every(
      identity =>
        typeof identity === "string" &&
        identity !== "" &&
        identity.length <= MAX_TOKEN_NAME_LENGTH
    ) &&
    new Set(value).size === value.length
  );
}
