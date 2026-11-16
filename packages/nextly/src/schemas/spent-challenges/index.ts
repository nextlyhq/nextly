/**
 * `nextly_spent_challenges` — dialect-aware barrel.
 *
 * @module schemas/spent-challenges
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares it, so this barrel stays one of
// the readers rather than becoming a second author. See `./table-name`.
export { SPENT_CHALLENGES_TABLE } from "./table-name";

/** The spent challenges' table for the requested dialect, as a schema fragment. */
export function spentChallengesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlySpentChallenges } = loadedDialect(dialect).tables;
  return { nextlySpentChallenges };
}
