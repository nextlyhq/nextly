/**
 * The received-webhooks table for each dialect.
 *
 * @module schemas/received-webhooks
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { RECEIVED_WEBHOOKS_TABLE } from "./table-name";

/** The table, keyed as `getCoreSchema` spreads it. */
export function receivedWebhooksTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyReceivedWebhooks } = loadedDialect(dialect).tables;
  return { nextlyReceivedWebhooks };
}
