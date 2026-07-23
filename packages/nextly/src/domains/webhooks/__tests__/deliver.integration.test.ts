/**
 * Integration test for the webhook delivery engine (`deliverDueDeliveries` and
 * `runDrain`) against a real SQLite database. Exercises the full claim -> sign
 * -> send -> record path: a leased claim, Standard Webhooks signature headers on
 * the outgoing request, and each terminal outcome (delivered / retrying / failed
 * / exhausted), plus the lease guard and an end-to-end drain from a seeded event.
 *
 * Uses an in-memory SQLite database built from the production table definitions
 * via drizzle-kit (never hand-copied CREATE TABLE; see
 * .claude/rules/integration-tests.md). The HTTP transport and clock are injected
 * so outcomes are deterministic and no real network access happens.
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
import { deliverDueDeliveries, type DeliverTransport } from "../deliver";
import { runDrain } from "../run-drain";
import { verifySignature } from "../signing";
import { DEFAULT_MAX_ATTEMPTS } from "../delivery-policy";
import type { WebhookEventType } from "../types";

process.env.DB_DIALECT = "sqlite";

// A frozen clock so due-ness, lease windows, and retry scheduling are stable.
const NOW = new Date("2026-07-19T12:00:00.000Z");
// A valid Standard Webhooks secret: `whsec_` + base64 key bytes. Built at
// runtime from a low-entropy source so the literal does not trip secret
// scanners (this is a test fixture, not a real credential).
const SECRET = `whsec_${Buffer.from("secretkey").toString("base64")}`;

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

/** A fake transport that records each request and returns a fixed HTTP status. */
function makeTransport(status: number): {
  transport: DeliverTransport;
  calls: Array<{ url: string; headers: Record<string, string>; body: string }>;
} {
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }> = [];
  const transport: DeliverTransport = async (url, options) => {
    calls.push({ url, headers: options.headers, body: options.body });
    return new Response("ok", { status });
  };
  return { transport, calls };
}

describe("webhook delivery engine (real SQLite)", () => {
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

  async function seedWebhook(
    id: string,
    opts: {
      secrets?: string[];
      headers?: Record<string, string> | null;
      eventTypes?: WebhookEventType[];
    } = {}
  ): Promise<void> {
    await adapter.insert("nextly_webhooks", {
      id,
      name: id,
      url: `https://example.com/${id}`,
      enabled: true,
      event_types: opts.eventTypes ?? ["entry.updated"],
      filter: null,
      headers: opts.headers ?? null,
      secret_hash: opts.secrets ?? [SECRET],
      secret_prefix: "whsec_",
      field_allowlist: null,
      created_by: null,
      // Well before the seeded event time so the pre-subscription guard admits it.
      created_at: new Date("2020-01-01T00:00:00.000Z"),
      updated_at: NOW,
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

  async function seedDelivery(
    id: string,
    webhookId: string,
    eventId: string,
    opts: {
      status?: string;
      attemptCount?: number;
      nextAttemptAt?: Date | null;
      lockedUntil?: Date | null;
    } = {}
  ): Promise<void> {
    await adapter.insert("nextly_webhook_deliveries", {
      id,
      webhook_id: webhookId,
      event_id: eventId,
      status: opts.status ?? "pending",
      attempt_count: opts.attemptCount ?? 0,
      next_attempt_at:
        opts.nextAttemptAt === undefined ? NOW : opts.nextAttemptAt,
      locked_by: null,
      locked_until: opts.lockedUntil ?? null,
      created_at: NOW,
      updated_at: NOW,
    });
  }

  interface DeliveryReadRow {
    id: string;
    status: string;
    attemptCount: number;
    nextAttemptAt: Date | null;
    lockedBy: string | null;
    lockedUntil: Date | null;
    lastStatusCode: number | null;
    lastError: string | null;
  }

  async function getDelivery(id: string): Promise<DeliveryReadRow> {
    const rows = await adapter.select<DeliveryReadRow>(
      "nextly_webhook_deliveries",
      { where: { and: [{ column: "id", op: "=", value: id }] } }
    );
    return rows[0];
  }

  function deps(transport: DeliverTransport, overrides = {}) {
    return {
      db: adapter,
      decryptSecret: (ciphertext: string) => ciphertext,
      transport,
      now: () => NOW,
      runnerId: "runner-test",
      ...overrides,
    };
  }

  it("does not clobber a delivery whose lease was handed off mid-attempt", async () => {
    await seedWebhook("wh_a");
    await seedEvent("evt_1");
    await seedDelivery("dlv_1", "wh_a", "evt_1");

    // Simulate an overrun: while this worker's request is in flight, its lease is
    // handed off (a redelivery re-arm clears `locked_by` and resets the row).
    // The claim set `locked_by = "runner-test"`, so the finalize below is fenced
    // on that owner and must not overwrite the re-armed state.
    const stealing: DeliverTransport = async () => {
      await adapter.update(
        "nextly_webhook_deliveries",
        { locked_by: null, status: "pending", attempt_count: 0 },
        { and: [{ column: "id", op: "=", value: "dlv_1" }] }
      );
      return new Response("ok", { status: 200 });
    };

    const result = await deliverDueDeliveries(deps(stealing));

    // The stale finalize matched nothing: the row keeps its re-armed state
    // rather than being overwritten with the in-flight attempt's "delivered".
    const row = await getDelivery("dlv_1");
    expect(row.status).toBe("pending");
    expect(row.lockedBy).toBeNull();
    expect(row.attemptCount).toBe(0);

    // The dropped outcome is counted as abandoned, never as a committed
    // delivered — the drain must not over-report progress the ledger never got.
    expect(result).toMatchObject({
      attempted: 1,
      delivered: 0,
      abandoned: 1,
    });
  });

  it("delivers a 2xx response and signs the request with Standard Webhooks headers", async () => {
    await seedWebhook("wh_a");
    await seedEvent("evt_1");
    await seedDelivery("dlv_1", "wh_a", "evt_1");
    const { transport, calls } = makeTransport(200);

    const result = await deliverDueDeliveries(deps(transport));

    expect(result).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });
    const row = await getDelivery("dlv_1");
    expect(row.status).toBe("delivered");
    expect(row.attemptCount).toBe(1);
    expect(row.nextAttemptAt).toBeNull();
    // The lease is released once the row is finalized.
    expect(row.lockedUntil).toBeNull();
    expect(row.lockedBy).toBeNull();
    expect(row.lastStatusCode).toBe(200);

    // The outgoing request carried the three Standard Webhooks headers plus JSON
    // content-type, and the signature verifies against the (identity-decrypted)
    // secret over the exact body that was sent.
    expect(calls).toHaveLength(1);
    const { headers, body } = calls[0];
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["webhook-id"]).toBe("dlv_1");
    expect(headers["webhook-timestamp"]).toMatch(/^\d+$/);
    expect(headers["webhook-signature"]).toMatch(/^v1,/);
    expect(
      verifySignature({
        id: "dlv_1",
        timestamp: headers["webhook-timestamp"],
        body,
        signatureHeader: headers["webhook-signature"],
        secrets: [SECRET],
        toleranceSeconds: Infinity,
      })
    ).toBe(true);
  });

  it("reschedules a 5xx response for a retry (transient)", async () => {
    await seedWebhook("wh_a");
    await seedEvent("evt_1");
    await seedDelivery("dlv_1", "wh_a", "evt_1");
    const { transport } = makeTransport(503);

    const result = await deliverDueDeliveries(deps(transport));

    expect(result).toMatchObject({ attempted: 1, retried: 1, delivered: 0 });
    const row = await getDelivery("dlv_1");
    expect(row.status).toBe("retrying");
    expect(row.attemptCount).toBe(1);
    expect(row.nextAttemptAt).not.toBeNull();
    // The next attempt is scheduled no earlier than now (jittered backoff >= 0).
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    expect(row.lockedUntil).toBeNull();
    expect(row.lastStatusCode).toBe(503);
  });

  it("permanently fails a 4xx response (receiver must fix it)", async () => {
    await seedWebhook("wh_a");
    await seedEvent("evt_1");
    await seedDelivery("dlv_1", "wh_a", "evt_1");
    const { transport } = makeTransport(404);

    const result = await deliverDueDeliveries(deps(transport));

    expect(result).toMatchObject({ attempted: 1, failed: 1, retried: 0 });
    const row = await getDelivery("dlv_1");
    expect(row.status).toBe("failed");
    expect(row.attemptCount).toBe(1);
    expect(row.nextAttemptAt).toBeNull();
    expect(row.lastStatusCode).toBe(404);
    expect(row.lastError).toContain("404");
  });

  it("marks a transient outcome failed once the attempt limit is reached", async () => {
    await seedWebhook("wh_a");
    await seedEvent("evt_1");
    // One short of the cap and retrying, so this attempt reaches DEFAULT_MAX_ATTEMPTS.
    await seedDelivery("dlv_1", "wh_a", "evt_1", {
      status: "retrying",
      attemptCount: DEFAULT_MAX_ATTEMPTS - 1,
    });
    const { transport } = makeTransport(503);

    const result = await deliverDueDeliveries(deps(transport));

    expect(result).toMatchObject({ attempted: 1, failed: 1, retried: 0 });
    const row = await getDelivery("dlv_1");
    expect(row.status).toBe("failed");
    expect(row.attemptCount).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(row.nextAttemptAt).toBeNull();
    expect(row.lastError).toContain("exhausted");
  });

  it("does not claim a delivery that is leased within the lease window", async () => {
    await seedWebhook("wh_a");
    await seedEvent("evt_1");
    // Locked by another runner until well after now: the drain must skip it.
    await seedDelivery("dlv_1", "wh_a", "evt_1", {
      lockedUntil: new Date(NOW.getTime() + 60_000),
    });
    const { transport, calls } = makeTransport(200);

    const result = await deliverDueDeliveries(deps(transport));

    expect(result.attempted).toBe(0);
    expect(calls).toHaveLength(0);
    const row = await getDelivery("dlv_1");
    // Untouched: still pending, no attempt recorded.
    expect(row.status).toBe("pending");
    expect(row.attemptCount).toBe(0);
  });

  it("marks a delivery for a webhook with no signing secret failed without sending", async () => {
    // A webhook with an empty secret list can never be signed, so the delivery
    // is a permanent misconfiguration and must fail without a network attempt.
    await seedWebhook("wh_a", { secrets: [] });
    await seedEvent("evt_1");
    await seedDelivery("dlv_1", "wh_a", "evt_1");
    const { transport, calls } = makeTransport(200);

    const result = await deliverDueDeliveries(deps(transport));

    expect(result).toMatchObject({ attempted: 1, failed: 1 });
    expect(calls).toHaveLength(0);
    const row = await getDelivery("dlv_1");
    expect(row.status).toBe("failed");
    expect(row.lastError).toContain("no signing secret");
  });

  it("stops delivering to an endpoint that was disabled after the row was queued", async () => {
    // Disabling only removes an endpoint from fan-out, so a row queued before
    // it happened — or a retry scheduled by an earlier failure — would still be
    // due. Without a check at send time, disabling would keep POSTing until the
    // row succeeded or exhausted its attempts.
    // Ordered deliberately: the endpoint is enabled while the delivery is
    // queued and only disabled afterwards, which is the sequence that actually
    // happens. Seeding it disabled would only prove a delivery is never created
    // for an endpoint that was already off.
    await seedWebhook("wh_a");
    await seedEvent("evt_1");
    await seedDelivery("dlv_1", "wh_a", "evt_1", {
      status: "retrying",
      attemptCount: 1,
    });
    await adapter.update(
      "nextly_webhooks",
      { enabled: false },
      { and: [{ column: "id", op: "=", value: "wh_a" }] }
    );
    const { transport, calls } = makeTransport(200);

    const result = await deliverDueDeliveries(deps(transport));

    expect(result).toMatchObject({ attempted: 1, failed: 1 });
    expect(calls).toHaveLength(0);
    const row = await getDelivery("dlv_1");
    expect(row.status).toBe("failed");
    expect(row.lastError).toContain("webhook disabled");
    // Terminal, not held: re-enabling must not later release a burst of events
    // the receiver has stopped expecting.
    expect(row.nextAttemptAt).toBeNull();
  });

  it("records an unexpected mid-attempt throw as a transient failure without escaping the batch", async () => {
    // `whsec_` with no key bytes decrypts (identity) to an empty key, which makes
    // buildSignatureHeaders throw mid-attempt — not one of the pre-checked
    // undeliverable conditions. The per-candidate boundary must record it and
    // release the lease so the drain is not aborted and the row cannot poison-loop.
    await seedWebhook("wh_a", { secrets: ["whsec_"] });
    await seedEvent("evt_1");
    await seedDelivery("dlv_1", "wh_a", "evt_1");
    const { transport, calls } = makeTransport(200);

    const result = await deliverDueDeliveries(deps(transport));

    expect(result.attempted).toBe(1);
    // Recorded as an outcome, not thrown out of the drain.
    expect(result.retried + result.failed).toBe(1);
    expect(calls).toHaveLength(0); // never reached the network
    const row = await getDelivery("dlv_1");
    expect(["retrying", "failed"]).toContain(row.status);
    // The attempt advanced, so a persistently-throwing row eventually exhausts.
    expect(row.attemptCount).toBe(1);
    // The lease is released, not stranded.
    expect(row.lockedUntil).toBeNull();
  });

  it("runs a full drain: fans out a seeded event and delivers it", async () => {
    await seedWebhook("wh_a");
    await seedEvent("evt_1");
    const { transport, calls } = makeTransport(200);

    const registry = new WebhookEndpointRegistry(adapter);
    const result = await runDrain({
      fanOut: {
        db: adapter,
        loadEndpoints: () => registry.getEnabledEndpoints(),
        now: () => NOW,
      },
      deliver: deps(transport),
    });

    expect(result).toMatchObject({
      eventsProcessed: 1,
      deliveriesCreated: 1,
      attempted: 1,
      delivered: 1,
    });
    expect(calls).toHaveLength(1);
    const rows = await adapter.select<{ status: string }>(
      "nextly_webhook_deliveries"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("delivered");
  });
});
