/**
 * Content event tables - dialect-aware barrel.
 *
 * Re-exports the per-dialect tables under canonical names; the runtime dialect
 * selects which tables a caller sees.
 *
 * @module schemas/content-events
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export * from "./types";

/** Returns the Drizzle table objects for the content event record. */
export function contentEventsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyContentEvents, nextlyContentEventParts } =
    loadedDialect(dialect).tables;
  return { nextlyContentEvents, nextlyContentEventParts };
}
