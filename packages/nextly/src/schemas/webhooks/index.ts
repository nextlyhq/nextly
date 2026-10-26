/**
 * Webhook + event system tables — dialect-aware barrel.
 *
 * Re-exports the per-dialect `nextly_events`, `nextly_webhooks`, and
 * `nextly_webhook_deliveries` Drizzle tables. The runtime dialect determines
 * which table objects a caller sees.
 *
 * @module schemas/webhooks
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns the webhook + event Drizzle tables for the requested dialect.
 */
export function webhookTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyEvents, nextlyWebhookDeliveries, nextlyWebhooks } =
    loadedDialect(dialect).tables;
  return { nextlyEvents, nextlyWebhookDeliveries, nextlyWebhooks };
}
