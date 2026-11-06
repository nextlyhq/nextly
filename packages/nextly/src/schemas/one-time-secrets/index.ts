/**
 * The one-time secrets table for each dialect.
 *
 * @module schemas/one-time-secrets
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { ONE_TIME_SECRETS_TABLE } from "./table-name";

/** The table, keyed as `getCoreSchema` spreads it. */
export function oneTimeSecretsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyOneTimeSecrets } = loadedDialect(dialect).tables;
  return { nextlyOneTimeSecrets };
}
