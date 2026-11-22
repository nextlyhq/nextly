/**
 * What the refusal of a uniqueness whose index name another object holds tells the reader to do.
 *
 * Its own module, importing nothing, because two places read it: the one-to-one uniqueness step
 * that writes the refusal, and the CLI's error table that splits the refusal back into its parts.
 * The step's module loads the schema pipeline; reading the wording from it would load that
 * pipeline into every command that loads the error table.
 *
 * @module domains/schema/migrate/unique-index-name-advice
 */
export const UNIQUE_INDEX_NAME_HELD_ADVICE =
  "Rename or drop what holds the name, then run `nextly migrate` again.";
