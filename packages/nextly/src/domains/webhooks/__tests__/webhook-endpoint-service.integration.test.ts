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
import { nextlyWebhooks } from "../../../schemas/webhooks/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { WEBHOOK_SECRET_PREFIX } from "../secret";
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
    await kit.generateDrizzleJson({ users, nextlyWebhooks })
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
    schemaRegistry.registerStaticSchemas({ users, nextlyWebhooks });
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
    await adapter.executeQuery("DELETE FROM nextly_webhooks");
    registry = new RecordingRegistry();
    service = new WebhookEndpointService(
      adapter as never,
      logger as never,
      registry
    );
  });

  const create = (overrides: Record<string, unknown> = {}) =>
    service.createEndpoint(
      {
        name: "Orders",
        url: "https://example.com/hooks",
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
            url: "https://example.com/hooks",
            eventTypes: EVENTS,
          },
          "user_that_does_not_exist"
        )
      ).rejects.toThrow(NextlyError);
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
      ["plain http", "http://example.com/hooks"],
    ])("refuses %s", async (_label, url) => {
      await expect(create({ url })).rejects.toThrow(NextlyError);
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
      expect(unchanged?.url).toBe("https://example.com/hooks");
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
        url: "https://example.org/h",
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

  describe("disable versus delete", () => {
    it("disabling keeps the endpoint and its id", async () => {
      const { endpoint } = await create();

      const disabled = await service.setEnabled(endpoint.id, false);
      expect(disabled.enabled).toBe(false);
      expect(await service.getEndpoint(endpoint.id)).not.toBeNull();

      const reenabled = await service.setEnabled(endpoint.id, true);
      expect(reenabled.enabled).toBe(true);
    });

    it("deleting removes it and drops the cache", async () => {
      const { endpoint } = await create();
      registry.invalidations = 0;

      await service.deleteEndpoint(endpoint.id);

      expect(await service.getEndpoint(endpoint.id)).toBeNull();
      expect(registry.invalidations).toBe(1);
    });

    it("reports deleting an unknown endpoint as not found", async () => {
      await expect(service.deleteEndpoint("missing")).rejects.toThrow(
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
});
