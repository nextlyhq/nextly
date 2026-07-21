import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export { getI18nArchiveDdl, getI18nArchiveIndexRepairDdl } from "./ddl";

/** Returns the `nextly_i18n_archive` table binding for the given dialect. */
export function nextlyI18nArchiveTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyI18nArchive: pg.nextlyI18nArchive };
    case "mysql":
      return { nextlyI18nArchive: my.nextlyI18nArchive };
    case "sqlite":
      return { nextlyI18nArchive: sl.nextlyI18nArchive };
    default: {
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
