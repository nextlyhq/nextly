/**
 * Integration test for `WebhookFastDrainScheduler` — the post-response drain
 * fast path.
 *
 * Proves the gate: it schedules a drain (through an injected `after()`) only when
 * `after()` is available AND an endpoint is enabled, and the scheduled work
 * actually fans out and delivers the seeded event. Uses an in-memory SQLite
 * database and a captured `after()` so the callback can be run deterministically.
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
import { WebhookFastDrainScheduler } from "../after-drain";
import type { DeliverTransport } from "../deliver";
import type { RunWebhookDrainOptions } from "../drain-runner";
import { WebhookEndpointRegistry } from "../endpoint-registry";
import { buildEnvelope } from "../envelope";
import { recordEvent } from "../record-event";

process.env.DB_DIALECT = "sqlite";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const SECRET = `whsec_${Buffer.from("secretkey").toString("base64")}`;

const tables = { nextlyEvents, nextlyWebhooks, nextlyWebhookDeliveries };
const ddlTables = { ...tables, users };

async function schemaDdl(): Promise<string[]> {
  const kit = await getSQLiteDrizzleKit();
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson(ddlTables)
  );
  return splitStatements(statements);
}

/** A captured `after()`: records callbacks so a test can run them by hand. */
function captureAfter(): {
  after: (cb: () => void | Promise<void>) => void;
  scheduled: Array<() => void | Promise<void>>;
} {
  const scheduled: Array<() => void | Promise<void>> = [];
  return { after: cb => scheduled.push(cb), scheduled };
}

describe("WebhookFastDrainScheduler (real SQLite)", () => {
  let adapter: ReturnType<typeof createSqliteAdapter>;

  beforeAll(async () => {
    adapter = createSqliteAdapter({ memory: true });
    await adapter.connect();
    for (const stmt of await schemaDdl()) await adapter.executeQuery(stmt);

    const schemaRegistry = new SchemaRegistry("sqlite");
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

  async function seedWebhook(id: string): Promise<void> {
    await adapter.insert("nextly_webhooks", {
      id,
      name: id,
      url: `https://example.com/${id}`,
      enabled: true,
      event_types: ["entry.updated"],
      filter: null,
      headers: null,
      secret_hash: [SECRET],
      secret_prefix: "whsec_",
      field_allowlist: null,
      created_by: null,
      created_at: new Date("2020-01-01T00:00:00.000Z"),
      updated_at: NOW,
    });
  }

  async function seedEvent(id: string): Promise<void> {
    const envelope = buildEnvelope({
      id,
      type: "entry.updated",
      timestamp: new Date("2026-07-18T00:00:00.000Z"),
      resource: { kind: "entry", collection: "posts", id: "p1" },
      data: { id: "p1", title: "Hello" },
    });
    await adapter.transaction(async tx => recordEvent(tx, { envelope }));
  }

  function makeTransport(): {
    transport: DeliverTransport;
    calls: string[];
  } {
    const calls: string[] = [];
    return {
      calls,
      transport: async url => {
        calls.push(url);
        return new Response("ok", { status: 200 });
      },
    };
  }

  function drainOptions(transport: DeliverTransport): RunWebhookDrainOptions {
    return { transport, now: () => NOW, decryptSecret: ct => ct };
  }

  it("schedules a drain that delivers the event when after() and an endpoint exist", async () => {
    await seedWebhook("wh1");
    await seedEvent("evt_a");
    const { transport, calls } = makeTransport();
    const { after, scheduled } = captureAfter();

    const scheduler = new WebhookFastDrainScheduler(
      adapter,
      new WebhookEndpointRegistry(adapter),
      undefined,
      () => after,
      drainOptions(transport)
    );

    await scheduler.offer();

    // The gate passed: exactly one drain was scheduled to run after the response.
    expect(scheduled).toHaveLength(1);
    // Nothing delivered yet — after() work runs post-response.
    expect(calls).toHaveLength(0);

    // Run the scheduled callback: it drains and delivers.
    await scheduled[0]();
    expect(calls).toEqual(["https://example.com/wh1"]);
  });

  it("does not schedule when no endpoint is enabled", async () => {
    await seedEvent("evt_b");
    const { transport } = makeTransport();
    const { after, scheduled } = captureAfter();

    const scheduler = new WebhookFastDrainScheduler(
      adapter,
      new WebhookEndpointRegistry(adapter),
      undefined,
      () => after,
      drainOptions(transport)
    );

    await scheduler.offer();

    expect(scheduled).toHaveLength(0);
  });

  it("does not schedule when after() is unavailable (non-Next runtime)", async () => {
    await seedWebhook("wh1");
    await seedEvent("evt_c");
    const { transport } = makeTransport();
    const { scheduled } = captureAfter();

    const scheduler = new WebhookFastDrainScheduler(
      adapter,
      new WebhookEndpointRegistry(adapter),
      undefined,
      // No after() in this runtime → the scheduled drain delivers instead.
      () => null,
      drainOptions(transport)
    );

    await scheduler.offer();

    // Even with an endpoint, nothing is scheduled through the (absent) after().
    expect(scheduled).toHaveLength(0);
  });
});
