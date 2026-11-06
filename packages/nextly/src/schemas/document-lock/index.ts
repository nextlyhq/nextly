/**
 * `nextly_document_lock` — dialect-aware barrel.
 *
 * @module schemas/document-lock
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * The physical table name, spelled once.
 *
 * The repository addresses this table through raw statements rather than the
 * typed query builder, because liveness has to be decided by SQL the database
 * evaluates itself. That means the name is written somewhere other than the
 * declaration, and this is the only place it may be read from.
 */
export const DOCUMENT_LOCK_TABLE = "nextly_document_lock";

/** The lock table for the requested dialect, as a schema fragment. */
export function documentLockTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyDocumentLock } = loadedDialect(dialect).tables;
  return { nextlyDocumentLock };
}
