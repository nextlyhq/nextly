/**
 * `nextly_schema_owners` — dialect-aware barrel.
 *
 * @module schemas/schema-owners
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

// Re-exported from the leaf that declares it, so this barrel stays one of the
// readers rather than becoming a second author.
export { SCHEMA_OWNERS_TABLE } from "./table-name";

/**
 * The ONE place a dialect is turned into an owners table.
 *
 * A ternary chain ending in a bare `else` would assign every future dialect to
 * whichever branch came last, so adding one would compile and hand back
 * another dialect's table. The `never` assignment makes the compiler demand a
 * case.
 */
function ownersForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlySchemaOwners;
    case "mysql":
      return my.nextlySchemaOwners;
    case "sqlite":
      return sl.nextlySchemaOwners;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no schema owners table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

/** The owners table for the requested dialect, as a schema fragment. */
export function schemaOwnersTables(dialect: SupportedDialect) {
  return { nextlySchemaOwners: ownersForDialect(dialect) };
}
