/**
 * A field's key as a person reads it: the one humaniser, for every surface
 * that names a field by its key, the server's and the admin's alike.
 *
 * A widget's `describe` read names each field the way the admin's screens do,
 * so a field the collection gives no label to is named once, by this, wherever
 * it is shown. Server-safe and importing nothing, so the admin reaches it
 * through `nextly/field-label` and takes nothing more. Not a public API; it may
 * change in any release.
 *
 * @internal
 * @module collections/fields/field-label
 */

/**
 * A field's key as a human reads it.
 *
 * Kebab and snake are both legal in a schema and both mean a word boundary, so
 * they are treated identically — one earlier copy split on `_` alone and left
 * `user-email` as "User-email".
 *
 * @example
 * humanizeFieldName("firstName")  // "First Name"
 * humanizeFieldName("user_email") // "User Email"
 * humanizeFieldName("user-email") // "User Email"
 * humanizeFieldName("address1Line") // "Address1 Line"
 *
 * @internal
 */
export function humanizeFieldName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}
