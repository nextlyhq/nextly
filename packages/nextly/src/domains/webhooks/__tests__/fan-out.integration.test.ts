/**
 * Integration test for webhook fan-out (`fanOutDueEvents`) against a real
 * SQLite database. Exercises the full events -> delivery-rows path: matching,
 * per-endpoint delivery inserts, the fanned_out_at marker, and idempotency
 * (marker-based and read-filter dedup).
 *
 * Uses an in-memory SQLite database built from the production table definitions
 * via drizzle-kit (never hand-copied CREATE TABLE; see
 * .claude/rules/integration-tests.md).
 */

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import {
  nextlyEvents,
  nextlyWebhooks,
  nextlyWebhookDeliveries,
} from "../../../schemas/webhooks/sqlite";
import { users } from "../../../schemas/users/sqlite";
import { buildEnvelope } from "../envelope";
import { recordEvent } from "../record-event";
import { WebhookEndpointRegistry } from "../endpoint-registry";
import { fanOutDueEvents } from "../fan-out";
import type { WebhookEventType } from "../types";

process.env.DB_DIALECT = "sqlite";

const tables = { nextlyEvents, nextlyWebhooks, nextlyWebhookDeliveries };
// nextly_webhooks.created_by references users, so the FK target table must
// exist for SQLite's foreign-key enforcement on webhook writes.
const ddlTables = { ...tables, users };

async function schemaDdl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson(ddlTables)
  );
  return splitStatements(statements);
}

describe("webhook fan-out (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    for (const stmt of await schemaDdl()) await adapter.executeQuery(stmt);

    const schemaRegistry = new SchemaRegistry();
    schemaRegistry.registerStaticSchemas(tables);
    adapter.setTableResolver(schemaRegistry);
  });

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown errors
    }
  });

  beforeEach(async () => {
    await adapter.executeQuery("DELETE FROM nextly_webhook_deliveries");
    await adapter.executeQuery("DELETE FROM nextly_webhooks");
    await adapter.executeQuery("DELETE FROM nextly_events");
  });

  async function seedWebhook(
    id: string,
    eventTypes: WebhookEventType[] = ["entry.updated"]
  ): Promise<void> {
    const now = new Date();
    await adapter.insert("nextly_webhooks", {
      id,
      name: id,
      url: `https://example.com/${id}`,
      enabled: true,
      event_types: eventTypes,
      filter: null,
      headers: null,
      secret_hash: [],
      secret_prefix: "",
      field_allowlist: null,
      created_by: null,
      // Well before the seeded event time so the pre-subscription guard admits it.
      created_at: new Date("2020-01-01T00:00:00.000Z"),
      updated_at: now,
    });
  }

  async function seedEvent(
    id: string,
    type: WebhookEventType = "entry.updated"
  ): Promise<void> {
    const envelope = buildEnvelope({
      id,
      type,
      timestamp: new Date("2026-07-18T00:00:00.000Z"),
      resource: { kind: "entry", collection: "posts", id: "p1" },
      data: { id: "p1", title: "Hello" },
    });
    await adapter.transaction(async tx => recordEvent(tx, { envelope }));
  }

  function runFanOut() {
    const registry = new WebhookEndpointRegistry(adapter);
    return fanOutDueEvents({
      db: adapter,
      loadEndpoints: () => registry.getEnabledEndpoints(),
    });
  }

  async function deliveries(): Promise<
    Array<{ webhookId: string; eventId: string; status: string }>
  > {
    return adapter.select("nextly_webhook_deliveries");
  }

  async function fannedOutAt(eventId: string): Promise<unknown> {
    const rows = await adapter.select<{ fannedOutAt: unknown }>(
      "nextly_events",
      { where: { and: [{ column: "id", op: "=", value: eventId }] } }
    );
    return rows[0]?.fannedOutAt ?? null;
  }

  it("creates a delivery per matching endpoint and marks the event fanned out", async () => {
    await seedWebhook("wh_a");
    await seedWebhook("wh_b");
    await seedEvent("evt_1");

    const result = await runFanOut();

    expect(result).toEqual({ eventsProcessed: 1, deliveriesCreated: 2 });
    const rows = await deliveries();
    expect(rows.map(r => r.webhookId).sort()).toEqual(["wh_a", "wh_b"]);
    expect(rows.every(r => r.eventId === "evt_1")).toBe(true);
    expect(rows.every(r => r.status === "pending")).toBe(true);
    expect(await fannedOutAt("evt_1")).not.toBeNull();
  });

  it("is idempotent: a second pass finds no un-fanned events and creates nothing", async () => {
    await seedWebhook("wh_a");
    await seedEvent("evt_1");

    await runFanOut();
    const second = await runFanOut();

    expect(second).toEqual({ eventsProcessed: 0, deliveriesCreated: 0 });
    expect(await deliveries()).toHaveLength(1);
  });

  it("skips endpoints already delivered-to (read-filter dedup)", async () => {
    await seedWebhook("wh_a");
    await seedWebhook("wh_b");
    await seedEvent("evt_1");
    // A delivery for wh_a already exists (e.g. a prior partial pass); fan-out
    // must insert only wh_b and never conflict on the unique index.
    const now = new Date();
    await adapter.insert("nextly_webhook_deliveries", {
      id: "dlv_pre",
      webhook_id: "wh_a",
      event_id: "evt_1",
      status: "delivered",
      attempt_count: 1,
      next_attempt_at: null,
      created_at: now,
      updated_at: now,
    });

    const result = await runFanOut();

    expect(result.deliveriesCreated).toBe(1);
    const rows = await deliveries();
    expect(rows.map(r => r.webhookId).sort()).toEqual(["wh_a", "wh_b"]);
    expect(rows).toHaveLength(2);
  });

  it("marks an event with no matching endpoint fanned out, creating no deliveries", async () => {
    await seedWebhook("wh_a", ["entry.created"]);
    await seedEvent("evt_1", "entry.updated");

    const result = await runFanOut();

    expect(result).toEqual({ eventsProcessed: 1, deliveriesCreated: 0 });
    expect(await deliveries()).toHaveLength(0);
    expect(await fannedOutAt("evt_1")).not.toBeNull();
  });
});
