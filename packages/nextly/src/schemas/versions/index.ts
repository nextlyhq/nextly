/**
 * Versions table - dialect-aware barrel.
 *
 * Re-exports the per-dialect `nextly_versions` Drizzle table under a canonical
 * name; the runtime dialect selects which table a caller sees.
 *
 * @module schemas/versions
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/** Returns the Drizzle table object for the versions feature group. */
export function versionsTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyVersions: pg.nextlyVersionsPg };
    case "mysql":
      return { nextlyVersions: my.nextlyVersionsMysql };
    case "sqlite":
      return { nextlyVersions: sl.nextlyVersionsSqlite };
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
