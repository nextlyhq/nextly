/**
 * The scheduled drain sweeps notices past the activity log's window.
 *
 * Write paths offer the notices pass capped, and an install that stops
 * writing offers it never; the drain is the trigger that keeps running, so it
 * sweeps notices on a marker of its own, and hands the turn back when its time
 * is already spent.
 */
import { describe, expect, it, vi } from "vitest";

import { resolveAuditRetentionConfig } from "../../audit/retention-config";
import { NOTICES_RETENTION_DRAIN_GATE_KEY } from "../../retention/gate";
import { runDrain } from "../run-drain";

/** A database with no events and no deliveries due, so only retention runs. */
function idleDb(): never {
  return {
    select: async () => [],
    update: async () => [],
    insert: async () => [],
    delete: async () => 0,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(undefined),
  } as never;
}

/** An adapter whose notices table holds one notice past its window. */
function oneOldNotice() {
  let left = 1;
  const tables: string[] = [];
  const remove = vi.fn(async (table: string) => {
    tables.push(`delete:${table}`);
    const removed = table === "nextly_notices" ? left : 0;
    if (table === "nextly_notices") left = 0;
    return removed;
  });
  return {
    tables,
    adapter: {
      select: async (table: string) => {
        tables.push(table);
        return table === "nextly_notices" && left > 0 ? [{ id: "old" }] : [];
      },
      delete: remove,
      transaction: async (
        fn: (tx: { delete: typeof remove }) => Promise<unknown>
      ) => fn({ delete: remove }),
    },
  };
}

function drain(
  retention: Parameters<typeof runDrain>[0]["retention"],
  maxDurationMs?: number
) {
  return runDrain({
    fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
    deliver: { db: idleDb(), now: () => new Date(0) } as never,
    maxDurationMs,
    retention,
  });
}

describe("the scheduled drain and notices", () => {
  it("sweeps notices on its own marker, under the activity log's window", async () => {
    const claimed: string[] = [];
    const store = oneOldNotice();
    const result = await drain({
      auditPolicy: resolveAuditRetentionConfig({ activityMaxAgeMs: 1000 }),
      prune: { adapter: store.adapter } as never,
      gate: {
        claim: async (key: string) => {
          claimed.push(key);
          return true;
        },
        release: async () => undefined,
      },
    });
    expect(claimed).toContain(NOTICES_RETENTION_DRAIN_GATE_KEY);
    expect(store.tables).toContain("delete:nextly_notices");
    expect(result.pruned.notices).toBe(1);
  });

  it("stops pruning a backlog between batches once the drain's time is spent", async () => {
    // A backlog that fills every batch, and a clock that moves a second per
    // reading: the pass must stop at the drain's deadline, not run every batch
    // it was allowed.
    let clock = 0;
    const deletes = vi.fn(async () => 500);
    const result = await runDrain({
      fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
      deliver: {
        db: idleDb(),
        now: () => new Date((clock += 1000)),
      } as never,
      maxDurationMs: 10_000,
      retention: {
        auditPolicy: resolveAuditRetentionConfig({
          activityMaxAgeMs: 1000,
          maxBatchesPerRun: 50,
        }),
        prune: {
          adapter: {
            select: async (table: string) =>
              table === "nextly_notices"
                ? Array.from({ length: 500 }, (_, i) => ({ id: `n${i}` }))
                : [],
            delete: deletes,
          },
        } as never,
        gate: { claim: async () => true, release: async () => undefined },
      },
    });
    expect(deletes.mock.calls.length).toBeLessThan(50);
    expect(result.pruned.notices).toBe(deletes.mock.calls.length * 500);
  });

  it("hands back a notices turn whose share was spent before a batch started", async () => {
    // Earlier passes used the notices pass's share of the time, though not the
    // drain's whole deadline: no notice is queried, so the turn must be given
    // back, or the sweep is held off for a whole interval having done nothing.
    // The clock moves a second per reading; at a 12-second budget the notices
    // share runs out before its first batch while the drain still has time.
    let clock = 0;
    const released: string[] = [];
    const tables: string[] = [];
    await runDrain({
      fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
      deliver: {
        db: idleDb(),
        now: () => new Date((clock += 1000)),
      } as never,
      maxDurationMs: 12_000,
      retention: {
        auditPolicy: resolveAuditRetentionConfig({ activityMaxAgeMs: 1000 }),
        oneTimeSecrets: true,
        prune: {
          adapter: {
            select: async (table: string) => {
              tables.push(table);
              return [];
            },
            delete: async () => 0,
            transaction: async (
              fn: (tx: { delete: () => Promise<number> }) => Promise<unknown>
            ) => fn({ delete: async () => 0 }),
          },
        } as never,
        gate: {
          claim: async () => true,
          release: async (key: string) => {
            released.push(key);
          },
        },
      },
    });
    expect(tables).not.toContain("nextly_notices");
    expect(released).toContain(NOTICES_RETENTION_DRAIN_GATE_KEY);
  });

  it("leaves notices alone when the activity log keeps everything", async () => {
    const claimed: string[] = [];
    const result = await drain({
      auditPolicy: resolveAuditRetentionConfig({ activityMaxAgeMs: false }),
      prune: { adapter: oneOldNotice().adapter } as never,
      gate: {
        claim: async (key: string) => {
          claimed.push(key);
          return true;
        },
        release: async () => undefined,
      },
    });
    expect(claimed).not.toContain(NOTICES_RETENTION_DRAIN_GATE_KEY);
    expect(result.pruned.notices).toBe(0);
  });
});
