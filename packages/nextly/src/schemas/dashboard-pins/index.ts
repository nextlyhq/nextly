/**
 * The dashboard pins table, per dialect.
 *
 * @module schemas/dashboard-pins
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export function dashboardPinsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyDashboardPins } = loadedDialect(dialect).tables;
  return { nextlyDashboardPins };
}
