/**
 * Review states table - dialect-aware barrel.
 *
 * @module schemas/review-states
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/** The table's name, the same on every dialect. */
export const REVIEW_STATES_TABLE = "nextly_review_states";

/** Returns the Drizzle table object for review states. */
export function reviewStatesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are imported.
  const { nextlyReviewStates } = loadedDialect(dialect).tables;
  return { nextlyReviewStates };
}
