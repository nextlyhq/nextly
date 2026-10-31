/**
 * The media usage table, per dialect.
 *
 * @module schemas/media-usage
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export function mediaUsageTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyMediaUsage } = loadedDialect(dialect).tables;
  return { nextlyMediaUsage };
}
