/**
 * The notices table, per dialect.
 *
 * @module schemas/notices
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export { NOTICES_TABLE } from "./table-name";

export function noticesTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyNotices: pg.nextlyNoticesPg };
    case "mysql":
      return { nextlyNotices: my.nextlyNoticesMysql };
    case "sqlite":
      return { nextlyNotices: sl.nextlyNoticesSqlite };
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
