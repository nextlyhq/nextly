/**
 * Schedule windows table - dialect-aware barrel.
 *
 * @module schemas/schedule-windows
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/** Returns the Drizzle table object for schedule windows. */
export function scheduleWindowsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are imported.
  const { nextlyScheduleWindows } = loadedDialect(dialect).tables;
  return { nextlyScheduleWindows };
}
