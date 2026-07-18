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

import { NextlyError } from "../../errors";

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
      // `never` gives a compile-time exhaustiveness guarantee for typed
      // callers; the throw handles an invalid dialect reaching here at runtime
      // from an untyped/JS caller (e.g. a string from config).
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: { dialect: String(_exhaustive) },
      });
    }
  }
}
