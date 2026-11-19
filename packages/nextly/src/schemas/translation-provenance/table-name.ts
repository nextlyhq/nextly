/**
 * The name of the table that records where each translated value came from, and
 * the widths its MySQL columns are held to.
 *
 * @module schemas/translation-provenance/table-name
 */

export const TRANSLATION_PROVENANCE_TABLE = "nextly_translation_provenance";

/**
 * The longest plugin-defined person's kind a row keeps (`actor_principal_kind`, a varchar on
 * MySQL): the longest kind a plugin may name, which the principal registry holds every kind to.
 */
export const TRANSLATION_PROVENANCE_PRINCIPAL_KIND_LENGTH = 191;

/** A fingerprint's width (`value_fingerprint`, `source_fingerprint`, varchars on MySQL): a sha256 in hex. */
export const TRANSLATION_PROVENANCE_FINGERPRINT_LENGTH = 64;

/**
 * Kept as a row's source fingerprint when its value was copied from a source that is not the one
 * the source language holds: one that moved between the copy and the save, or a copy that did not
 * say which version of its source it read. Never a sha256 in hex, so the one comparison of a
 * source's fingerprint with a row's (`field-status`) always finds it different and reads the value
 * as out of date, until it is copied or translated again from the source as it is. Fits the
 * column: {@link TRANSLATION_PROVENANCE_FINGERPRINT_LENGTH}.
 */
export const SOURCE_FINGERPRINT_MOVED = "source-moved";

/** The longest field path a row keeps; a longer one is stored bounded, ending in a hash. */
export const TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH = 255;

/**
 * Between a field and a row id in the path of a row's own record (`<field>#<row id>`), for a field
 * with a structure per language: no field name holds it, so a row's record never reads as a field's.
 */
export const TRANSLATION_PROVENANCE_ROW_SEPARATOR = "#";
