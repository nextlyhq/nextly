/**
 * The dashboard preferences table, per dialect.
 *
 * @module schemas/dashboard-preferences
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export function dashboardPreferencesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyDashboardPreferences } = loadedDialect(dialect).tables;
  return { nextlyDashboardPreferences };
}
