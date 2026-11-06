/**
 * API Keys table — dialect-aware barrel.
 *
 * Re-exports the per-dialect apiKeys Drizzle table. The runtime dialect
 * determines which table object a caller sees.
 *
 * Distinct from `schemas/_zod/api-keys.ts`, which holds the Zod validators
 * (CreateApiKeySchema, UpdateApiKeySchema, etc.) for the same domain.
 *
 * @module schemas/api-keys
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns the apiKeys Drizzle table for the requested dialect.
 */
export function apiKeyTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { apiKeys } = loadedDialect(dialect).tables;
  return { apiKeys };
}
