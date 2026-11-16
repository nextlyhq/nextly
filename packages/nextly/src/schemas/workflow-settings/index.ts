/**
 * Workflow settings table - dialect-aware barrel.
 *
 * @module schemas/workflow-settings
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/** The table's name, the same on every dialect. */
export const WORKFLOW_SETTINGS_TABLE = "nextly_workflow_settings";

/** Returns the Drizzle table object for workflow settings. */
export function workflowSettingsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are imported.
  const { nextlyWorkflowSettings } = loadedDialect(dialect).tables;
  return { nextlyWorkflowSettings };
}
