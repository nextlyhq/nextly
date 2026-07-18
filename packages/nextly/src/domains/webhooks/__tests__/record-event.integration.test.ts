/**
 * Integration test for the webhook outbox capture: `recordEvent` +
 * `WebhookEndpointRegistry` against a real SQLite database.
 *
 * Verifies the core outbox mechanic end to end: an event row and its fan-out
 * delivery rows are written through a real transaction, the JSON payload
 * round-trips, filtering/subscription decides which endpoints get a delivery,
 * and a rolled-back transaction leaves nothing behind (atomic at-least-once).
 *
 * Uses SQLite (cheapest live DB, no container) via the production per-dialect
 * table definitions turned into DDL by drizzle-kit — never hand-copied CREATE
 * TABLE (see .claude/rules/integration-tests.md).
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { users as usersSqlite } from "../../../schemas/users/sqlite";
import {
  nextlyEvents,
  nextlyWebhooks,
  nextlyWebhookDeliveries,
} from "../../../schemas/webhooks/sqlite";
import { buildEnvelope } from "../envelope";
import { WebhookEndpointRegistry } from "../endpoint-registry";
import { recordEvent } from "../record-event";
import type { WebhookEvent } from "../types";

const TEST_DB_DIR = join(
  tmpdir(),
  `nextly-webhook-capture-${process.pid}-${Date.now()}`
);
const TEST_DB_URL = `file:${join(TEST_DB_DIR, "test.db")}`;

process.env.DB_DIALECT = "sqlite";
process.env.DATABASE_URL = TEST_DB_URL;

// Production DDL for exactly the tables this suite touches, generated from the
// canonical sqlite table definitions (users included so the webhooks.created_by
// FK resolves).
async function schemaDdl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      users: usersSqlite,
      nextlyEvents,
      nextlyWebhooks,
      nextlyWebhookDeliveries,
    })
  );
  return splitStatements(statements);
}

function makeEnvelope(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return buildEnvelope({
    id: `evt_${Math.floor(Math.random() * 1e9)}`,
    type: "entry.updated",
    timestamp: new Date("2026-07-18T00:00:00.000Z"),
    resource: { kind: "entry", collection: "posts", id: "p1" },
    data: { id: "p1", title: "Hello", status: "published" },
    ...(overrides as Partial<Parameters<typeof buildEnvelope>[0]>),
  });
}

describe("webhook outbox capture (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let registry: WebhookEndpointRegistry;

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    for (const stmt of await schemaDdl()) await adapter.executeQuery(stmt);

    // Register the tables so the adapter's Drizzle CRUD path (used by the
    // registry's select and read-backs) resolves them by name.
    const schemaRegistry = new SchemaRegistry();
    schemaRegistry.registerStaticSchemas({
      users: usersSqlite,
      nextlyEvents,
      nextlyWebhooks,
      nextlyWebhookDeliveries,
    });
    adapter.setTableResolver(schemaRegistry);

    registry = new WebhookEndpointRegistry(adapter);
  });

  afterAll(async () => {
    try {
      await adapter?.disconnect?.();
    } catch {
      // ignore teardown errors
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // A clean ledger + registry per test.
    await adapter.executeQuery("DELETE FROM nextly_webhook_deliveries");
    await adapter.executeQuery("DELETE FROM nextly_events");
    await adapter.executeQuery("DELETE FROM nextly_webhooks");
    registry.invalidate();
  });

  async function insertWebhook(
    over: Partial<{
      id: string;
      name: string;
      url: string;
      enabled: boolean;
      eventTypes: unknown;
      filter: unknown;
    }> = {}
  ): Promise<string> {
    const id = over.id ?? `wh_${Math.floor(Math.random() * 1e9)}`;
    await adapter.insert("nextly_webhooks", {
      id,
      name: over.name ?? "Test endpoint",
      url: over.url ?? "https://example.com/hook",
      enabled: over.enabled ?? true,
      event_types: over.eventTypes ?? ["entry.updated"],
      filter: over.filter ?? null,
      secret_hash: ["h1"],
      secret_prefix: "whsec_ab",
    });
    return id;
  }

  async function countRows(table: string): Promise<number> {
    const rows = await adapter.executeQuery<{ n: number }>(
      `SELECT COUNT(*) as n FROM ${table}`
    );
    return Number(rows[0]?.n ?? 0);
  }

  it("writes the event row and a delivery for a matching enabled endpoint", async () => {
    const webhookId = await insertWebhook();
    const envelope = makeEnvelope();
    const endpoints = await registry.getEnabledEndpoints();

    const result = await adapter.transaction(async tx =>
      recordEvent(tx, { envelope, endpoints })
    );
    expect(result.deliveries).toBe(1);

    // Event row persisted with the full envelope payload round-tripped.
    const events = await adapter.select<{ id: string; payload: WebhookEvent }>(
      "nextly_events",
      { where: { and: [{ column: "id", op: "=", value: envelope.id }] } }
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.type).toBe("entry.updated");
    expect(events[0].payload.changedFields).toEqual(envelope.changedFields);

    // One pending delivery for the endpoint.
    const deliveries = await adapter.select<{
      webhookId: string;
      eventId: string;
      status: string;
      attemptCount: number;
    }>("nextly_webhook_deliveries", {
      // adapter.select's where clause keys on the Drizzle JS property name.
      where: { and: [{ column: "eventId", op: "=", value: envelope.id }] },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].webhookId).toBe(webhookId);
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].attemptCount).toBe(0);
  });

  it("records the event but no delivery when the filter rejects it", async () => {
    await insertWebhook({ filter: { version: 1, collections: ["other"] } });
    const envelope = makeEnvelope();
    const endpoints = await registry.getEnabledEndpoints();

    const result = await adapter.transaction(async tx =>
      recordEvent(tx, { envelope, endpoints })
    );
    expect(result.deliveries).toBe(0);
    expect(await countRows("nextly_events")).toBe(1);
    expect(await countRows("nextly_webhook_deliveries")).toBe(0);
  });

  it("does not fan out to a disabled endpoint", async () => {
    await insertWebhook({ enabled: false });
    const endpoints = await registry.getEnabledEndpoints();
    expect(endpoints).toHaveLength(0);

    const result = await adapter.transaction(async tx =>
      recordEvent(tx, { envelope: makeEnvelope(), endpoints })
    );
    expect(result.deliveries).toBe(0);
  });

  it("leaves nothing behind when the transaction rolls back", async () => {
    await insertWebhook();
    const envelope = makeEnvelope();
    const endpoints = await registry.getEnabledEndpoints();

    await expect(
      adapter.transaction(async tx => {
        await recordEvent(tx, { envelope, endpoints });
        // Force a rollback after the outbox writes.
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(await countRows("nextly_events")).toBe(0);
    expect(await countRows("nextly_webhook_deliveries")).toBe(0);
  });

  it("caches enabled endpoints until invalidated", async () => {
    await insertWebhook();
    expect(await registry.getEnabledEndpoints()).toHaveLength(1);

    // A second endpoint added behind the cache is not seen until invalidate().
    await insertWebhook();
    expect(await registry.getEnabledEndpoints()).toHaveLength(1);

    registry.invalidate();
    expect(await registry.getEnabledEndpoints()).toHaveLength(2);
  });
});
