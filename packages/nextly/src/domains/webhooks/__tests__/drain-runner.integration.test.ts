/**
 * Integration test for `runWebhookDrain` — the drain wiring that assembles the
 * fan-out + delivery deps from a live adapter and the shared endpoint registry.
 *
 * Proves the assembled drain fans a seeded event out into a delivery and fires
 * it through the transport (i.e. `loadEndpoints` reads the registry and the
 * secret is decrypted), and that with no endpoints it is a no-op. Uses an
 * in-memory SQLite database built from the production table definitions.
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
import type { DeliverTransport } from "../deliver";
import { WebhookEndpointRegistry } from "../endpoint-registry";
import { buildEnvelope } from "../envelope";
import { recordEvent } from "../record-event";
import type { ResolvedWebhookRetentionConfig } from "../retention-config";
import type { RetentionGateStore } from "../retention-gate";
import { runWebhookDrain } from "../drain-runner";

process.env.DB_DIALECT = "sqlite";

const NOW = new Date("2026-07-19T12:00:00.000Z");
// A Standard Webhooks secret shape; stored verbatim here because the test
// injects an identity `decryptSecret`, so no NEXTLY_SECRET is needed.
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

function makeTransport(status: number): {
  transport: DeliverTransport;
  calls: Array<{ url: string }>;
} {
  const calls: Array<{ url: string }> = [];
  const transport: DeliverTransport = async url => {
    calls.push({ url });
    return new Response("ok", { status });
  };
  return { transport, calls };
}

describe("runWebhookDrain (real SQLite)", () => {
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
      // Before the event time so the pre-subscription cutoff admits it.
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

  function registryOf(): WebhookEndpointRegistry {
    return new WebhookEndpointRegistry(adapter);
  }

  it("fans out a seeded event and delivers it", async () => {
    await seedWebhook("wh1");
    await seedEvent("evt_a");
    const { transport, calls } = makeTransport(200);

    const result = await runWebhookDrain(adapter, registryOf(), {
      transport,
      now: () => NOW,
      decryptSecret: ct => ct,
    });

    expect(result.deliveriesCreated).toBe(1);
    expect(result.delivered).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.com/wh1");
  });

  it("bounds one invocation to the batch and resumes on the next", async () => {
    // A latency-bounded trigger (a cron tick) caps its work so a single request
    // stays within its platform limit; the durable outbox lets the next tick
    // finish the rest. Three due deliveries, a batch of two and a single round:
    // exactly two are attempted now and the third waits.
    await seedWebhook("wh1");
    await seedEvent("evt_1");
    await seedEvent("evt_2");
    await seedEvent("evt_3");
    const { transport, calls } = makeTransport(200);

    const first = await runWebhookDrain(adapter, registryOf(), {
      transport,
      now: () => NOW,
      decryptSecret: ct => ct,
      maxRounds: 1,
      deliverBatchSize: 2,
    });

    // The round fans every due event out, but delivery is capped at the batch.
    expect(first.deliveriesCreated).toBe(3);
    expect(first.attempted).toBe(2);
    expect(calls).toHaveLength(2);

    const second = await runWebhookDrain(adapter, registryOf(), {
      transport,
      now: () => NOW,
      decryptSecret: ct => ct,
      deliverBatchSize: 2,
    });

    // The next tick delivers the remaining one; nothing is lost or double-sent.
    expect(second.delivered).toBe(1);
    expect(calls).toHaveLength(3);
  });

  it("runs the retention pass when a policy is supplied", async () => {
    // The cron trigger is the only prune trigger a write-quiescent install has,
    // so a supplied retention policy must reach the gate. A stub gate that
    // declines the claim isolates this to "the drain consulted retention" — the
    // prune effect itself is covered by the prune/gate/config suites.
    await seedWebhook("wh1");
    await seedEvent("evt_r");
    const { transport } = makeTransport(200);

    let claims = 0;
    const gate: RetentionGateStore = {
      claim: async () => {
        claims += 1;
        return false;
      },
    };
    const policy: ResolvedWebhookRetentionConfig = {
      eventsMaxAgeMs: 1,
      auditEventsMaxAgeMs: 1,
      deliveriesMaxAgeMs: 1,
      batchSize: 50,
      maxBatchesPerRun: 5,
      intervalMs: 1000,
    };

    const result = await runWebhookDrain(adapter, registryOf(), {
      transport,
      now: () => NOW,
      decryptSecret: ct => ct,
      retention: { policy, prune: { adapter, now: () => NOW }, gate },
    });

    // The gate was consulted exactly once (after the queue quiesced); the
    // declined claim leaves nothing pruned this call.
    expect(claims).toBe(1);
    expect(result.pruned).toEqual({ events: 0, deliveries: 0 });
  });

  it("skips retention when no policy is supplied", async () => {
    // Without a policy the drain must not touch the gate at all.
    await seedWebhook("wh1");
    await seedEvent("evt_n");
    const { transport } = makeTransport(200);

    const result = await runWebhookDrain(adapter, registryOf(), {
      transport,
      now: () => NOW,
      decryptSecret: ct => ct,
    });

    expect(result.pruned).toEqual({ events: 0, deliveries: 0 });
  });

  it("is a no-op when there are no endpoints", async () => {
    await seedEvent("evt_b");
    const { transport, calls } = makeTransport(200);

    const result = await runWebhookDrain(adapter, registryOf(), {
      transport,
      now: () => NOW,
      decryptSecret: ct => ct,
    });

    // The event is marked fanned out, but with no subscriber no delivery is
    // created and nothing is sent.
    expect(result.deliveriesCreated).toBe(0);
    expect(result.delivered).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
