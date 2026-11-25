/**
 * What a row of `nextly_translation_sources` keeps.
 *
 * @module schemas/translation-sources/types
 */

/**
 * A source value as it was, wrapped in an object: a value that was empty (`null`, or an empty
 * string) is kept as one, which a column holding the value itself could not tell from no value
 * at all on every database.
 */
export interface KeptSource {
  value: unknown;
}
