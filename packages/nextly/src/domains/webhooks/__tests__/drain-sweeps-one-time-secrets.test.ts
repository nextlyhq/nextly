/**
 * The scheduled drain sweeps plugins' one-purpose secrets.
 *
 * An install that only mints secrets may make no write that offers the sweep,
 * and one that goes quiet after minting makes none at all; expired rows keep a
 * subject and data in clear. The drain is the trigger that keeps running, so
 * it sweeps them on a marker of its own, within its wall-clock promise.
 */

import { describe, expect, it, vi } from "vitest";

import { resolveAuditRetentionConfig } from "../../audit/retention-config";
import { resolveEmailRetentionConfig } from "../../email/retention-config";
import {
  buildRetentionPasses,
  type retentionPoliciesFrom,
} from "../../retention/passes";
import {
  AUDIT_RETENTION_DRAIN_GATE_KEY,
  EMAIL_RETENTION_DRAIN_GATE_KEY,
  ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY,
  ONE_TIME_SECRETS_RETENTION_GATE_KEY,
  PREVIEW_LINKS_RETENTION_DRAIN_GATE_KEY,
  type RetentionGateStore,
  WEBHOOK_RETENTION_GATE_KEY,
} from "../../retention/gate";
import { resolveWebhookRetentionConfig } from "../retention-config";
import { runDrain } from "../run-drain";

type DrainRetention = NonNullable<Parameters<typeof runDrain>[0]["retention"]>;
type PolicyName = keyof ReturnType<typeof retentionPoliciesFrom>;

/**
 * For every policy the shared list names: the drain input that carries it
 * alone, and the gate the drain claims when it handles it. Keyed by the list's
 * own type, so a domain added there does not compile until it is entered here,
 * and the test below then runs it.
 */
const DRAIN_PASS: Record<
  PolicyName,
  { input: Partial<DrainRetention>; claims: string }
> = {
  webhookPolicy: {
    input: { policy: resolveWebhookRetentionConfig(undefined) ?? undefined },
    claims: WEBHOOK_RETENTION_GATE_KEY,
  },
  auditPolicy: {
    input: { auditPolicy: resolveAuditRetentionConfig() },
    claims: AUDIT_RETENTION_DRAIN_GATE_KEY,
  },
  emailPolicy: {
    input: { emailPolicy: resolveEmailRetentionConfig({ maxAgeMs: 1000 }) },
    claims: EMAIL_RETENTION_DRAIN_GATE_KEY,
  },
  oneTimeSecrets: {
    input: { oneTimeSecrets: true },
    claims: ONE_TIME_SECRETS_RETENTION_DRAIN_GATE_KEY,
  },
  previewLinks: {
    input: { previewLinks: true },
    claims: PREVIEW_LINKS_RETENTION_DRAIN_GATE_KEY,
  },
};

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

  it.each(Object.entries(DRAIN_PASS))(
    "runs a pass for %s on its own",
    async (_, { input, claims }) => {
      const claimed: string[] = [];
      await drain({
        ...input,
        prune: {
          adapter: { select: async () => [], delete: async () => 0 },
        } as never,
        gate: {
          claim: async (key: string) => {
            claimed.push(key);
            return true;
          },
          release: async () => undefined,
        },
      });
      expect(claimed).toContain(claims);
    }
  );

  it("does not reject when the sweep fails and the logger throws too", async () => {
    // Retention is housekeeping after delivery: a failing sweep reported
    // through a logger that itself throws must not reject the drain.
    const result = await drain({
      oneTimeSecrets: true,
      prune: {
        adapter: {
          select: async () => {
            throw new Error("database gone");
          },
          delete: async () => 0,
        },
        logger: {
          warn: () => {
            throw new Error("logger gone");
          },
        },
      } as never,
      gate: { claim: async () => true, release: async () => undefined },
    });
    expect(result.pruned.oneTimeSecrets).toBe(0);
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

describe("the scheduled drain and recorded preview links", () => {
  it("leaves them their share behind a secrets backlog that never ends", async () => {
    // Every secrets batch takes time and there is always another, so a sweep
    // given the whole remainder would spend it all and the preview-links
    // sweep after it would never start.
    let clock = 0;
    const tables: string[] = [];
    const remove = async () => {
      clock += 50;
      return 500;
    };
    const adapter = {
      select: async (table: string) => {
        tables.push(table);
        return Array.from({ length: 500 }, (_, i) => ({ id: `row-${i}` }));
      },
      delete: remove,
      transaction: async (
        fn: (tx: { delete: typeof remove }) => Promise<unknown>
      ) => fn({ delete: remove }),
    };

    await drain(
      {
        oneTimeSecrets: true,
        previewLinks: true,
        prune: { adapter } as never,
        gate: { claim: async () => true, release: async () => undefined },
      },
      () => new Date(clock),
      1_000
    );

    expect(tables).toContain("nextly_one_time_secrets");
    expect(tables).toContain("nextly_preview_links");
  });
});

describe("the write paths' one-purpose secrets pass", () => {
  it("does not reach the write when the sweep fails and the logger throws too", async () => {
    // Every write offers this pass; a sweep failure reported through a
    // throwing logger must stay inside it rather than fail the write.
    const passes = buildRetentionPasses({
      oneTimeSecrets: true,
      adapter: {
        select: async () => {
          throw new Error("database gone");
        },
        delete: async () => 0,
      } as never,
      gate: { claim: async () => true, release: async () => undefined },
      logger: {
        warn: () => {
          throw new Error("logger gone");
        },
      } as never,
    });
    const pass = passes.find(
      candidate => candidate.key === ONE_TIME_SECRETS_RETENTION_GATE_KEY
    );
    await expect(pass?.run(2)).resolves.toBeUndefined();
  });
});
