/**
 * What a scheduled webhook drain is bounded by.
 *
 * Written BEFORE the bounds move out of `api/webhooks.ts`, and confirmed
 * passing against the unmodified route, so it describes what the code did
 * rather than what the change made it do. A characterisation test written after
 * a refactor can only agree with the refactor.
 *
 * These numbers are the contract between a scheduler tick and the platform that
 * kills it. If a move quietly changed one, a serverless drain would start being
 * killed mid-pass and the symptom would be deliveries that retry forever.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const runWebhookDrain = vi.fn(
  async (
    _adapter: unknown,
    _registry: unknown,
    _options: Record<string, unknown>
  ) => ({ rounds: 1 })
);

vi.mock("../../domains/webhooks/drain-runner", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../domains/webhooks/drain-runner")
    >();
  return { ...actual, runWebhookDrain };
});

vi.mock("../trigger-auth", () => ({ authorizeTrigger: async () => {} }));
vi.mock("../../init", () => ({ getCachedNextly: async () => ({}) }));
vi.mock("../../di", () => ({
  container: { get: () => ({}) },
}));

const { drainWebhooks } = await import("../webhooks");

/** The options the route handed the drain engine. */
function options(): Record<string, unknown> {
  const call = runWebhookDrain.mock.calls[0];
  expect(call, "the route never reached the drain").toBeDefined();
  return (call as unknown as [unknown, unknown, Record<string, unknown>])[2];
}

beforeEach(() => {
  runWebhookDrain.mockClear();
});

describe("a scheduled webhook drain", () => {
  it("bounds a tick by rounds, batch sizes and wall clock", async () => {
    await drainWebhooks(
      new Request("https://example.com/api/webhooks/drain", { method: "POST" })
    );

    expect(options()).toMatchObject({
      maxRounds: 10,
      fanOutBatchSize: 50,
      deliverBatchSize: 25,
      maxDurationMs: 25_000,
    });
  });

  it("caps a single hung receiver below the whole-pass budget", async () => {
    // The per-request timeout must be shorter than the pass budget, or one
    // unresponsive endpoint can stretch the pass past the limit that keeps a
    // serverless invocation alive.
    await drainWebhooks(
      new Request("https://example.com/api/webhooks/drain", { method: "POST" })
    );

    const opts = options();
    expect(opts.requestTimeoutMs).toBeLessThan(opts.maxDurationMs as number);
  });
});
