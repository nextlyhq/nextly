/**
 * Endpoint management against a real SQLite database.
 *
 * The interesting assertions are not that CRUD stores fields — they are that a
 * secret never leaks through an ordinary read, that a URL delivery could not
 * call is refused before it is stored, and that the cached endpoint list is
 * dropped on every change. Each of those fails silently if it regresses: a
 * leaked secret looks like a successful response, an unreachable URL looks like
 * a saved endpoint, and a stale cache looks like a working install still
 * delivering to an endpoint the operator disabled.
 *
 * Schema comes from the production table definition via drizzle-kit, never a
 * hand-copied CREATE TABLE (see .claude/rules/integration-tests.md).
 */

import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import { WEBHOOK_SECRET_PREFIX } from "../secret";
import { REDACTED_HEADER_VALUE } from "../types";
import { WebhookEndpointService } from "../services/webhook-endpoint-service";
import type { WebhookEventType } from "../types";

process.env.DB_DIALECT = "sqlite";
process.env.NEXTLY_SECRET = "integration-test-application-secret";

const EVENTS: WebhookEventType[] = ["entry.created", "entry.updated"];

async function schemaDdl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    // `created_by` references users.id, so the referenced table has to exist
    // for the foreign key to be creatable.
    await kit.generateDrizzleJson({
      users,
      nextlyEvents,
      nextlyWebhooks,
      nextlyWebhookDeliveries,
    })
  );
  return splitStatements(statements);
}

/** Records invalidations so the cache-drop can be asserted rather than assumed. */
class RecordingRegistry {
  invalidations = 0;
  invalidate(): void {
    this.invalidations += 1;
  }
}

describe("webhook endpoint management (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;
  let registry: RecordingRegistry;
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

    // created_by is a real foreign key, so attribution needs a real user.
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
    registry = new RecordingRegistry();
    service = new WebhookEndpointService(
      adapter as never,
      logger as never,
      registry
    );
  });

  // An address literal, not a hostname: `createEndpoint` runs the same URL
  // validator delivery uses, and that resolves a hostname through real DNS. A
  // literal short-circuits before the lookup, so the suite does not fail with
  // EAI_AGAIN wherever DNS is unavailable. Nothing is ever connected to; only
  // the address is examined.
  const PUBLIC_URL = "https://93.184.216.34/hooks";

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

  describe("creating", () => {
    it("returns the secret once and never again", async () => {
      const { endpoint, secret } = await create();

      expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
      expect(endpoint.secretPrefix).toBe(secret.slice(0, 14));

      // The summary type has no secret field; this asserts the object really
      // does not carry one, which is what a JSON response would serialise.
      expect(JSON.stringify(endpoint)).not.toContain(secret);

      const fetched = await service.getEndpoint(endpoint.id);
      expect(JSON.stringify(fetched)).not.toContain(secret);

      const listed = await service.listEndpoints();
      expect(JSON.stringify(listed)).not.toContain(secret);
    });

    it("stores the secret encrypted, not in the clear", async () => {
      const { secret } = await create();

      const raw = await adapter.executeQuery<{ secret_hash: string }>(
        "SELECT secret_hash FROM nextly_webhooks"
      );
      const stored = String(raw[0]?.secret_hash ?? "");

      expect(stored).not.toContain(secret);
      expect(stored).not.toContain(secret.slice(WEBHOOK_SECRET_PREFIX.length));
    });

    it("gives each endpoint its own secret", async () => {
      // The spec is explicit that a signing key is never shared across
      // endpoints: one compromised receiver would otherwise be able to forge
      // traffic for every other.
      const a = await create();
      const b = await create({ name: "Second" });
      expect(a.secret).not.toBe(b.secret);
    });

    it("defaults to enabled", async () => {
      const { endpoint } = await create();
      expect(endpoint.enabled).toBe(true);
    });

    it("drops the cached endpoint list", async () => {
      await create();
      expect(registry.invalidations).toBe(1);
    });

    it("reports a database failure as a NextlyError, not a driver error", async () => {
      // created_by is a real foreign key, so attributing an endpoint to a user
      // that no longer exists fails in the driver. Nothing above this layer
      // knows how to render a raw driver exception, and it is not something a
      // caller should ever see.
      await expect(
        service.createEndpoint(
          {
            name: "Orphaned",
            url: PUBLIC_URL,
            eventTypes: EVENTS,
          },
          "user_that_does_not_exist"
        )
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("static header values never leave the service", () => {
    // Delivery sends these verbatim, so they are routinely a credential for the
    // receiver. Anyone allowed to read the configuration would otherwise be
    // handed that credential, including a read-only caller.
    const SECRET_HEADER = { Authorization: "Bearer receiver-credential" };

    it("redacts values but keeps names on create, read and list", async () => {
      const { endpoint } = await create({ headers: SECRET_HEADER });

      for (const summary of [
        endpoint,
        await service.getEndpoint(endpoint.id),
        (await service.listEndpoints())[0],
      ]) {
        expect(JSON.stringify(summary)).not.toContain("receiver-credential");
        expect(summary?.headers).toEqual({
          Authorization: REDACTED_HEADER_VALUE,
        });
      }
    });

    it("redacts on update too", async () => {
      const { endpoint } = await create({ headers: SECRET_HEADER });

      const updated = await service.updateEndpoint(endpoint.id, {
        name: "Renamed",
      });

      expect(JSON.stringify(updated)).not.toContain("receiver-credential");
    });

    it("still stores and delivers the real value", async () => {
      // Redaction is a read-side concern. The stored row has to keep the real
      // header or delivery would start sending the placeholder.
      const { endpoint } = await create({ headers: SECRET_HEADER });

      const rows = await adapter.executeQuery<{ headers: string }>(
        `SELECT headers FROM nextly_webhooks WHERE id = '${endpoint.id}'`
      );

      expect(String(rows[0]?.headers)).toContain("receiver-credential");
    });
  });

  describe("URL validation at registration", () => {
    // Delivery refuses these too, but that happens long after whoever typed the
    // URL has gone. Refusing here turns a silent, repeating delivery failure
    // into an error the person responsible can still act on.
    it.each([
      ["loopback", "https://127.0.0.1/hooks"],
      ["private range", "https://10.0.0.5/hooks"],
      ["link-local metadata", "https://169.254.169.254/latest/meta-data"],
      ["plain http", "http://93.184.216.34/hooks"],
    ])("refuses %s", async (_label, url) => {
      await expect(create({ url })).rejects.toThrow(NextlyError);
    });

    it.each([
      ["a username and password", "https://user:pass@93.184.216.34/hook"],
      ["a username alone", "https://user@93.184.216.34/hook"],
    ])("refuses credentials in the URL: %s", async (_label, url) => {
      // The stored URL is returned to anyone who may read the endpoint, so
      // credentials here would leak the receiver's own credential even though
      // static header values are redacted.
      await expect(create({ url })).rejects.toThrow(NextlyError);
    });

    it("re-checks URL credentials on update", async () => {
      const { endpoint } = await create();

      await expect(
        service.updateEndpoint(endpoint.id, {
          url: "https://user:pass@93.184.216.34/hook",
        })
      ).rejects.toThrow(NextlyError);
    });

    it("stores nothing when the URL is refused", async () => {
      await expect(create({ url: "https://10.0.0.5/hooks" })).rejects.toThrow();
      expect(await service.listEndpoints()).toHaveLength(0);
    });

    it("re-checks on update, which is how an endpoint gets re-pointed", async () => {
      const { endpoint } = await create();

      await expect(
        service.updateEndpoint(endpoint.id, { url: "https://10.0.0.5/x" })
      ).rejects.toThrow(NextlyError);

      const unchanged = await service.getEndpoint(endpoint.id);
      expect(unchanged?.url).toBe(PUBLIC_URL);
    });
  });

  describe("updating", () => {
    it("moves only the named fields", async () => {
      const { endpoint } = await create();

      const updated = await service.updateEndpoint(endpoint.id, {
        name: "Renamed",
      });

      expect(updated.name).toBe("Renamed");
      expect(updated.url).toBe(endpoint.url);
      expect(updated.eventTypes).toEqual(EVENTS);
      expect(updated.enabled).toBe(true);
    });

    it("drops the cached list on every change", async () => {
      const { endpoint } = await create();
      registry.invalidations = 0;

      await service.updateEndpoint(endpoint.id, { name: "A" });
      await service.updateEndpoint(endpoint.id, {
        url: "https://93.184.216.35/h",
      });

      // Not only on an enabled toggle: url, event types and headers are cached
      // too, so a stale copy would keep delivering to the previous target.
      expect(registry.invalidations).toBe(2);
    });

    it("reports an unknown endpoint as not found", async () => {
      await expect(
        service.updateEndpoint("missing", { name: "x" })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("disabling ends outstanding deliveries", () => {
    /** A queued delivery for an endpoint, in the state a drain would pick up. */
    async function queueDelivery(
      id: string,
      webhookId: string,
      status: string
    ): Promise<void> {
      await adapter.insert("nextly_events", {
        id: `evt_${id}`,
        type: "entry.updated",
        resource_kind: "entry",
        resource_id: "p1",
        collection: "posts",
        payload: { id: "p1" },
        created_at: new Date(0),
      });
      await adapter.insert("nextly_webhook_deliveries", {
        id,
        webhook_id: webhookId,
        event_id: `evt_${id}`,
        status,
        attempt_count: 1,
        next_attempt_at: new Date(0),
        locked_by: null,
        locked_until: null,
        created_at: new Date(0),
        updated_at: new Date(0),
      });
    }

    async function deliveryStatus(id: string): Promise<string> {
      const rows = await adapter.select<{ status: string }>(
        "nextly_webhook_deliveries",
        { where: { and: [{ column: "id", op: "=", value: id }] } }
      );
      return rows[0]?.status ?? "gone";
    }

    it("ends queued and retrying deliveries when the endpoint is disabled", async () => {
      // Delivery refuses a disabled endpoint when it attempts one, but only if
      // a drain runs during the disabled window. Without this, disabling and
      // re-enabling with no drain in between would release the queue in a
      // burst afterwards.
      const { endpoint } = await create();
      await queueDelivery("dlv_pending", endpoint.id, "pending");
      await queueDelivery("dlv_retrying", endpoint.id, "retrying");

      await service.setEnabled(endpoint.id, false);

      expect(await deliveryStatus("dlv_pending")).toBe("failed");
      expect(await deliveryStatus("dlv_retrying")).toBe("failed");
    });

    it("leaves already-delivered rows alone", async () => {
      // Only outstanding work is ended. Rewriting a terminal row would corrupt
      // the record of what was actually sent.
      const { endpoint } = await create();
      await queueDelivery("dlv_done", endpoint.id, "delivered");

      await service.setEnabled(endpoint.id, false);

      expect(await deliveryStatus("dlv_done")).toBe("delivered");
    });

    it("ends them when disabling through a plain field update too", async () => {
      // setEnabled is a convenience over updateEndpoint; disabling through
      // either must behave the same.
      const { endpoint } = await create();
      await queueDelivery("dlv_x", endpoint.id, "pending");

      await service.updateEndpoint(endpoint.id, { enabled: false });

      expect(await deliveryStatus("dlv_x")).toBe("failed");
    });

    it("does not touch another endpoint's queue", async () => {
      const a = await create({ name: "A" });
      const b = await create({ name: "B" });
      await queueDelivery("dlv_a", a.endpoint.id, "pending");
      await queueDelivery("dlv_b", b.endpoint.id, "pending");

      await service.setEnabled(a.endpoint.id, false);

      expect(await deliveryStatus("dlv_a")).toBe("failed");
      expect(await deliveryStatus("dlv_b")).toBe("pending");
    });
  });

  describe("disable versus delete", () => {
    it("disabling keeps the endpoint and its id", async () => {
      const { endpoint } = await create();

      const disabled = await service.setEnabled(endpoint.id, false);
      expect(disabled.enabled).toBe(false);
      expect(await service.getEndpoint(endpoint.id)).not.toBeNull();

      const reenabled = await service.setEnabled(endpoint.id, true);
      expect(reenabled.enabled).toBe(true);
    });

    it("deleting hides the endpoint from every read and drops the cache", async () => {
      const { endpoint } = await create();
      registry.invalidations = 0;

      await service.deleteEndpoint(endpoint.id);

      expect(await service.getEndpoint(endpoint.id)).toBeNull();
      expect(await service.listEndpoints()).toHaveLength(0);
      await expect(service.revealSecrets(endpoint.id)).rejects.toThrow(
        NextlyError
      );
      expect(registry.invalidations).toBe(1);
    });

    it("keeps the row and its delivery history rather than removing them", async () => {
      // The point of the soft delete: the ledger of what was sent survives with
      // a real endpoint still on the other end of its foreign key.
      const { endpoint } = await create();
      await adapter.insert("nextly_events", {
        id: "evt_hist",
        type: "entry.updated",
        resource_kind: "entry",
        resource_id: "p1",
        collection: "posts",
        payload: { id: "p1" },
        created_at: new Date(0),
      });
      await adapter.insert("nextly_webhook_deliveries", {
        id: "dlv_hist",
        webhook_id: endpoint.id,
        event_id: "evt_hist",
        status: "delivered",
        attempt_count: 1,
        next_attempt_at: null,
        locked_by: null,
        locked_until: null,
        created_at: new Date(0),
        updated_at: new Date(0),
      });

      await service.deleteEndpoint(endpoint.id);

      const webhookRows = await adapter.executeQuery<{ deleted_at: number }>(
        `SELECT deleted_at FROM nextly_webhooks WHERE id = '${endpoint.id}'`
      );
      expect(webhookRows).toHaveLength(1);
      expect(webhookRows[0]?.deleted_at).not.toBeNull();

      const deliveryRows = await adapter.executeQuery(
        "SELECT id FROM nextly_webhook_deliveries WHERE id = 'dlv_hist'"
      );
      expect(deliveryRows).toHaveLength(1);
    });

    it("ends deliveries still queued for the endpoint on delete", async () => {
      // Retiring an endpoint must stop it POSTing, the same way disabling does.
      const { endpoint } = await create();
      await adapter.insert("nextly_events", {
        id: "evt_q",
        type: "entry.updated",
        resource_kind: "entry",
        resource_id: "p1",
        collection: "posts",
        payload: { id: "p1" },
        created_at: new Date(0),
      });
      await adapter.insert("nextly_webhook_deliveries", {
        id: "dlv_q",
        webhook_id: endpoint.id,
        event_id: "evt_q",
        status: "pending",
        attempt_count: 0,
        next_attempt_at: new Date(0),
        locked_by: null,
        locked_until: null,
        created_at: new Date(0),
        updated_at: new Date(0),
      });

      await service.deleteEndpoint(endpoint.id);

      const rows = await adapter.executeQuery<{
        status: string;
        last_error: string;
      }>(
        "SELECT status, last_error FROM nextly_webhook_deliveries WHERE id = 'dlv_q'"
      );
      expect(rows[0]?.status).toBe("failed");
      // The retained history must say the endpoint was deleted, not merely
      // disabled, so the audit trail is accurate in exactly the case this
      // feature preserves.
      expect(rows[0]?.last_error).toBe("webhook deleted");
    });

    it("clears the signing secret and static headers on delete", async () => {
      // A retired endpoint never delivers again, so its receiver credentials
      // are of no further use and should not linger. Attribution stays.
      const { endpoint } = await create({
        headers: { Authorization: "Bearer receiver-token" },
      });

      await service.deleteEndpoint(endpoint.id);

      const rows = await adapter.executeQuery<{
        secret_hash: string;
        headers: string | null;
        name: string;
        url: string;
      }>(
        `SELECT secret_hash, headers, name, url FROM nextly_webhooks WHERE id = '${endpoint.id}'`
      );
      expect(String(rows[0]?.secret_hash)).not.toContain("receiver-token");
      expect(rows[0]?.secret_hash).toBe("[]");
      expect(rows[0]?.headers).toBeNull();
      // Attribution the delivery history relies on is kept.
      expect(rows[0]?.name).toBe("Orders");
      expect(rows[0]?.url).toBe(PUBLIC_URL);
    });

    it("lets the same URL be registered again as a distinct live endpoint", async () => {
      // A retired endpoint is not resurrected; re-registering makes a new one.
      const first = await create();
      await service.deleteEndpoint(first.endpoint.id);

      const second = await create();

      expect(second.endpoint.id).not.toBe(first.endpoint.id);
      expect(await service.getEndpoint(second.endpoint.id)).not.toBeNull();
      expect(await service.listEndpoints()).toHaveLength(1);
    });

    it("reports deleting an unknown endpoint as not found", async () => {
      await expect(service.deleteEndpoint("missing")).rejects.toThrow(
        NextlyError
      );
    });

    it("reports deleting an already-retired endpoint as not found", async () => {
      const { endpoint } = await create();
      await service.deleteEndpoint(endpoint.id);
      await expect(service.deleteEndpoint(endpoint.id)).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("revealing the secret", () => {
    it("recovers exactly what creation returned", async () => {
      const { endpoint, secret } = await create();
      expect(await service.revealSecrets(endpoint.id)).toEqual([secret]);
    });

    it("reports an unknown endpoint as not found", async () => {
      await expect(service.revealSecrets("missing")).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("listing", () => {
    it("returns every endpoint, newest first", async () => {
      const first = await create({ name: "First" });
      const second = await create({ name: "Second" });

      const listed = await service.listEndpoints();
      expect(listed).toHaveLength(2);
      expect(listed.map(e => e.id)).toContain(first.endpoint.id);
      expect(listed.map(e => e.id)).toContain(second.endpoint.id);
    });
  });

  describe("rotating the secret", () => {
    it("keeps the old secret live during the overlap and makes the new one primary", async () => {
      const { endpoint, secret: original } = await create();

      const { endpoint: rotated, secret: fresh } = await service.rotateSecret(
        endpoint.id,
        { overlapSeconds: 3600 }
      );

      // A new secret, distinct from the original, is now the primary.
      expect(fresh).not.toBe(original);
      expect(rotated.secretPrefix).toBe(fresh.slice(0, 14));

      // Both are live during the overlap; reveal returns them, new one first.
      const revealed = await service.revealSecrets(endpoint.id);
      expect(revealed).toHaveLength(2);
      expect(revealed[0]).toBe(fresh);
      expect(revealed).toContain(original);

      // The lifecycle summary marks exactly one primary and one expiring secret.
      expect(rotated.secrets).toHaveLength(2);
      expect(rotated.secrets.filter(s => s.isPrimary)).toHaveLength(1);
      const overlap = rotated.secrets.find(s => !s.isPrimary);
      expect(overlap?.expiresAt).toBeInstanceOf(Date);
    });

    it("retires the old secret immediately with a zero overlap", async () => {
      const { endpoint, secret: original } = await create();

      const { secret: fresh } = await service.rotateSecret(endpoint.id, {
        overlapSeconds: 0,
      });

      const revealed = await service.revealSecrets(endpoint.id);
      expect(revealed).toEqual([fresh]);
      expect(revealed).not.toContain(original);
    });

    it("never keeps more than two secrets live across repeated rotations", async () => {
      const { endpoint } = await create();
      await service.rotateSecret(endpoint.id, { overlapSeconds: 3600 });
      await service.rotateSecret(endpoint.id, { overlapSeconds: 3600 });
      const { endpoint: latest } = await service.rotateSecret(endpoint.id, {
        overlapSeconds: 3600,
      });

      expect(await service.revealSecrets(endpoint.id)).toHaveLength(2);
      expect(latest.secrets).toHaveLength(2);
    });

    it("rejects an out-of-range overlap window", async () => {
      const { endpoint } = await create();
      await expect(
        service.rotateSecret(endpoint.id, { overlapSeconds: -1 })
      ).rejects.toThrow(NextlyError);
    });

    it("reports an unknown endpoint as not found", async () => {
      await expect(service.rotateSecret("missing")).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("expiring old secrets", () => {
    it("drops the overlapping secret and leaves only the primary", async () => {
      const { endpoint } = await create();
      const { secret: fresh } = await service.rotateSecret(endpoint.id, {
        overlapSeconds: 3600,
      });
      expect(await service.revealSecrets(endpoint.id)).toHaveLength(2);

      const summary = await service.expireOldSecrets(endpoint.id);
      expect(summary.secrets).toHaveLength(1);
      expect(summary.secrets[0]?.isPrimary).toBe(true);
      expect(await service.revealSecrets(endpoint.id)).toEqual([fresh]);
    });
  });
});
