/**
 * Webhook delivery as a registered job type — consumer #1 of the shared runner.
 *
 * The point of these is that the job runs the SAME drain the route runs, with
 * the same bounds. A job that drained differently would be a second webhook
 * drain wearing the first one's name, and the divergence would surface as
 * deliveries that behave differently depending on which trigger fired.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const runWebhookDrain = vi.fn(async (..._args: unknown[]) => ({
  rounds: 1,
  eventsProcessed: 2,
  deliveriesCreated: 2,
  attempted: 2,
  delivered: 1,
  retried: 0,
  failed: 1,
  abandoned: 0,
}));

vi.mock("../drain-runner", async importOriginal => {
  const actual = await importOriginal<typeof import("../drain-runner")>();
  return { ...actual, runWebhookDrain };
});

const { createWebhooksDrainJob, WEBHOOKS_DRAIN_JOB } = await import(
  "../webhooks-drain-job"
);
const { SCHEDULED_DRAIN_BOUNDS } = await import("../drain-runner");

const deps = (over: Record<string, unknown> = {}) => ({
  db: {} as never,
  registry: { getEnabledEndpointsFresh: async () => [] } as never,
  retention: undefined,
  onOutcome: vi.fn(),
  ...over,
});

beforeEach(() => {
  runWebhookDrain.mockClear();
});

describe("the webhooks:drain job type", () => {
  it("is a sweep, because nothing else can enqueue a drain", async () => {
    // An event reaches the outbox on a content write, but the DRAIN that
    // delivers it has no request of its own. Registered and not a sweep means
    // an installation that goes quiet stops delivering what it still owes.
    expect(createWebhooksDrainJob(deps()).sweep).toBe(true);
  });

  it("runs the drain with the SAME bounds the scheduled route uses", async () => {
    // Read from the published constant rather than restated here: an
    // expectation carrying its own copy of the numbers would keep passing after
    // the two triggers had drifted apart, which is the whole failure this
    // shared constant exists to prevent.
    await createWebhooksDrainJob(deps()).handler(null as never, {} as never);

    const [, , options] = runWebhookDrain.mock.calls[0] as unknown as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(options).toMatchObject(SCHEDULED_DRAIN_BOUNDS);
  });

  it("reports the pass, including a failure that did not fail the job", async () => {
    // The job row completes while individual deliveries fail. Without the
    // report, an endpoint that has stopped receiving anything leaves no trace
    // outside its own delivery rows.
    const onOutcome = vi.fn();

    await createWebhooksDrainJob(deps({ onOutcome })).handler(
      null as never,
      {} as never
    );

    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome.mock.calls[0]?.[0]).toMatchObject({
      failed: 1,
      delivered: 1,
    });
  });

  it("carries the retention deps the installation configured", async () => {
    const retention = { policy: {} } as never;

    await createWebhooksDrainJob(deps({ retention })).handler(
      null as never,
      {} as never
    );

    const [, , options] = runWebhookDrain.mock.calls[0] as unknown as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    // A cron-only install prunes on this pass or never; dropping it here would
    // leave the event and delivery ledgers growing without bound.
    expect(options.retention).toBe(retention);
  });

  it("names itself once, so the runner and the trigger cannot disagree", () => {
    expect(createWebhooksDrainJob(deps()).slug).toBe(WEBHOOKS_DRAIN_JOB);
  });
});
