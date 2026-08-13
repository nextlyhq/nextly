/**
 * `nextly_field_group_lock` — dialect-aware barrel.
 *
 * @module schemas/field-group-lock
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/** The lock table for the requested dialect. */
export function fieldGroupLockTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyFieldGroupLock: pg.nextlyFieldGroupLock };
    case "mysql":
      return { nextlyFieldGroupLock: my.nextlyFieldGroupLock };
    case "sqlite":
      return { nextlyFieldGroupLock: sl.nextlyFieldGroupLock };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time, so reaching
      // here at runtime means a dialect was added without a table for it. `internal` because that
      // is a programming mistake rather than a state an operator can be in or fix.
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no field-group lock table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}
