/**
 * Integration test for the webhook outbox capture (`recordEvent`) against a
 * real SQLite database.
 *
 * Verifies the enqueue-only mechanic: the event row is written through a real
 * transaction, its JSON payload round-trips, and a rolled-back transaction
 * leaves nothing behind (atomic, never fired for a rolled-back change). Fan-out
 * to endpoints happens in the drain, not here.
 *
 * Uses SQLite (cheapest live DB, no container) via the production table
 * definition turned into DDL by drizzle-kit — never hand-copied CREATE TABLE
 * (see .claude/rules/integration-tests.md).
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { NextlyError } from "../../../errors";
import { SchemaRegistry } from "../../../database/schema-registry";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { nextlyEvents } from "../../../schemas/webhooks/sqlite";
import { buildEnvelope } from "../envelope";
import { recordEvent } from "../record-event";
import type { WebhookEvent } from "../types";

const TEST_DB_DIR = join(
  tmpdir(),
  `nextly-webhook-capture-${process.pid}-${Date.now()}`
);
const TEST_DB_URL = `file:${join(TEST_DB_DIR, "test.db")}`;

process.env.DB_DIALECT = "sqlite";
process.env.DATABASE_URL = TEST_DB_URL;

// Production DDL for the one table this suite touches.
async function schemaDdl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({ nextlyEvents })
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

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    adapter = createSqliteAdapter({ url: TEST_DB_URL });
    await adapter.connect();
    for (const stmt of await schemaDdl()) await adapter.executeQuery(stmt);

    const schemaRegistry = new SchemaRegistry();
    schemaRegistry.registerStaticSchemas({ nextlyEvents });
    adapter.setTableResolver(schemaRegistry);
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
    await adapter.executeQuery("DELETE FROM nextly_events");
  });

  async function countEvents(): Promise<number> {
    const rows = await adapter.executeQuery<{ n: number }>(
      "SELECT COUNT(*) as n FROM nextly_events"
    );
    return Number(rows[0]?.n ?? 0);
  }

  it("writes the event row with the full envelope payload round-tripped", async () => {
    const envelope = makeEnvelope();

    await adapter.transaction(async tx => recordEvent(tx, { envelope }));

    const events = await adapter.select<{
      id: string;
      type: string;
      resourceKind: string;
      resourceCollection: string | null;
      payload: WebhookEvent;
    }>("nextly_events", {
      where: { and: [{ column: "id", op: "=", value: envelope.id }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("entry.updated");
    expect(events[0].resourceKind).toBe("entry");
    expect(events[0].resourceCollection).toBe("posts");
    expect(events[0].payload.type).toBe("entry.updated");
    expect(events[0].payload.changedFields).toEqual(envelope.changedFields);
  });

  it("leaves nothing behind when the transaction rolls back", async () => {
    const envelope = makeEnvelope();

    await expect(
      adapter.transaction(async tx => {
        await recordEvent(tx, { envelope });
        // Force a rollback after the event write (NextlyError per the
        // packages/nextly error convention).
        throw NextlyError.internal({
          logContext: { reason: "forced-rollback" },
        });
      })
    ).rejects.toThrow();

    expect(await countEvents()).toBe(0);
  });
});
