/**
 * `nextly_limit_store` — dialect-aware barrel.
 *
 * @module schemas/limit-store
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

// Re-exported from the leaf that declares them, so this barrel stays one of
// the readers rather than becoming a second author. See `./table-name`.
export { LIMIT_STORE_TABLE, LIMIT_STORE_COUNTER_PREFIX } from "./table-name";

/**
 * The one place a dialect is turned into the limit store's table. The `never`
 * assignment makes the compiler demand a case for a dialect added later,
 * rather than handing back another dialect's table.
 */
function limitStoreForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlyLimitStore;
    case "mysql":
      return my.nextlyLimitStore;
    case "sqlite":
      return sl.nextlyLimitStore;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no limit store table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

/** The limit store's table for the requested dialect, as a schema fragment. */
export function limitStoreTables(dialect: SupportedDialect) {
  return { nextlyLimitStore: limitStoreForDialect(dialect) };
}
