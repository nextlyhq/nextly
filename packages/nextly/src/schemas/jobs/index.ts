/**
 * Job tables - dialect-aware barrel.
 *
 * Re-exports the per-dialect job table under a canonical name; the runtime
 * dialect selects which table a caller sees.
 *
 * @module schemas/jobs
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { JOB_STATES, type JobState } from "./types";

/** Returns the Drizzle table objects for the jobs feature group. */
export function jobsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyJobs } = loadedDialect(dialect).tables;
  return { nextlyJobs };
}
