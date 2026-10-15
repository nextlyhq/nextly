/**
 * The deleted-people table on each dialect.
 *
 * @module schemas/deleted-principals
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
// Re-exported from the leaf that declares it. See `./table-name`.
export { DELETED_PRINCIPALS_TABLE } from "./table-name";

function deletedPrincipalsForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlyDeletedPrincipals;
    case "mysql":
      return my.nextlyDeletedPrincipals;
    case "sqlite":
      return sl.nextlyDeletedPrincipals;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no deleted-principals table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

export function deletedPrincipalsTables(dialect: SupportedDialect) {
  return { nextlyDeletedPrincipals: deletedPrincipalsForDialect(dialect) };
}
