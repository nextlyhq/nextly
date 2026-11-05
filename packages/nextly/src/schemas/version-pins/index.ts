/**
 * Version pin table - dialect-aware barrel.
 *
 * Re-exports the per-dialect table under one canonical name; the runtime
 * dialect selects which table a caller sees.
 *
 * @module schemas/version-pins
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/** Returns the Drizzle table object for version pins. */
export function versionPinsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyVersionPins } = loadedDialect(dialect).tables;
  return { nextlyVersionPins };
}
