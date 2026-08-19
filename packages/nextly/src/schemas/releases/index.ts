/**
 * Release tables - dialect-aware barrel.
 *
 * Re-exports the per-dialect release tables under canonical names; the runtime
 * dialect selects which tables a caller sees.
 *
 * @module schemas/releases
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/** Returns the Drizzle table objects for the releases feature group. */
export function releasesTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return {
        nextlyReleases: pg.nextlyReleasesPg,
        nextlyReleaseMembers: pg.nextlyReleaseMembersPg,
      };
    case "mysql":
      return {
        nextlyReleases: my.nextlyReleasesMysql,
        nextlyReleaseMembers: my.nextlyReleaseMembersMysql,
      };
    case "sqlite":
      return {
        nextlyReleases: sl.nextlyReleasesSqlite,
        nextlyReleaseMembers: sl.nextlyReleaseMembersSqlite,
      };
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
