/**
 * `nextly_document_lock` — dialect-aware barrel.
 *
 * @module schemas/document-lock
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
 * The repository addresses this table through raw statements rather than the
 * typed query builder, because liveness has to be decided by SQL the database
 * evaluates itself. That means the name is written somewhere other than the
 * declaration, and this is the only place it may be read from.
 */
export const DOCUMENT_LOCK_TABLE = "nextly_document_lock";

/**
 * The ONE place a dialect is turned into a lock table.
 *
 * 🔴 A ternary chain ending in a bare `else` would silently assign every future
 * dialect to whichever branch came last, so adding one to `SupportedDialect`
 * would compile and hand back another dialect's table. The `never` assignment
 * below makes the compiler demand a case instead.
 */
function lockForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlyDocumentLock;
    case "mysql":
      return my.nextlyDocumentLock;
    case "sqlite":
      return sl.nextlyDocumentLock;
    default: {
      // Exhaustiveness check — TypeScript flags a missing dialect at compile
      // time, so reaching here means a dialect was added without a table for
      // it. `internal` because that is a programming mistake rather than a
      // state an operator can be in or fix.
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no document lock table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

/** The lock table for the requested dialect, as a schema fragment. */
export function documentLockTables(dialect: SupportedDialect) {
  return { nextlyDocumentLock: lockForDialect(dialect) };
}
