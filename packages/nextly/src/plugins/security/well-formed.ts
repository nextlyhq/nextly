/**
 * Whether a string is well-formed Unicode, for the security helpers that hash
 * or key what a plugin hands them.
 *
 * @module plugins/security/well-formed
 */

/** A UTF-16 unit of a surrogate pair standing alone, in either order. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Whether the string is well-formed Unicode. One holding a lone surrogate,
 * which JSON can carry as an escape, is encoded to UTF-8 with every such unit
 * replaced by the same character, so two different strings would hash, and
 * key, alike. The helpers refuse them rather than let them collapse.
 */
export function isWellFormed(text: string): boolean {
  return !LONE_SURROGATE.test(text);
}

/**
 * Whether the string can be stored as a key on every dialect: well-formed,
 * and free of NUL, which PostgreSQL's text cannot hold while MySQL and SQLite
 * can, so the same call would fail on one database alone.
 */
export function isStorableText(text: string): boolean {
  return !text.includes("\u0000") && isWellFormed(text);
}
