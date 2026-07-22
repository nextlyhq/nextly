/**
 * Integration test for the webhook delivery read service against real SQLite.
 *
 * Seeds webhooks, events, and delivery rows, then exercises the admin delivery
 * log: paged listing newest-first, status and event-type filters, endpoint
 * scoping, and single-delivery detail (attempt history + response snippet)
 * joined to the event. Uses an in-memory database built from the production
 * table definitions via drizzle-kit (never hand-copied DDL).
 */

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { users } from "../../../schemas/users/sqlite";
import {
  nextlyEvents,
  nextlyWebhooks,
  nextlyWebhookDeliveries,
} from "../../../schemas/webhooks/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { buildEnvelope } from "../envelope";
import { recordEvent } from "../record-event";
import { WebhookDeliveryQueryService } from "../services/webhook-delivery-query-service";
import type { WebhookEventType } from "../types";

process.env.DB_DIALECT = "sqlite";

const tables = { nextlyEvents, nextlyWebhooks, nextlyWebhookDeliveries };
// nextly_webhooks.created_by references users, so the FK target table must
// exist for SQLite's foreign-key enforcement even though we store null here.
const ddlTables = { ...tables, users };

async function schemaDdl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson(ddlTables)
  );
  return splitStatements(statements);
}

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("WebhookDeliveryQueryService (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let service: WebhookDeliveryQueryService;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    for (const stmt of await schemaDdl()) await adapter.executeQuery(stmt);

    const schemaRegistry = new SchemaRegistry("sqlite");
    schemaRegistry.registerStaticSchemas(tables);
    adapter.setTableResolver(schemaRegistry);

    service = new WebhookDeliveryQueryService(adapter, logger as never);
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

  async function seedWebhook(id: string): Promise<void> {
    await adapter.insert("nextly_webhooks", {
      id,
      name: id,
      url: `https://example.com/${id}`,
      enabled: true,
      event_types: ["entry.updated"],
      filter: null,
      headers: null,
      secret_hash: ["whsec_x"],
      secret_prefix: "whsec_",
      field_allowlist: null,
      created_by: null,
      created_at: new Date("2020-01-01T00:00:00.000Z"),
      updated_at: new Date("2020-01-01T00:00:00.000Z"),
    });
  }

  async function seedEvent(
    id: string,
    type: WebhookEventType,
    resource: Parameters<typeof buildEnvelope>[0]["resource"]
  ): Promise<void> {
    const envelope = buildEnvelope({
      id,
      type,
      timestamp: new Date("2026-07-18T00:00:00.000Z"),
      resource,
      data: { id: "x", title: "Hello" },
    });
    await adapter.transaction(async tx => recordEvent(tx, { envelope }));
  }

  interface SeedDeliveryOpts {
    status: string;
    attemptCount?: number;
    lastStatusCode?: number | null;
    lastLatencyMs?: number | null;
    lastError?: string | null;
    lastResponseSnippet?: string | null;
    attempts?: unknown;
    nextAttemptAt?: Date | null;
    createdAt: Date;
  }

  async function seedDelivery(
    id: string,
    webhookId: string,
    eventId: string,
    opts: SeedDeliveryOpts
  ): Promise<void> {
    await adapter.insert("nextly_webhook_deliveries", {
      id,
      webhook_id: webhookId,
      event_id: eventId,
      status: opts.status,
      attempt_count: opts.attemptCount ?? 0,
      next_attempt_at: opts.nextAttemptAt ?? null,
      locked_by: null,
      locked_until: null,
      last_status_code: opts.lastStatusCode ?? null,
      last_latency_ms: opts.lastLatencyMs ?? null,
      last_error: opts.lastError ?? null,
      last_response_snippet: opts.lastResponseSnippet ?? null,
      attempts: opts.attempts ?? null,
      created_at: opts.createdAt,
      updated_at: opts.createdAt,
    });
  }

  /** Seed one webhook with three deliveries across distinct event types/times. */
  async function seedLog(): Promise<void> {
    await seedWebhook("wh1");
    await seedWebhook("wh2");
    await seedEvent("evt_a", "entry.updated", {
      kind: "entry",
      collection: "posts",
      id: "p1",
    });
    await seedEvent("evt_b", "entry.published", {
      kind: "entry",
      collection: "posts",
      id: "p2",
    });
    await seedEvent("evt_c", "media.uploaded", { kind: "media", id: "m1" });

    await seedDelivery("d1", "wh1", "evt_a", {
      status: "delivered",
      attemptCount: 1,
      lastStatusCode: 200,
      lastLatencyMs: 42,
      lastResponseSnippet: "ok",
      attempts: [
        {
          at: "2026-07-18T00:00:01.000Z",
          outcome: "delivered",
          statusCode: 200,
          latencyMs: 42,
        },
      ],
      createdAt: new Date("2026-07-18T00:00:01.000Z"),
    });
    await seedDelivery("d2", "wh1", "evt_b", {
      status: "failed",
      attemptCount: 5,
      lastStatusCode: 500,
      lastError: "boom",
      lastResponseSnippet: "server error",
      attempts: [
        {
          at: "2026-07-18T00:00:02.000Z",
          outcome: "failed",
          statusCode: 500,
          error: "boom",
        },
      ],
      createdAt: new Date("2026-07-18T00:00:02.000Z"),
    });
    await seedDelivery("d3", "wh1", "evt_c", {
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: new Date("2026-07-18T00:05:00.000Z"),
      createdAt: new Date("2026-07-18T00:00:03.000Z"),
    });
    // A delivery on a different endpoint, to prove list/get scoping.
    await seedDelivery("d_other", "wh2", "evt_a", {
      status: "delivered",
      createdAt: new Date("2026-07-18T00:00:04.000Z"),
    });
  }

  describe("listDeliveries", () => {
    it("returns an endpoint's deliveries newest-first, joined to the event", async () => {
      await seedLog();
      const { items, total } = await service.listDeliveries("wh1", {
        page: 1,
        limit: 20,
      });

      expect(total).toBe(3);
      // Newest createdAt first: d3, d2, d1. wh2's delivery is excluded.
      expect(items.map(i => i.id)).toEqual(["d3", "d2", "d1"]);

      const delivered = items.find(i => i.id === "d1")!;
      expect(delivered.eventType).toBe("entry.updated");
      expect(delivered.resource).toEqual({
        kind: "entry",
        collection: "posts",
        id: "p1",
      });
      expect(delivered.status).toBe("delivered");
      expect(delivered.lastStatusCode).toBe(200);
      expect(delivered.lastLatencyMs).toBe(42);
      // Timestamps come back as ISO-8601 UTC strings. Absolute values are not
      // asserted here: a naive-datetime column round-trips through the runner's
      // local timezone, so the exact instant is environment-dependent — the
      // newest-first ordering above is what pins the createdAt semantics.
      expect(delivered.eventCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(delivered.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it("filters by status", async () => {
      await seedLog();
      const { items, total } = await service.listDeliveries("wh1", {
        page: 1,
        limit: 20,
        status: "failed",
      });
      expect(total).toBe(1);
      expect(items.map(i => i.id)).toEqual(["d2"]);
    });

    it("filters by event type", async () => {
      await seedLog();
      const { items } = await service.listDeliveries("wh1", {
        page: 1,
        limit: 20,
        eventType: "media.uploaded",
      });
      expect(items.map(i => i.id)).toEqual(["d3"]);
    });

    it("paginates while reporting the full total", async () => {
      await seedLog();
      const first = await service.listDeliveries("wh1", { page: 1, limit: 2 });
      expect(first.total).toBe(3);
      expect(first.items.map(i => i.id)).toEqual(["d3", "d2"]);

      const second = await service.listDeliveries("wh1", { page: 2, limit: 2 });
      expect(second.total).toBe(3);
      expect(second.items.map(i => i.id)).toEqual(["d1"]);
    });

    it("returns an empty page for an endpoint with no deliveries", async () => {
      await seedLog();
      const { items, total } = await service.listDeliveries("nope", {
        page: 1,
        limit: 20,
      });
      expect(total).toBe(0);
      expect(items).toEqual([]);
    });
  });

  describe("getDelivery", () => {
    it("returns one delivery with its attempt history and response snippet", async () => {
      await seedLog();
      const detail = await service.getDelivery("wh1", "d2");
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe("d2");
      expect(detail!.eventType).toBe("entry.published");
      expect(detail!.lastError).toBe("boom");
      expect(detail!.lastResponseSnippet).toBe("server error");
      expect(detail!.attempts).toEqual([
        {
          at: "2026-07-18T00:00:02.000Z",
          outcome: "failed",
          statusCode: 500,
          error: "boom",
        },
      ]);
    });

    it("returns null for a delivery id that belongs to another endpoint", async () => {
      await seedLog();
      // d_other belongs to wh2; asking for it under wh1 must not leak it.
      expect(await service.getDelivery("wh1", "d_other")).toBeNull();
    });

    it("returns null for an unknown delivery id", async () => {
      await seedLog();
      expect(await service.getDelivery("wh1", "missing")).toBeNull();
    });
  });
});
