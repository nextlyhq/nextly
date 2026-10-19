/**
 * Version pin table - dialect-aware barrel.
 *
 * Re-exports the per-dialect table under one canonical name; the runtime
 * dialect selects which table a caller sees.
 *
 * @module schemas/version-pins
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/** Returns the Drizzle table object for version pins. */
export function versionPinsTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyVersionPins: pg.nextlyVersionPinsPg };
    case "mysql":
      return { nextlyVersionPins: my.nextlyVersionPinsMysql };
    case "sqlite":
      return { nextlyVersionPins: sl.nextlyVersionPinsSqlite };
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
