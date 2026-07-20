/**
 * Retention pruning — the safety rules and the bounds.
 *
 * Driven through a fake adapter so the batching, the live-delivery guard, and
 * the pass budget can be pinned without a database. Dialect behaviour is
 * covered by the integration suite.
 */
import { describe, expect, it, vi } from "vitest";

import { pruneWebhookData, pruneWebhookDataSafely } from "../prune";
import { resolveWebhookRetentionConfig } from "../retention-config";

interface SelectCall {
  table: string;
  where?: { and: { column: string; op: string; value?: unknown }[] };
  limit?: number;
  offset?: number;
}

/**
 * A fake adapter driven by scripted select results. Records every call so tests
 * can assert on the predicates the engine builds, not just its return value.
 */
function fakeAdapter(script: {
  events?: string[][];
  deliveries?: string[][];
  liveEventIds?: string[];
  /** Whether an enabled endpoint exists; drives the fan-out requirement. */
  hasEndpoint?: boolean;
}) {
  const selects: SelectCall[] = [];
  const deletes: { table: string; ids: unknown }[] = [];
  const events = [...(script.events ?? [])];
  const deliveries = [...(script.deliveries ?? [])];

  return {
    selects,
    deletes,
    adapter: {
      select: async <T>(table: string, options?: SelectCall): Promise<T[]> => {
        selects.push({
          table,
          where: options?.where,
          limit: options?.limit,
          offset: options?.offset,
        });
        if (table === "nextly_webhooks") {
          return (script.hasEndpoint ? [{ id: "wh1" }] : []) as T[];
        }
        const isLiveLookup =
          table === "nextly_webhook_deliveries" &&
          options?.where?.and.some(c => c.column === "eventId");
        if (isLiveLookup) {
          return (script.liveEventIds ?? []).map(id => ({
            eventId: id,
          })) as T[];
        }
        const queue = table === "nextly_events" ? events : deliveries;
        return ((queue.shift() ?? []).map(id => ({ id })) as T[]) ?? [];
      },
      delete: async (
        table: string,
        where: { and: { column: string; value?: unknown }[] }
      ): Promise<number> => {
        const ids = where.and[0]?.value;
        deletes.push({ table, ids });
        return Array.isArray(ids) ? ids.length : 0;
      },
    },
  };
}

const policy = () =>
  resolveWebhookRetentionConfig({ batchSize: 2, maxBatchesPerRun: 10 })!;

describe("pruneWebhookData", () => {
  it("never deletes an event whose fan-out has not run", async () => {
    // fanned_out_at IS NULL means the event still needs fan-out; deleting one
    // would discard an event nobody ever delivered.
    const f = fakeAdapter({ events: [["e1"]], hasEndpoint: true });
    await pruneWebhookData({ adapter: f.adapter }, policy());

    const eventSelect = f.selects.find(s => s.table === "nextly_events");
    expect(eventSelect?.where?.and).toContainEqual({
      column: "fannedOutAt",
      op: "IS NOT NULL",
    });
  });

  it("never deletes an event that still has a live delivery", async () => {
    // The delivery FK cascades, so deleting the event would silently take a
    // pending or retrying delivery with it.
    const f = fakeAdapter({
      events: [["e1", "e2"]],
      liveEventIds: ["e1"],
      hasEndpoint: true,
    });
    const result = await pruneWebhookData({ adapter: f.adapter }, policy());

    const eventDeletes = f.deletes.filter(d => d.table === "nextly_events");
    expect(eventDeletes).toHaveLength(1);
    expect(eventDeletes[0].ids).toEqual(["e2"]);
    expect(result.events.webhook).toBe(1);
  });

  it("requires a completed fan-out only when an endpoint could receive it", async () => {
    const withEndpoint = fakeAdapter({ events: [["e1"]], hasEndpoint: true });
    await pruneWebhookData({ adapter: withEndpoint.adapter }, policy());
    expect(
      withEndpoint.selects
        .find(s => s.table === "nextly_events")
        ?.where?.and.some(c => c.column === "fannedOutAt")
    ).toBe(true);
  });

  it("prunes un-fanned-out events when no endpoint exists at all", async () => {
    // The case retention exists for. With no endpoint the drain never runs, so
    // fanned_out_at stays NULL forever — demanding it would delete nothing in
    // exactly the installs that grow unbounded.
    const noEndpoint = fakeAdapter({ events: [["e1"]], hasEndpoint: false });
    const result = await pruneWebhookData(
      { adapter: noEndpoint.adapter },
      policy()
    );

    expect(
      noEndpoint.selects
        .find(s => s.table === "nextly_events")
        ?.where?.and.some(c => c.column === "fannedOutAt")
    ).toBe(false);
    expect(result.events.webhook).toBe(1);
  });

  it("prunes only terminal deliveries, so it cannot race the drain", async () => {
    const f = fakeAdapter({ deliveries: [["d1"]] });
    await pruneWebhookData({ adapter: f.adapter }, policy());

    const statusCondition = f.selects
      .find(
        s =>
          s.table === "nextly_webhook_deliveries" &&
          s.where?.and.some(c => c.column === "status")
      )
      ?.where?.and.find(c => c.column === "status");
    expect(statusCondition?.value).toEqual(["delivered", "failed"]);
  });

  it("stops at the batch budget and reports the pass as truncated", async () => {
    // Full batches every time: there is always more to do, so the bound is what
    // ends the pass. This is what keeps one pass short on a serverless request.
    const f = fakeAdapter({
      deliveries: Array.from({ length: 20 }, (_, i) => [`d${i}a`, `d${i}b`]),
    });
    const bounded = resolveWebhookRetentionConfig({
      batchSize: 2,
      maxBatchesPerRun: 3,
    })!;
    const result = await pruneWebhookData({ adapter: f.adapter }, bounded);

    expect(result.batches).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.deliveries).toBe(6);
  });

  it("scans past blocked rows instead of stopping at them", async () => {
    // A batch-sized wall of stuck deliveries must not hide the younger eligible
    // rows behind it. The cursor steps over what it cannot delete, while deleted
    // rows leave the table — so the blocked pair stays at the front and the
    // offset lands past exactly them.
    let table = ["blocked1", "blocked2", "free1", "free2"];
    const offsets: (number | undefined)[] = [];
    const deletes: unknown[] = [];

    const adapter = {
      select: async <T>(t: string, options?: SelectCall): Promise<T[]> => {
        if (t === "nextly_webhooks") return [{ id: "wh1" }] as T[];
        if (
          t === "nextly_webhook_deliveries" &&
          options?.where?.and.some(c => c.column === "eventId")
        ) {
          const ids = options.where.and[0].value as string[];
          return ids
            .filter(id => id.startsWith("blocked"))
            .map(id => ({ eventId: id })) as T[];
        }
        if (t === "nextly_events") {
          offsets.push(options?.offset);
          const from = options?.offset ?? 0;
          return table
            .slice(from, from + (options?.limit ?? table.length))
            .map(id => ({ id })) as T[];
        }
        return [] as T[];
      },
      delete: async (
        _t: string,
        where: { and: { value?: unknown }[] }
      ): Promise<number> => {
        const ids = where.and[0]?.value as string[];
        deletes.push(ids);
        table = table.filter(id => !ids.includes(id));
        return ids.length;
      },
    };

    const result = await pruneWebhookData({ adapter }, policy());

    expect(deletes).toEqual([["free1", "free2"]]);
    expect(result.events.webhook).toBe(2);
    // Second read starts past the blocked pair; the third finds nothing left.
    expect(offsets.slice(0, 3)).toEqual([0, 2, 2]);
    expect(table).toEqual(["blocked1", "blocked2"]);
  });

  it("skips a class configured to be kept forever", async () => {
    const f = fakeAdapter({ events: [["e1"]] });
    const keepEvents = resolveWebhookRetentionConfig({
      eventsMaxAgeMs: false,
      auditEventsMaxAgeMs: false,
      deliveriesMaxAgeMs: false,
    })!;
    const result = await pruneWebhookData({ adapter: f.adapter }, keepEvents);

    expect(f.selects).toHaveLength(0);
    expect(result.batches).toBe(0);
  });

  it("counts without deleting in dry-run", async () => {
    const f = fakeAdapter({ events: [["e1", "e2"]] });
    const result = await pruneWebhookData({ adapter: f.adapter }, policy(), {
      dryRun: true,
    });

    expect(result.events.webhook).toBe(2);
    expect(f.deletes).toHaveLength(0);
  });

  it("applies the cutoff from the injected clock", async () => {
    const f = fakeAdapter({ events: [["e1"]] });
    const now = new Date("2026-07-21T00:00:00.000Z");
    await pruneWebhookData(
      { adapter: f.adapter, now: () => now },
      resolveWebhookRetentionConfig({ eventsMaxAgeMs: 1000, batchSize: 2 })!
    );

    const cutoff = f.selects
      .find(s => s.table === "nextly_events")
      ?.where?.and.find(c => c.column === "createdAt")?.value;
    expect(cutoff).toEqual(new Date(now.getTime() - 1000));
  });
});

describe("pruneWebhookDataSafely", () => {
  it("swallows a failure so a content write is never turned into an error", async () => {
    // Retention is housekeeping. Versions deliberately fail the write when their
    // prune fails, because a violated cap is a correctness bug; an untidy event
    // ledger is not.
    const warn = vi.fn();
    const exploding = {
      select: async () => {
        throw new Error("connection reset");
      },
      delete: async () => 0,
    };

    const result = await pruneWebhookDataSafely(
      { adapter: exploding, logger: { warn } as never },
      policy()
    );

    expect(result.deliveries).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
