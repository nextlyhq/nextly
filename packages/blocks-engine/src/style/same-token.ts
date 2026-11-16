/**
 * Whether two site tokens say the same thing, and the JSON equality under it.
 *
 * The one answer to "has this token changed", asked where a stored override is
 * computed and where an editor decides whether Reset has anything to undo. Two
 * answers would disagree on some field, and the disagreement is an override
 * that is stored and cannot be reset.
 *
 * @module style/same-token
 */
import type { SiteToken } from "./site-tokens";

/**
 * Whether two tokens say the same thing.
 *
 * Field by field rather than by serialising both, because key order is not
 * meaning: a token that round-tripped through storage can carry its fields in
 * a different order and would compare as changed, so every edit anywhere would
 * store every config token — the failure this comparison exists to prevent.
 */
export function sameSiteToken(a: SiteToken, b: SiteToken): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.label === b.label &&
    a.kind === b.kind &&
    a.description === b.description &&
    a.values.light === b.values.light &&
    a.values.dark === b.values.dark &&
    // `extensions` is vendor data from Figma, Style Dictionary or whatever else
    // wrote the token, and DTCG requires a tool to preserve what it does not
    // understand. Left out of this comparison, a stored override differing ONLY
    // in extensions reads as identical to the config default — so the next edit
    // anywhere in the table filters it out of the payload and the vendor data is
    // gone, silently, from a save the author made about a different token.
    sameJsonValue(a.extensions, b.extensions) &&
    // The same argument for the half of this system's own extension key that
    // this build does not read. It is preserved for exactly one reason — that
    // an export written by an older build still carries what a newer one wrote
    // — and a comparison blind to it would drop it on the next unrelated edit,
    // which is the loss it exists to prevent.
    sameJsonValue(a.unreadExtension, b.unreadExtension)
  );
}

/**
 * Whether two values decoded from JSON say the same thing.
 *
 * Structural rather than `JSON.stringify`, because key order is not meaning and
 * a token that round-tripped through storage can carry its fields in another
 * order — the same reason the token comparison above is field by field. Written
 * for `extensions`, whose shape is by definition unknown: it is whatever
 * another tool wrote, so there is no set of fields to enumerate.
 */
export function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return sameJsonArray(a, b);
  if (isJsonRecord(a) && isJsonRecord(b)) return sameJsonRecord(a, b);
  // Two primitives that were not `===` above, or one of each kind. Neither is
  // worth descending into.
  return false;
}

/**
 * Two arrays, element by element and in order.
 *
 * Asked apart from the record case because order MATTERS here and does not
 * there, which is the whole difference between the two — and an equality that
 * decided both in one branch would be one edit from applying the wrong rule.
 * An array beside a non-array is not equal, which is why both sides are tested
 * rather than only the one that got us here.
 */
function sameJsonArray(a: unknown, b: unknown): boolean {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((item, index) => sameJsonValue(item, b[index]))
  );
}

/** Two records: the same own keys, and the same value under each. */
function sameJsonRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && sameJsonValue(a[key], b[key]))
  );
}

/** An object with named keys, as JSON produces. Arrays are handled apart. */
function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
