/**
 * The job type registry: what `defineJob` guarantees, and what the registry
 * refuses.
 *
 * @module domains/jobs/__tests__/job-registry.test
 */
import { describe, expect, it } from "vitest";

import { JobRegistry, defineJob } from "../job-registry";

const noop = async (): Promise<void> => {};

describe("defineJob", () => {
  it("defaults the retry budget rather than leaving it undefined", () => {
    // A job with no declared budget must still be BOUNDED. An undefined budget
    // would be read as "retry forever" by the runner, which is how a
    // permanently failing job becomes an infinite loop.
    expect(defineJob({ slug: "a", handler: noop }).retry.maxAttempts).toBe(5);
  });

  it("keeps an explicit retry budget", () => {
    expect(
      defineJob({ slug: "a", handler: noop, retry: { maxAttempts: 2 } }).retry
        .maxAttempts
    ).toBe(2);
  });

  it("refuses a budget below one attempt", () => {
    // Zero attempts means the job can never run at all, which is silently
    // indistinguishable from a job nobody enqueued.
    expect(() =>
      defineJob({ slug: "a", handler: noop, retry: { maxAttempts: 0 } })
    ).toThrow(/at least one attempt/i);
  });

  it("refuses a slug that is empty or only whitespace", () => {
    // The slug is the join between a stored row and the code that runs it. A
    // blank one stores rows nothing can ever claim.
    expect(() => defineJob({ slug: "", handler: noop })).toThrow(/slug/i);
    expect(() => defineJob({ slug: "   ", handler: noop })).toThrow(/slug/i);
  });
});

describe("JobRegistry", () => {
  it("returns the definition registered under a slug", () => {
    const registry = new JobRegistry();
    const job = defineJob({ slug: "releases:apply", handler: noop });
    registry.register(job);
    expect(registry.get("releases:apply")).toBe(job);
  });

  it("REFUSES a second registration of one slug rather than replacing it", () => {
    // Silently replacing would mean the job that runs depends on plugin load
    // order, and the losing handler would never run with nothing to say so.
    const registry = new JobRegistry();
    registry.register(defineJob({ slug: "a", handler: noop }));
    expect(() =>
      registry.register(defineJob({ slug: "a", handler: noop }))
    ).toThrow(/already registered/i);
  });

  it("returns undefined for a slug nobody registered", () => {
    // The control for the case above: a registry that threw for everything
    // would satisfy the refusal test while being useless.
    expect(new JobRegistry().get("never-registered")).toBeUndefined();
  });

  it("lists registered slugs, so a runner can report an orphaned row", () => {
    // A stored row whose slug no longer exists in code — a job type deleted
    // while rows were still queued — must be reportable rather than silently
    // skipped on every pass forever.
    const registry = new JobRegistry();
    registry.register(defineJob({ slug: "b", handler: noop }));
    registry.register(defineJob({ slug: "a", handler: noop }));
    expect(registry.slugs()).toEqual(["a", "b"]);
  });
});
