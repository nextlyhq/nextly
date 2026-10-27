import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
  getI18nArchiveKindUpgradeDdl,
  UNATTRIBUTED_ARCHIVE_KINDS,
  UNKNOWN_ARCHIVE_KIND,
  UNRESOLVED_ARCHIVE_KIND,
} from "./ddl";

/** Returns the `nextly_i18n_archive` table binding for the given dialect. */
export function nextlyI18nArchiveTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyI18nArchive } = loadedDialect(dialect).tables;
  return { nextlyI18nArchive };
}
