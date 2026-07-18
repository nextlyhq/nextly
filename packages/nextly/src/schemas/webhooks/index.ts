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

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns the webhook + event Drizzle tables for the requested dialect.
 */
export function webhookTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return {
        nextlyEvents: pg.nextlyEvents,
        nextlyWebhooks: pg.nextlyWebhooks,
        nextlyWebhookDeliveries: pg.nextlyWebhookDeliveries,
      };
    case "mysql":
      return {
        nextlyEvents: my.nextlyEvents,
        nextlyWebhooks: my.nextlyWebhooks,
        nextlyWebhookDeliveries: my.nextlyWebhookDeliveries,
      };
    case "sqlite":
      return {
        nextlyEvents: sl.nextlyEvents,
        nextlyWebhooks: sl.nextlyWebhooks,
        nextlyWebhookDeliveries: sl.nextlyWebhookDeliveries,
      };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
