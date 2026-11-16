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

/** The longest field path a row keeps; a longer one is stored bounded, ending in a hash. */
export const TRANSLATION_PROVENANCE_FIELD_PATH_LENGTH = 255;

/**
 * Between a field and a row id in the path of a row's own record (`<field>#<row id>`), for a field
 * with a structure per language: no field name holds it, so a row's record never reads as a field's.
 */
export const TRANSLATION_PROVENANCE_ROW_SEPARATOR = "#";
