/**
 * `nextly_rbac_epoch` — dialect-aware barrel.
 *
 * @module schemas/rbac-epoch
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

// Re-exported from the leaf that declares them, so this barrel stays one of the
// readers rather than becoming a second author. See `./table-name`.
export { RBAC_EPOCH_TABLE, RBAC_EPOCH_ROW_ID } from "./table-name";

/**
 * The ONE place a dialect is turned into an epoch table.
 *
 * A ternary chain ending in a bare `else` would assign every future dialect to
 * whichever branch came last, so adding one would compile and hand back another
 * dialect's table. The `never` assignment makes the compiler demand a case.
 */
function epochForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlyRbacEpoch;
    case "mysql":
      return my.nextlyRbacEpoch;
    case "sqlite":
      return sl.nextlyRbacEpoch;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no rbac epoch table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

/** The epoch table for the requested dialect, as a schema fragment. */
export function rbacEpochTables(dialect: SupportedDialect) {
  return { nextlyRbacEpoch: epochForDialect(dialect) };
}
