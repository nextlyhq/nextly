/**
 * What a scheduled webhook drain is bounded by.
 *
 * These numbers are the contract between a scheduler tick and the platform that
 * kills it: they cap how much work one invocation starts, so it returns before
 * the platform terminates it and the next tick continues from the durable
 * outbox. A drain that exceeded them would be killed mid-pass, and the symptom
 * would be deliveries that retry forever without progressing.
 *
 * The route is mocked at `runWebhookDrain` rather than driven end to end because
 * the subject is the OPTIONS the route chooses, not what the engine does with
 * them; a real drain would exercise fan-out and delivery and tell us nothing
 * about the four numbers under test.
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
