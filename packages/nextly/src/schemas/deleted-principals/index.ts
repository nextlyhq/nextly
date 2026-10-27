/**
 * The deleted-people table on each dialect.
 *
 * @module schemas/deleted-principals
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares it. See `./table-name`.
export { DELETED_PRINCIPALS_TABLE } from "./table-name";

export function deletedPrincipalsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyDeletedPrincipals } = loadedDialect(dialect).tables;
  return { nextlyDeletedPrincipals };
}
