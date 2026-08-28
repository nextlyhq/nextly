/**
 * Job tables - dialect-aware barrel.
 *
 * Re-exports the per-dialect job table under a canonical name; the runtime
 * dialect selects which table a caller sees.
 *
 * @module schemas/jobs
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export { JOB_STATES, type JobState } from "./types";

/** Returns the Drizzle table objects for the jobs feature group. */
export function jobsTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyJobs: pg.nextlyJobsPg };
    case "mysql":
      return { nextlyJobs: my.nextlyJobsMysql };
    case "sqlite":
      return { nextlyJobs: sl.nextlyJobsSqlite };
    default: {
      const _exhaustive: never = dialect;
      // NextlyError (not bare Error) per the packages/nextly convention. This
      // branch is unreachable given the SupportedDialect union; the `never`
      // assignment is the compile-time exhaustiveness guard.
      throw NextlyError.internal({
        logContext: { dialect: String(_exhaustive) },
      });
    }
  }
}
