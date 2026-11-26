/**
 * The name of the table that keeps the translations suggested for each text,
 * and the widths its MySQL columns are held to.
 *
 * @module schemas/translation-suggestions/table-name
 */

export const TRANSLATION_SUGGESTIONS_TABLE = "nextly_translation_suggestions";

/**
 * The longest plugin-defined person's kind a row keeps (`created_by_principal_kind`, a varchar on
 * MySQL): the longest kind a plugin may name, which the principal registry holds every kind to.
 */
export const TRANSLATION_SUGGESTIONS_PRINCIPAL_KIND_LENGTH = 191;

/** A unit key's width (`unit_key`, a varchar on MySQL): a sha256 in hex. */
export const TRANSLATION_SUGGESTIONS_UNIT_KEY_LENGTH = 64;
