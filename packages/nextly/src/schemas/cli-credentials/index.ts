/**
 * `nextly_cli_credentials` — dialect-aware barrel.
 *
 * @module schemas/cli-credentials
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares it, so this barrel stays one of the
// readers rather than becoming a second author. See `./table-name`.
export { CLI_CREDENTIALS_TABLE } from "./table-name";

/** The CLI credentials table for the requested dialect, as a schema fragment. */
export function cliCredentialsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyCliCredentials } = loadedDialect(dialect).tables;
  return { nextlyCliCredentials };
}
