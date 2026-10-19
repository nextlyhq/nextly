/**
 * Content event tables - dialect-aware barrel.
 *
 * Re-exports the per-dialect tables under canonical names; the runtime dialect
 * selects which tables a caller sees.
 *
 * @module schemas/content-events
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export * from "./types";

/** Returns the Drizzle table objects for the content event record. */
export function contentEventsTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return {
        nextlyContentEvents: pg.nextlyContentEventsPg,
        nextlyContentEventParts: pg.nextlyContentEventPartsPg,
      };
    case "mysql":
      return {
        nextlyContentEvents: my.nextlyContentEventsMysql,
        nextlyContentEventParts: my.nextlyContentEventPartsMysql,
      };
    case "sqlite":
      return {
        nextlyContentEvents: sl.nextlyContentEventsSqlite,
        nextlyContentEventParts: sl.nextlyContentEventPartsSqlite,
      };
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
