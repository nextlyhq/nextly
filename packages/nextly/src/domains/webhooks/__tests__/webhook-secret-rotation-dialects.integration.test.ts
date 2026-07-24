/**
 * Signing-secret rotation against a real Postgres/MySQL database.
 *
 * The endpoint-service integration suite exercises rotation on in-memory SQLite
 * only, so the `SELECT … FOR UPDATE` re-read and the `secret_hash` JSON write in
 * `rotateSecret`/`expireOldSecrets` were never run on the pooled Postgres/MySQL
 * drivers, whose transaction + JSON handling differs. This leg closes that gap.
 *
 * The webhook system tables are provisioned from the production table definitions
 * via drizzle-kit (never hand-copied DDL), dropped-then-recreated so a shared
 * test database starts clean for this file.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
} from "../../../database/drizzle-kit-lazy";
import { createAdapter } from "../../../database/factory";
import { SchemaRegistry } from "../../../database/schema-registry";
import {
  nextlyEvents as eventsMysql,
  nextlyWebhooks as webhooksMysql,
  nextlyWebhookDeliveries as deliveriesMysql,
} from "../../../schemas/webhooks/mysql";
import {
  nextlyEvents as eventsPg,
  nextlyWebhooks as webhooksPg,
  nextlyWebhookDeliveries as deliveriesPg,
} from "../../../schemas/webhooks/postgres";
import { users as usersMysql } from "../../../schemas/users/mysql";
import { users as usersPg } from "../../../schemas/users/postgres";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { WebhookEndpointService } from "../services/webhook-endpoint-service";
import type { WebhookEventType } from "../types";

type Dialect = "postgresql" | "mysql";

interface Leg {
  name: string;
  dialect: Dialect;
  url: string;
  schemas: Record<string, unknown>;
  kit: () => Promise<{
    generateDrizzleJson: (s: Record<string, unknown>) => Promise<unknown>;
    generateMigration: (a: unknown, b: unknown) => Promise<string[]>;
  }>;
}

const LEGS: Leg[] = [
  {
    name: "postgres",
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? "",
    schemas: {
      users: usersPg,
      nextlyEvents: eventsPg,
      nextlyWebhooks: webhooksPg,
      nextlyWebhookDeliveries: deliveriesPg,
    },
    kit: getPgDrizzleKit as never,
  },
  {
    name: "mysql",
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? "",
    schemas: {
      users: usersMysql,
      nextlyEvents: eventsMysql,
      nextlyWebhooks: webhooksMysql,
      nextlyWebhookDeliveries: deliveriesMysql,
    },
    kit: getMySQLDrizzleKit as never,
  },
];

const EVENTS: WebhookEventType[] = ["entry.created", "entry.updated"];
// An address literal, not a hostname, so the URL validator never hits DNS.
const PUBLIC_URL = "https://93.184.216.34/hooks";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// Child-first so foreign keys never block a drop; `users` is referenced by
// `nextly_webhooks.created_by`.
const TABLES = [
  "nextly_webhook_deliveries",
  "nextly_webhooks",
  "nextly_events",
  "users",
];

for (const leg of LEGS) {
  const describeLeg = describe.skipIf(!leg.url);

  describeLeg(`webhook secret rotation (${leg.name})`, () => {
    let adapter: Awaited<ReturnType<typeof createAdapter>>;
    let service: WebhookEndpointService;

    beforeAll(async () => {
      if (!leg.url) return;
      process.env.DB_DIALECT = leg.dialect;
      process.env.DATABASE_URL = leg.url;
      process.env.NEXTLY_SECRET = "integration-test-application-secret";

      adapter = await createAdapter({
        type: leg.dialect,
        url: leg.url,
      } as Parameters<typeof createAdapter>[0]);

      const isMysql = leg.dialect === "mysql";
      const quote = (t: string) => (isMysql ? `\`${t}\`` : `"${t}"`);

      // Drop existing tables so the shared DB starts clean. MySQL cannot express
      // a cross-table CASCADE on DROP, so foreign-key checks are disabled around
      // the drops instead.
      if (isMysql) {
        await adapter.executeQuery("SET FOREIGN_KEY_CHECKS = 0");
      }
      for (const table of TABLES) {
        await adapter.executeQuery(
          `DROP TABLE IF EXISTS ${quote(table)}${isMysql ? "" : " CASCADE"}`
        );
      }
      if (isMysql) {
        await adapter.executeQuery("SET FOREIGN_KEY_CHECKS = 1");
      }

      const kit = await leg.kit();
      const statements = await kit.generateMigration(
        await kit.generateDrizzleJson({}),
        await kit.generateDrizzleJson(leg.schemas)
      );
      for (const stmt of splitStatements(statements)) {
        await adapter.executeQuery(stmt);
      }

      const registry = new SchemaRegistry(leg.dialect);
      registry.registerStaticSchemas(leg.schemas as never);
      adapter.setTableResolver(registry as never);

      service = new WebhookEndpointService(adapter as never, logger as never);
    });

    afterAll(async () => {
      await adapter?.disconnect?.();
    });

    // `created_by` is left null so the test needs no seeded user row.
    const create = (name: string) =>
      service.createEndpoint(
        { name, url: PUBLIC_URL, eventTypes: EVENTS } as never,
        null
      );

    it("rotates with an overlap window and keeps both secrets live", async () => {
      const { endpoint, secret: original } = await create("Rotate A");

      const { endpoint: rotated, secret: fresh } = await service.rotateSecret(
        endpoint.id,
        { overlapSeconds: 3600 }
      );

      expect(fresh).not.toBe(original);
      expect(rotated.secretPrefix).toBe(fresh.slice(0, 14));

      const revealed = await service.revealSecrets(endpoint.id);
      expect(revealed).toHaveLength(2);
      expect(revealed).toContain(fresh);
      expect(revealed).toContain(original);
    });

    it("expires the overlapping secret, leaving only the primary", async () => {
      const { endpoint } = await create("Rotate B");
      const { secret: fresh } = await service.rotateSecret(endpoint.id, {
        overlapSeconds: 3600,
      });
      expect(await service.revealSecrets(endpoint.id)).toHaveLength(2);

      await service.expireOldSecrets(endpoint.id);
      expect(await service.revealSecrets(endpoint.id)).toEqual([fresh]);
    });
  });
}
