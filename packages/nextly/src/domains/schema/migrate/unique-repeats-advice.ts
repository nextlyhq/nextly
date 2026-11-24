/**
 * What the refusal of a uniqueness whose column holds repeats tells the reader to do.
 *
 * Its own module, importing nothing, because two places read it: the guard that writes the refusal
 * (`unique-column-guard`), and the CLI's error table that splits the refusal back into its parts. The guard's module loads the schema pipeline; reading the wording from it
 * would load that pipeline into every command that loads the error table.
 *
 * @module domains/schema/migrate/unique-repeats-advice
 */

/** What each column's line in the repeats refusal tells the reader to do. */
export const UNIQUE_REPEATS_ADVICE =
  "Give each entry its own value, or clear the repeats, then run `nextly migrate` again.";
