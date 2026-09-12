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

/**
 * The physical table name, spelled once.
 *
 * The counter is incremented by a statement the database evaluates itself, so
 * the name is written somewhere other than the declaration, and this is the
 * only place it may be read from.
 */
export const RBAC_EPOCH_TABLE = "nextly_rbac_epoch";

/**
 * The key of the single row.
 *
 * A constant rather than a parameter: the primary key is what makes a second
 * counter unrepresentable, and a caller free to choose the key could create
 * one whose bumps nothing else reads.
 */
export const RBAC_EPOCH_ROW_ID = "global";

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
