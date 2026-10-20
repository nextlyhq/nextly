/**
 * The email brand settings table, per dialect.
 *
 * @module schemas/email-brand
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export { EMAIL_BRAND_ROW_ID, EMAIL_BRAND_TABLE } from "./table-name";

export function emailBrandTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyEmailBrand: pg.nextlyEmailBrandPg };
    case "mysql":
      return { nextlyEmailBrand: my.nextlyEmailBrandMysql };
    case "sqlite":
      return { nextlyEmailBrand: sl.nextlyEmailBrandSqlite };
    default: {
      const _exhaustive: never = dialect;
      // Unreachable given the SupportedDialect union; the `never` assignment
      // is the compile-time exhaustiveness guard.
      throw NextlyError.internal({
        logContext: { dialect: String(_exhaustive) },
      });
    }
  }
}
