/**
 * The name of the table that records where each translated value came from, and
 * the widths its MySQL columns are held to.
 *
 * @module schemas/translation-provenance/table-name
 */

export const TRANSLATION_PROVENANCE_TABLE = "nextly_translation_provenance";

/** The longest field path a row keeps; a longer one is stored bounded, ending in a hash. */
export const TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH = 255;
