/**
 * The values `nextly_translation_suggestions` holds in its closed columns.
 *
 * @module schemas/translation-suggestions/types
 */

/** Where a suggested text came from. A person's own text is never a suggestion. */
export type SuggestionOrigin = "machine" | "import" | "agent";

/**
 * A suggested value as it is stored, wrapped in an object: a JSON `null` and a plain string are
 * values a suggestion may hold, which a column holding the value itself could not tell from no
 * value, or from JSON text, on every database.
 */
export interface StoredSuggestionValue {
  value: unknown;
}
