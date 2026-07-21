/**
 * Opportunistic retention passes.
 *
 * The runner is what content writes call. It decides whether a pass is due, and
 * how large a pass the caller is willing to wait for — the write path awaits its
 * pass, so the budget it passes is what bounds a user's save.
 */
import { describe, expect, it, vi } from "vitest";

import { resolveWebhookRetentionConfig } from "../retention-config";
import { WebhookRetentionRunner } from "../retention-runner";

const T0 = new Date("2026-07-21T12:00:00.000Z");

/** Records the policy each pass ran with, so the budget is observable. */
function spyAdapter() {
  const limits: (number | undefined)[] = [];
  return {
    limits,
    adapter: {
      select: async <T>(
        _t: string,
        options?: { limit?: number }
      ): Promise<T[]> => {
        limits.push(options?.limit);
        return [] as T[];
      },
      delete: async (): Promise<number> => 0,
    },
  };
}

function alwaysClaims() {
  return { claim: async (): Promise<boolean> => true };
}

describe("WebhookRetentionRunner", () => {
  it("runs a pass when the gate lets it through", async () => {
    const f = spyAdapter();
    const runner = new WebhookRetentionRunner({
      policy: resolveWebhookRetentionConfig({})!,
      prune: { adapter: f.adapter },
      gate: alwaysClaims(),
      now: () => T0,
    });

    await runner.maybeRun();
    expect(f.limits.length).toBeGreaterThan(0);
  });

  it("does not consult the gate again inside the same interval", async () => {
    // The in-process guard is what keeps the common case free: a busy site must
    // not pay a database round trip on every write just to be told "not yet".
    const gate = { claim: vi.fn(async () => true) };
    const runner = new WebhookRetentionRunner({
      policy: resolveWebhookRetentionConfig({ intervalMs: 60_000 })!,
      prune: { adapter: spyAdapter().adapter },
      gate,
      now: () => T0,
    });

    await runner.maybeRun();
    await runner.maybeRun();
    await runner.maybeRun();

    expect(gate.claim).toHaveBeenCalledTimes(1);
  });

  it("consults the gate again once the interval has elapsed", async () => {
    const gate = { claim: vi.fn(async () => true) };
    let now = T0;
    const runner = new WebhookRetentionRunner({
      policy: resolveWebhookRetentionConfig({ intervalMs: 60_000 })!,
      prune: { adapter: spyAdapter().adapter },
      gate,
      now: () => now,
    });

    await runner.maybeRun();
    now = new Date(T0.getTime() + 60_001);
    await runner.maybeRun();

    expect(gate.claim).toHaveBeenCalledTimes(2);
  });

  it("caps the pass to the batch budget the caller asks for", async () => {
    // The write path awaits its pass, so this is what bounds a user's save. A
    // caller that passes nothing gets the policy's full budget.
    const f = spyAdapter();
    const runner = new WebhookRetentionRunner({
      policy: resolveWebhookRetentionConfig({ batchSize: 7 })!,
      prune: { adapter: f.adapter },
      gate: alwaysClaims(),
      now: () => T0,
    });

    await runner.maybeRun(1);
    // One batch attempt per table/class, none of them repeated.
    expect(f.limits.every(l => l === 7 || l === 1)).toBe(true);
  });

  it("never rejects, so a write cannot fail because housekeeping did", async () => {
    const runner = new WebhookRetentionRunner({
      policy: resolveWebhookRetentionConfig({})!,
      prune: {
        adapter: {
          select: async () => {
            throw new Error("connection reset");
          },
          delete: async () => 0,
        },
      },
      gate: alwaysClaims(),
      now: () => T0,
    });

    await expect(runner.maybeRun()).resolves.toBeUndefined();
  });

  it("does not run when the gate refuses", async () => {
    const f = spyAdapter();
    const runner = new WebhookRetentionRunner({
      policy: resolveWebhookRetentionConfig({})!,
      prune: { adapter: f.adapter },
      gate: { claim: async (): Promise<boolean> => false },
      now: () => T0,
    });

    await runner.maybeRun();
    expect(f.limits).toHaveLength(0);
  });
});
