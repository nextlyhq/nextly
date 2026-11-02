/**
 * Opportunistic retention passes.
 *
 * The runner is what content writes call. It decides whether a pass is due, and
 * how large a pass the caller is willing to wait for — the write path awaits its
 * pass, so the budget it passes is what bounds a user's save.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { resolveWebhookRetentionConfig } from "../../webhooks/retention-config";
import { buildRetentionRunner } from "../passes";
import { RetentionRunner } from "../runner";

const T0 = new Date("2026-07-21T12:00:00.000Z");

/**
 * A transaction for a double: the work runs on the double itself, as a batch
 * here only reads and deletes through it.
 */
function inline(
  db: object
): <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T> {
  return work => work(db as TransactionContext);
}

/**
 * The cache tag expiry ledger's part of an adapter, on a database without its
 * table: these runners take no ledger pass, and one that did would ask the
 * catalogue and stop there.
 */
const withoutLedger = {
  getCapabilities: () => ({ dialect: "sqlite" as const }),
  tableExists: async () => false,
  getDrizzle: () => {
    throw new Error("the ledger's table is not in this test");
  },
} as const;

/** Records the policy each pass ran with, so the budget is observable. */
function spyAdapter() {
  const limits: (number | undefined)[] = [];
  const db = {
    select: async <T>(
      _t: string,
      options?: { limit?: number }
    ): Promise<T[]> => {
      limits.push(options?.limit);
      return [] as T[];
    },
    delete: async (): Promise<number> => 0,
  };
  return {
    limits,
    adapter: { ...db, ...withoutLedger, transaction: inline(db) },
  };
}

function alwaysClaims() {
  return { claim: async (): Promise<boolean> => true };
}

describe("RetentionRunner", () => {
  it("runs a pass when the gate lets it through", async () => {
    const f = spyAdapter();
    const runner = buildRetentionRunner({
      webhookPolicy: resolveWebhookRetentionConfig({}),
      adapter: f.adapter,
      gate: alwaysClaims(),
      now: () => T0,
    });

    await runner!.maybeRun();
    expect(f.limits.length).toBeGreaterThan(0);
  });

  it("does not consult the gate again inside the same interval", async () => {
    // The in-process guard is what keeps the common case free: a busy site must
    // not pay a database round trip on every write just to be told "not yet".
    const gate = { claim: vi.fn(async () => true) };
    const runner = buildRetentionRunner({
      webhookPolicy: resolveWebhookRetentionConfig({ intervalMs: 60_000 }),
      adapter: spyAdapter().adapter,
      gate,
      now: () => T0,
    });

    await runner!.maybeRun();
    await runner!.maybeRun();
    await runner!.maybeRun();

    expect(gate.claim).toHaveBeenCalledTimes(1);
  });

  it("consults the gate again once the interval has elapsed", async () => {
    const gate = { claim: vi.fn(async () => true) };
    let now = T0;
    const runner = buildRetentionRunner({
      webhookPolicy: resolveWebhookRetentionConfig({ intervalMs: 60_000 }),
      adapter: spyAdapter().adapter,
      gate,
      now: () => now,
    });

    await runner!.maybeRun();
    now = new Date(T0.getTime() + 60_001);
    await runner!.maybeRun();

    expect(gate.claim).toHaveBeenCalledTimes(2);
  });

  it("caps the pass to the batch budget the caller asks for", async () => {
    // The write path awaits its pass, so this is what bounds a user's save. A
    // caller that passes nothing gets the policy's full budget.
    const f = spyAdapter();
    const runner = buildRetentionRunner({
      webhookPolicy: resolveWebhookRetentionConfig({ batchSize: 7 }),
      adapter: f.adapter,
      gate: alwaysClaims(),
      now: () => T0,
    });

    await runner!.maybeRun(1);
    // One batch attempt per table/class, none of them repeated.
    expect(f.limits.every(l => l === 7 || l === 1)).toBe(true);
  });

  it("never rejects, so a write cannot fail because housekeeping did", async () => {
    const runner = buildRetentionRunner({
      webhookPolicy: resolveWebhookRetentionConfig({}),
      adapter: {
        select: async () => {
          throw new Error("connection reset");
        },
        delete: async () => 0,
        ...withoutLedger,
        transaction: inline({}),
      },
      gate: alwaysClaims(),
      now: () => T0,
    });

    await expect(runner!.maybeRun()).resolves.toBeUndefined();
  });

  it("does not run when the gate refuses", async () => {
    const f = spyAdapter();
    const runner = buildRetentionRunner({
      webhookPolicy: resolveWebhookRetentionConfig({}),
      adapter: f.adapter,
      gate: { claim: async (): Promise<boolean> => false },
      now: () => T0,
    });

    await runner!.maybeRun();
    expect(f.limits).toHaveLength(0);
  });
});

describe("RetentionRunner inside an open transaction", () => {
  // A pass and a gate that record being reached, so "offered nothing" is
  // observed rather than inferred from an absence of rows.
  function counting(transactionOpen: () => boolean) {
    const claims: string[] = [];
    const runs: string[] = [];
    const runner = new RetentionRunner({
      passes: [
        {
          key: "probe",
          intervalMs: () => 0,
          run: async () => {
            runs.push("probe");
          },
        },
      ],
      gate: {
        claim: async (key: string): Promise<boolean> => {
          claims.push(key);
          return true;
        },
      } as never,
      now: () => T0,
      transactionOpen,
    });
    return { runner, claims, runs };
  }

  it("offers no pass, and claims no turn, while the flow holds a transaction", async () => {
    const { runner, claims, runs } = counting(() => true);
    await runner.maybeRun();
    expect(claims).toEqual([]);
    expect(runs).toEqual([]);
  });

  it("offers the passes once the transaction has finished", async () => {
    let open = true;
    const { runner, runs } = counting(() => open);
    await runner.maybeRun();
    open = false;
    await runner.maybeRun();
    expect(runs).toEqual(["probe"]);
  });

  it("counts a check that fails as an open transaction", async () => {
    const { runner, runs } = counting(() => {
      throw new Error("no flow store");
    });
    await expect(runner.maybeRun()).resolves.toBeUndefined();
    expect(runs).toEqual([]);
  });
});
