/**
 * The scheduled drain is the delivery log's only trigger that outlives writing.
 *
 * Every other one is a write — a send, or a content mutation. So an install
 * that stops writing offers no pass at all, and the rows from its final sends
 * stay indefinitely under a window that reads as bounded. That is the whole
 * failure this pass exists to close, and it is invisible from the
 * configuration: the setting says 90 days and the table says forever.
 *
 * The budget is the second half. Nothing waits on a drain, which is what makes
 * it the right place to spend a FULL prune budget — every other trigger passes
 * a small cap so a save is not held up. But the drain also makes a wall-clock
 * promise to a serverless cron route, so a pass that starts with the budget
 * already spent must hand its turn back rather than consume the interval.
 */

import { describe, expect, it, vi } from "vitest";

import { resolveAuditRetentionConfig } from "../../audit/retention-config";
import { resolveEmailRetentionConfig } from "../../email/retention-config";
import {
  EMAIL_RETENTION_DRAIN_GATE_KEY,
  EMAIL_RETENTION_GATE_KEY,
  type RetentionGateStore,
} from "../../retention/gate";
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

/** A drain with nothing to deliver, so only the retention block runs. */
function quietDrain(
  retention: Parameters<typeof runDrain>[0]["retention"],
  maxDurationMs?: number
): ReturnType<typeof runDrain> {
  return runDrain({
    fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
    deliver: { db: idleDb(), now: () => new Date(0) } as never,
    maxDurationMs,
    retention,
  });
}

function gateThatGrants(claimed: string[]): RetentionGateStore {
  return {
    claim: async (key: string) => {
      claimed.push(key);
      return true;
    },
    release: async () => undefined,
  };
}

describe("the scheduled drain and the delivery log", () => {
  it("claims the email turn and sweeps", async () => {
    const claimed: string[] = [];
    const select = vi.fn(async () => []);

    const result = await quietDrain({
      emailPolicy: resolveEmailRetentionConfig({ maxAgeMs: 1000 }),
      prune: {
        adapter: { select, delete: async () => 0 },
      } as never,
      gate: gateThatGrants(claimed),
    });

    expect(claimed).toContain(EMAIL_RETENTION_DRAIN_GATE_KEY);
    // Reached the table, rather than merely taking the turn. A pass that
    // claimed its gate and queried nothing would still leave the log growing
    // while the marker held the next attempt off for a full interval.
    expect(select).toHaveBeenCalled();
    expect(result.pruned.emailDeliveries).toBe(0);
  });

  it("runs even when webhook and audit retention are both off", async () => {
    // The dependency used to be built only when a webhook or audit policy
    // existed. An install that configured neither — plenty do — got no drain
    // retention object at all, so the delivery log's one scheduled trigger was
    // decided by two unrelated settings.
    const claimed: string[] = [];

    await quietDrain({
      emailPolicy: resolveEmailRetentionConfig(),
      prune: {
        adapter: { select: async () => [], delete: async () => 0 },
      } as never,
      gate: gateThatGrants(claimed),
    });

    expect(claimed).toContain(EMAIL_RETENTION_DRAIN_GATE_KEY);
  });

  it("does not claim a turn for a log configured to keep everything", async () => {
    // The control. A pass that claimed regardless would write the marker and
    // hold off the next attempt for a full interval, having decided nothing.
    const claimed: string[] = [];

    await quietDrain({
      emailPolicy: resolveEmailRetentionConfig({ maxAgeMs: false }),
      prune: {
        adapter: { select: async () => [], delete: async () => 0 },
      } as never,
      gate: gateThatGrants(claimed),
    });

    expect(claimed).not.toContain(EMAIL_RETENTION_DRAIN_GATE_KEY);
  });

  it("claims a marker the capped write path cannot take from it", () => {
    // Two triggers with different jobs. Every write offers this pass capped at
    // a couple of batches so a send is not held up; the drain offers it at full
    // budget because nothing waits on the drain. Sharing one marker let a send
    // landing moments earlier take the turn and spend two batches, leaving the
    // configured budget unreachable — the log then grows while both triggers
    // report success. The audit trails were gated twice for exactly this.
    expect(EMAIL_RETENTION_DRAIN_GATE_KEY).not.toBe(EMAIL_RETENTION_GATE_KEY);
  });

  it("reaches the delivery log on a drain that also prunes audit", async () => {
    // Covers that the email pass runs ALONGSIDE another domain's, which is the
    // ordinary configuration and worth pinning on its own.
    //
    // It does NOT cover the budget share. I wrote it intending to, and measured
    // that it does not: removing the audit pass's `shareOfRemaining` leaves
    // this green, because the audit prune stops on its own batch budget long
    // before the deadline it was handed matters. Saying so here rather than
    // letting the name imply coverage the case does not have — the starvation
    // fix in `run-drain.ts` is currently reasoned, not pinned, and a test that
    // passed either way would be worse than admitting that.
    const tables: string[] = [];
    let clock = 0;

    // A backlog that never runs out, and a clock that advances with the work,
    // so the only thing that can stop the audit sweep is its own deadline.
    const adapter = {
      select: async (table: string) => {
        tables.push(table);
        clock += 50;
        return table === "email_deliveries" ? [] : [{ id: "x" }];
      },
      delete: async () => {
        clock += 50;
        return 1;
      },
    };

    await runDrain({
      fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
      deliver: { db: idleDb(), now: () => new Date(clock) } as never,
      maxDurationMs: 2000,
      retention: {
        auditPolicy: resolveAuditRetentionConfig({}),
        emailPolicy: resolveEmailRetentionConfig({ maxAgeMs: 1000 }),
        prune: { adapter, now: () => new Date(clock) } as never,
        gate: { claim: async () => true, release: async () => undefined },
      },
    });

    // The delivery log was actually reached. Asserting on the TABLE rather than
    // on a call count is what separates "email ran" from "audit ran a lot".
    expect(tables).toContain("email_deliveries");
  });

  it("returns the email turn when an earlier sweep throws", async () => {
    // The email turn is claimed BEFORE the earlier sweeps run, so that the
    // webhook sweep can size its share. That ordering means an earlier sweep
    // throwing skips the branch that would use or return it — and the marker
    // then holds the full email sweep off for a whole interval. If the same
    // failure recurs each interval, the delivery log is starved permanently
    // while the drain reports an error nobody reads.
    //
    // The throw is staged where it really comes from: the "safe" wrappers
    // absorb a prune failure but still report it through the installation's
    // logger, and an app-supplied logger that throws escapes them.
    const released: string[] = [];

    await expect(
      runDrain({
        fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
        deliver: { db: idleDb(), now: () => new Date(0) } as never,
        retention: {
          auditPolicy: resolveAuditRetentionConfig({}),
          emailPolicy: resolveEmailRetentionConfig({ maxAgeMs: 1000 }),
          prune: {
            adapter: {
              select: async () => {
                throw new Error("prune query failed");
              },
              delete: async () => 0,
            },
            logger: {
              warn: () => {
                throw new Error("the logging transport is down");
              },
            },
          } as never,
          gate: {
            claim: async () => true,
            release: async (key: string) => {
              released.push(key);
            },
          },
        },
      })
    ).rejects.toThrow();

    // The drain still fails — that is the caller's problem and not this pass's
    // to hide. What must NOT happen is the turn staying taken.
    expect(released).toContain(EMAIL_RETENTION_DRAIN_GATE_KEY);
  });

  it("does not consume the interval when the wall-clock budget is spent", async () => {
    // The drain's promise to a serverless cron route. What matters is that the
    // interval is not spent on a pass that did no work — reached either by not
    // claiming the turn or by handing it back, and the caller cannot tell the
    // two apart. Asserting the outcome rather than the route keeps this true if
    // the ordering of the claim and the deadline check ever changes.
    const claimed: string[] = [];
    const released: string[] = [];
    const select = vi.fn(async () => []);
    let ticks = 0;

    await runDrain({
      fanOut: { db: idleDb(), loadEndpoints: async () => [] } as never,
      deliver: {
        db: idleDb(),
        // First reading starts the clock; every later one is past the budget.
        now: () => new Date(ticks++ === 0 ? 0 : 10_000),
      } as never,
      maxDurationMs: 1,
      retention: {
        emailPolicy: resolveEmailRetentionConfig({ maxAgeMs: 1000 }),
        auditPolicy: resolveAuditRetentionConfig({}),
        prune: { adapter: { select, delete: async () => 0 } } as never,
        gate: {
          claim: async (key: string) => {
            claimed.push(key);
            return true;
          },
          release: async (key: string) => {
            released.push(key);
          },
        },
      },
    });

    // No work done, and no turn held: either it was never taken, or it was
    // given back.
    expect(select).not.toHaveBeenCalled();
    const held =
      claimed.filter(k => k === EMAIL_RETENTION_DRAIN_GATE_KEY).length -
      released.filter(k => k === EMAIL_RETENTION_DRAIN_GATE_KEY).length;
    expect(held).toBe(0);
  });
});
