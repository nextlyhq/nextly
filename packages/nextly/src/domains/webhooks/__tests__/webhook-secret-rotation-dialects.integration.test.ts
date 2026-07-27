/**
 * Signing-secret rotation against a real Postgres/MySQL database.
 *
 * The endpoint-service integration suite exercises rotation on in-memory SQLite
 * only, so the `SELECT … FOR UPDATE` re-read and the `secret_ciphertext` JSON write in
 * `rotateSecret`/`expireOldSecrets` were never run on the pooled Postgres/MySQL
 * drivers, whose transaction + JSON handling differs. This leg closes that gap.
 *
 * Isolation: each dialect leg provisions the webhook system tables into a
 * throwaway namespace it creates and drops itself — a dedicated SCHEMA on
 * Postgres, a dedicated DATABASE on MySQL — instead of dropping and recreating
 * production-named tables in the shared test database. So the suite never
 * cascades through a shared `users` table (which would strip foreign keys other
 * single-fork suites rely on), needs no `FOREIGN_KEY_CHECKS` toggling, and is
 * safe against a misconfigured URL because it only ever drops the namespace it
 * just created. The namespace name is random per run and the connection URL
 * pins every pooled connection to it (Postgres `search_path` startup option;
 * MySQL database in the URL path), so DDL and DML land in the throwaway
 * namespace no matter which pooled connection serves the query.
 */
import { randomBytes } from "node:crypto";

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

// Seed the process environment at module load, before any import can read the
// lazily-cached `env` proxy. `??=` never clobbers a value the environment
// already provides, and neither is ever mutated per dialect leg, so a leg can
// never poison the cached env for a later one.
//   - NEXTLY_SECRET: webhook signing secrets are encrypted under it, so
//     `createEndpoint` throws without it.
//   - DATABASE_URL: `createAdapter` reads validated env for pool defaults, and
//     that validation requires a DATABASE_URL for any non-sqlite dialect. Each
//     adapter here connects with its own explicit per-namespace URL, so this
//     only has to be a syntactically valid placeholder for validation to pass.
process.env.NEXTLY_SECRET ??= "integration-test-application-secret";
process.env.DATABASE_URL ??=
  process.env.TEST_POSTGRES_URL ??
  process.env.TEST_MYSQL_URL ??
  "postgres://placeholder:placeholder@localhost:5432/placeholder";

type Dialect = "postgresql" | "mysql";

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

interface Namespace {
  /** Connection URL pinned to the throwaway namespace for every connection. */
  scopedUrl: string;
  /** Drops the throwaway namespace and closes the admin connection. */
  drop: () => Promise<void>;
}

interface Leg {
  name: string;
  dialect: Dialect;
  url: string;
  schemas: Record<string, unknown>;
  kit: () => Promise<{
    generateDrizzleJson: (s: Record<string, unknown>) => Promise<unknown>;
    generateMigration: (a: unknown, b: unknown) => Promise<string[]>;
  }>;
  isolate: (baseUrl: string) => Promise<Namespace>;
}

const makeAdapter = (dialect: Dialect, url: string): Promise<Adapter> =>
  createAdapter({ type: dialect, url } as Parameters<typeof createAdapter>[0]);

// A random, prefixed identifier is safe to interpolate directly (hex only), so
// no external input ever reaches these DDL strings.
const namespaceName = () => `test_wh_${randomBytes(8).toString("hex")}`;

// Postgres: a dedicated schema whose name is pushed onto every connection's
// `search_path` via the URL's `options` startup parameter. The space in
// `-c search_path=…` must be percent-encoded as %20 — URLSearchParams would
// emit `+`, which libpq passes through literally and would not set the path.
async function isolatePostgres(baseUrl: string): Promise<Namespace> {
  const schema = namespaceName();
  const admin = await makeAdapter("postgresql", baseUrl);
  await admin.executeQuery(`CREATE SCHEMA "${schema}"`);
  const sep = baseUrl.includes("?") ? "&" : "?";
  const scopedUrl = `${baseUrl}${sep}options=${encodeURIComponent(
    `-c search_path=${schema}`
  )}`;
  return {
    scopedUrl,
    async drop() {
      await admin.executeQuery(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.disconnect?.();
    },
  };
}

// MySQL: a dedicated database selected by the URL path, so every pooled
// connection runs against it. Dropping the whole database is cheaper and safer
// than per-table drops and never needs foreign-key checks disabled.
async function isolateMysql(baseUrl: string): Promise<Namespace> {
  const db = namespaceName();
  const admin = await makeAdapter("mysql", baseUrl);
  await admin.executeQuery(`CREATE DATABASE \`${db}\``);
  const scopedUrl = new URL(baseUrl);
  scopedUrl.pathname = `/${db}`;
  return {
    scopedUrl: scopedUrl.toString(),
    async drop() {
      await admin.executeQuery(`DROP DATABASE \`${db}\``);
      await admin.disconnect?.();
    },
  };
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
    isolate: isolatePostgres,
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
    isolate: isolateMysql,
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

for (const leg of LEGS) {
  const describeLeg = describe.skipIf(!leg.url);

  describeLeg(`webhook secret rotation (${leg.name})`, () => {
    let adapter: Adapter;
    let namespace: Namespace;
    let service: WebhookEndpointService;

    beforeAll(async () => {
      if (!leg.url) return;

      // Provision into a throwaway namespace this leg owns, so nothing in the
      // shared test database is dropped or cascaded.
      namespace = await leg.isolate(leg.url);
      adapter = await makeAdapter(leg.dialect, namespace.scopedUrl);

      // The webhook system tables come from the production table definitions via
      // drizzle-kit (never hand-copied DDL). Generated unqualified, they land in
      // the namespace the connection is pinned to.
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
      // Close the pooled connections before dropping the namespace they used.
      await adapter?.disconnect?.();
      await namespace?.drop();
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
