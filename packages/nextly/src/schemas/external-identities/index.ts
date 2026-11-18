/**
 * The external identities' table, per dialect.
 *
 * @module schemas/external-identities
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares it, so this barrel stays one of
// the readers rather than becoming a second author. See `./table-name`.
export { EXTERNAL_IDENTITIES_TABLE } from "./table-name";

/** The external identities' table for the requested dialect, as a schema fragment. */
export function externalIdentitiesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyExternalIdentities } = loadedDialect(dialect).tables;
  return { nextlyExternalIdentities };
}
