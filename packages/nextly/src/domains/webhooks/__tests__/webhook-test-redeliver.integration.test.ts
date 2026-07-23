/**
 * Test-ping and redeliver against a real SQLite database.
 *
 * test-ping: a synthetic signed `webhook.ping` reaches the endpoint via the
 * injected transport, carries valid Standard-Webhooks headers, and reports the
 * outcome — without writing any event or delivery row. redeliver: a terminal
 * delivery row is RE-ARMED in place (the unique `(webhook, event)` index forbids
 * a second row), its attempt budget reset while the attempt history is kept, and
 * the endpoint-state guards refuse a deleted/disabled endpoint or an unknown
 * delivery.
 *
 * Schema comes from the production table definition via drizzle-kit, never a
 * hand-copied CREATE TABLE (see .claude/rules/integration-tests.md).
 */

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getSQLiteDrizzleKit } from "../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors";
import { users } from "../../../schemas/users/sqlite";
import {
  nextlyEvents,
  nextlyWebhooks,
  nextlyWebhookDeliveries,
} from "../../../schemas/webhooks/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import type { DeliverTransport } from "../deliver";
import { WebhookEndpointService } from "../services/webhook-endpoint-service";
import { verifySignature } from "../signing";
import type { WebhookEventType } from "../types";

process.env.DB_DIALECT = "sqlite";
process.env.NEXTLY_SECRET = "integration-test-application-secret";

const EVENTS: WebhookEventType[] = ["entry.created"];
// An address literal short-circuits DNS in the URL validator (see the endpoint
// service suite), so the test never needs real name resolution.
const PUBLIC_URL = "https://93.184.216.34/hooks";

async function schemaDdl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      users,
      nextlyEvents,
      nextlyWebhooks,
      nextlyWebhookDeliveries,
    })
  );
  return splitStatements(statements);
}

/** A transport that records the last call and returns a canned response. */
function recordingTransport(response: () => Response) {
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }> = [];
  const transport: DeliverTransport = async (url, options) => {
    calls.push({ url, headers: options.headers, body: options.body });
    return response();
  };
  return { transport, calls };
}

describe("webhook test-ping + redeliver (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let service: WebhookEndpointService;

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    for (const stmt of await schemaDdl()) await adapter.executeQuery(stmt);
    await adapter.executeQuery(
      "INSERT INTO users (id, email, created_at, updated_at) VALUES ('user_1', 'dev@example.com', 0, 0)"
    );
    const schemaRegistry = new SchemaRegistry("sqlite");
    schemaRegistry.registerStaticSchemas({
      users,
      nextlyEvents,
      nextlyWebhooks,
      nextlyWebhookDeliveries,
    });
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
    await adapter.executeQuery("DELETE FROM nextly_events");
    await adapter.executeQuery("DELETE FROM nextly_webhooks");
    service = new WebhookEndpointService(adapter as never, logger as never);
  });

  const create = (overrides: Record<string, unknown> = {}) =>
    service.createEndpoint(
      {
        name: "Orders",
        url: PUBLIC_URL,
        eventTypes: EVENTS,
        ...overrides,
      } as never,
      "user_1"
    );

  describe("test-ping", () => {
    it("sends a validly-signed ping and reports success without persisting", async () => {
      const { endpoint, secret } = await create();
      const { transport, calls } = recordingTransport(
        () => new Response("ok", { status: 200 })
      );

      const result = await service.testEndpoint(endpoint.id, {
        transport,
        pingId: "ping_1",
      });

      expect(result.delivered).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseSnippet).toBe("ok");

      // One outbound request, to the endpoint's URL, carrying the ping payload.
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(PUBLIC_URL);
      const payload = JSON.parse(calls[0].body);
      expect(payload.type).toBe("webhook.ping");
      expect(payload.webhookId).toBe(endpoint.id);

      // The signature is valid for the endpoint's real secret.
      expect(
        verifySignature({
          id: calls[0].headers["webhook-id"],
          timestamp: calls[0].headers["webhook-timestamp"],
          body: calls[0].body,
          signatureHeader: calls[0].headers["webhook-signature"],
          secrets: [secret],
        })
      ).toBe(true);

      // Nothing was written to the outbox or the delivery ledger.
      expect(await adapter.select("nextly_events")).toHaveLength(0);
      expect(await adapter.select("nextly_webhook_deliveries")).toHaveLength(0);
    });

    it("reports not-delivered on a non-2xx without throwing", async () => {
      const { endpoint } = await create();
      const { transport } = recordingTransport(
        () => new Response("nope", { status: 500 })
      );
      const result = await service.testEndpoint(endpoint.id, { transport });
      expect(result.delivered).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toBe("http 500");
    });

    it("reports not-delivered when the transport throws (unreachable)", async () => {
      const { endpoint } = await create();
      const transport: DeliverTransport = () => {
        throw new Error("connect ECONNREFUSED");
      };
      const result = await service.testEndpoint(endpoint.id, { transport });
      expect(result.delivered).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("404s an unknown endpoint", async () => {
      await expect(
        service.testEndpoint("missing", { transport: vi.fn() as never })
      ).rejects.toBeInstanceOf(NextlyError);
    });
  });

  describe("redeliver", () => {
    // Seed an event + a terminal delivery row directly (the fan-out/deliver
    // pipeline is exercised elsewhere; here we only care about the re-arm).
    async function seedFailedDelivery(webhookId: string): Promise<string> {
      await adapter.executeQuery(
        "INSERT INTO nextly_events (id, type, resource_kind, resource_id, payload, created_at) " +
          "VALUES ('evt_1', 'entry.created', 'entry', 'row_1', '{}', 0)"
      );
      await adapter.executeQuery(
        "INSERT INTO nextly_webhook_deliveries " +
          "(id, webhook_id, event_id, status, attempt_count, next_attempt_at, last_error, attempts, created_at, updated_at) " +
          `VALUES ('del_1', '${webhookId}', 'evt_1', 'failed', 6, NULL, 'http 500', ` +
          `'[{"at":1,"outcome":"failed","statusCode":500}]', 0, 0)`
      );
      return "del_1";
    }

    it("re-arms a failed delivery in place, resetting the budget and keeping history", async () => {
      const { endpoint } = await create();
      const deliveryId = await seedFailedDelivery(endpoint.id);

      await service.redeliverDelivery(endpoint.id, deliveryId);

      const rows = await adapter.select<{
        status: string;
        attemptCount: number;
        nextAttemptAt: unknown;
        lockedBy: unknown;
        attempts: unknown;
      }>("nextly_webhook_deliveries", {
        where: { and: [{ column: "id", op: "=", value: "del_1" }] },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("pending");
      expect(rows[0].attemptCount).toBe(0);
      expect(rows[0].nextAttemptAt).not.toBeNull();
      expect(rows[0].lockedBy).toBeNull();
      // The prior failure is still visible.
      expect(JSON.stringify(rows[0].attempts)).toContain("failed");

      // Still exactly one row — the unique index was respected (no duplicate).
      const all = await adapter.select("nextly_webhook_deliveries", {
        where: { and: [{ column: "webhookId", op: "=", value: endpoint.id }] },
      });
      expect(all).toHaveLength(1);
    });

    it("404s an unknown delivery", async () => {
      const { endpoint } = await create();
      await expect(
        service.redeliverDelivery(endpoint.id, "missing")
      ).rejects.toBeInstanceOf(NextlyError);
    });

    it("409s when the endpoint is disabled", async () => {
      const { endpoint } = await create();
      const deliveryId = await seedFailedDelivery(endpoint.id);
      await service.setEnabled(endpoint.id, false);

      await expect(
        service.redeliverDelivery(endpoint.id, deliveryId)
      ).rejects.toBeInstanceOf(NextlyError);

      // The row was NOT re-armed.
      const rows = await adapter.select<{ status: string }>(
        "nextly_webhook_deliveries",
        { where: { and: [{ column: "id", op: "=", value: "del_1" }] } }
      );
      expect(rows[0].status).toBe("failed");
    });

    it("does not let another endpoint redeliver a foreign delivery", async () => {
      const { endpoint } = await create();
      const deliveryId = await seedFailedDelivery(endpoint.id);
      const other = await create({ name: "Other" });

      await expect(
        service.redeliverDelivery(other.endpoint.id, deliveryId)
      ).rejects.toBeInstanceOf(NextlyError);
    });
  });
});
