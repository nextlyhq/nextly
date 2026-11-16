/**
 * The notices table, per dialect.
 *
 * @module schemas/notices
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { NOTICES_TABLE } from "./table-name";

export function noticesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyNotices } = loadedDialect(dialect).tables;
  return { nextlyNotices };
}
