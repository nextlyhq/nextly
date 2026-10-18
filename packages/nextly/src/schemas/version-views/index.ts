/**
 * Version view markers table - dialect-aware barrel.
 *
 * Re-exports the per-dialect table under one canonical name; the runtime
 * dialect selects which table a caller sees.
 *
 * @module schemas/version-views
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/** The table's name, the same on every dialect. */
export const VERSION_VIEWS_TABLE = "nextly_version_views";

/** Returns the Drizzle table object for version view markers. */
export function versionViewsTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyVersionViews: pg.nextlyVersionViewsPg };
    case "mysql":
      return { nextlyVersionViews: my.nextlyVersionViewsMysql };
    case "sqlite":
      return { nextlyVersionViews: sl.nextlyVersionViewsSqlite };
    default: {
      const _exhaustive: never = dialect;
      // Unreachable given the SupportedDialect union; the `never` assignment is
      // the compile-time exhaustiveness guard.
      throw NextlyError.internal({
        logContext: { dialect: String(_exhaustive) },
      });
    }
  }
}
