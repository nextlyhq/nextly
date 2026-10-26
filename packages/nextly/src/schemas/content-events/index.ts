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

// The dialect files' namespaces, for types only: the repository names each
// dialect's table type through them, and a value export would import every
// dialect's tables.
export type * as my from "./mysql";
export type * as pg from "./postgres";
export type * as sl from "./sqlite";

/** Returns the Drizzle table objects for the content event record. */
export function contentEventsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyContentEventParts, nextlyContentEvents } =
    loadedDialect(dialect).tables;
  return { nextlyContentEventParts, nextlyContentEvents };
}
