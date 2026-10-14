/**
 * The scheduled drain sweeps plugins' one-purpose secrets.
 *
 * An install that only mints secrets may make no write that offers the sweep,
 * and one that goes quiet after minting makes none at all; expired rows keep a
 * subject and data in clear. The drain is the trigger that keeps running, so
 * it sweeps them on a marker of its own, within its wall-clock promise.
 */

import { describe, expect, it, vi } from "vitest";

import type { retentionPoliciesFrom } from "../../retention/passes";
import {
  ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY,
  ONE_TIME_SECRETS_RETENTION_GATE_KEY,
  type RetentionGateStore,
} from "../../retention/gate";
import { runDrain } from "../run-drain";

// Every policy the shared list names is a field the drain takes (the webhook
// policy arrives as `policy`). A domain added to `retentionPoliciesFrom` that
// the drain does not handle fails to compile here, rather than reaching the
// drain's dependency as a property nothing reads.
type DrainRetention = NonNullable<Parameters<typeof runDrain>[0]["retention"]>;
type UnhandledPolicies = Exclude<
  keyof ReturnType<typeof retentionPoliciesFrom>,
  "webhookPolicy" | keyof DrainRetention
>;
const drainTakesEveryPolicy: [UnhandledPolicies] extends [never]
  ? true
  : UnhandledPolicies = true;

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

/** An adapter holding one expired secret, which the sweep removes. */
function oneExpiredSecret() {
  const tables: string[] = [];
  let left = 1;
  const remove = vi.fn(async () => {
    const removed = left;
    left = 0;
    return removed;
  });
  return {
    tables,
    remove,
    adapter: {
      select: async (table: string) => {
        tables.push(table);
        return left > 0 ? [{ id: "expired" }] : [];
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
  clock: () => Date = () => new Date(0),
  maxDurationMs?: number
): ReturnType<typeof runDrain> {
  return runDrain({
    fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
    deliver: { db: idleDb(), now: clock } as never,
    maxDurationMs,
    retention,
  });
}

describe("the scheduled drain and plugins' one-purpose secrets", () => {
  it("sweeps them with no other retention configured", async () => {
    const claimed: string[] = [];
    const store = oneExpiredSecret();

    const result = await drain({
      oneTimeSecrets: true,
      prune: { adapter: store.adapter } as never,
      gate: {
        claim: async (key: string) => {
          claimed.push(key);
          return true;
        },
        release: async () => undefined,
      },
    });

    expect(claimed).toContain(ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY);
    expect(store.tables).toContain("nextly_one_time_secrets");
    expect(result.pruned.oneTimeSecrets).toBe(1);
  });

  it("takes every policy the shared list names", () => {
    expect(drainTakesEveryPolicy).toBe(true);
  });

  it("claims a marker the capped write path cannot take from it", () => {
    expect(ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY).not.toBe(
      ONE_TIME_SECRETS_RETENTION_GATE_KEY
    );
  });

  it("hands the turn back when the deadline passes after the claim", async () => {
    // Claiming is two statements and can spend what remained. A turn kept
    // without a sweep would hold the next attempt off for a whole interval.
    let clock = 0;
    const released: string[] = [];
    const store = oneExpiredSecret();
    const gate: RetentionGateStore = {
      claim: async (key: string) => {
        if (key === ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY) clock = 10_000;
        return true;
      },
      release: async (key: string) => {
        released.push(key);
      },
    };

    const result = await drain(
      {
        oneTimeSecrets: true,
        prune: { adapter: store.adapter } as never,
        gate,
      },
      () => new Date(clock),
      1_000
    );

    expect(store.tables).not.toContain("nextly_one_time_secrets");
    expect(result.pruned.oneTimeSecrets).toBe(0);
    expect(released).toContain(ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY);
  });
});
