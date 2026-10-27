/**
 * The site's stored content languages, per dialect.
 *
 * @module schemas/languages
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export * from "./table-name";
export * from "./types";

export function languagesTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyLanguages: pg.nextlyLanguagesPg };
    case "mysql":
      return { nextlyLanguages: my.nextlyLanguagesMysql };
    case "sqlite":
      return { nextlyLanguages: sl.nextlyLanguagesSqlite };
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
