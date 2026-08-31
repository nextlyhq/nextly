/**
 * A sweep is queued by the trigger, because nothing else can queue it.
 *
 * `releases:drain` was registered and never ran: a release comes due at an
 * instant with no request attached, so no code path is ever in a position to
 * enqueue it. The queue stayed empty and looked exactly like a queue with
 * nothing to do.
 */

import { describe, expect, it, vi } from "vitest";

import {
  JobRegistry,
  MAX_JOB_SLUG_LENGTH,
  SWEEP_KEY_PREFIX,
  defineJob,
} from "../job-registry";
import { runJobsPass, sweepDedupeKey } from "../jobs-runner";

function registryWith(...defs: ReturnType<typeof defineJob>[]): JobRegistry {
  const registry = new JobRegistry();
  for (const d of defs) registry.register(d);
  return registry;
}

/** An adapter that records enqueues and claims nothing. */
function adapterSpy() {
  const inserted: Array<Record<string, unknown>> = [];
  return {
    inserted,
    insert: async (_table: string, row: Record<string, unknown>) => {
      inserted.push(row);
      return row;
    },
    select: async () => [],
    selectOne: async () => null,
    updateCount: async () => 0,
    delete: async () => 0,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({ select: async () => [], updateCount: async () => 0 }),
  };
}

const noop = defineJob({ slug: "test:noop", handler: async () => {} });
const sweeper = defineJob({
  slug: "test:sweep",
  handler: async () => {},
  sweep: true,
});

describe("a sweep's slug is charged for its dedupe key", () => {
  it("refuses a sweep slug that would produce an over-long dedupe key", () => {
    // The two limits are equal (191), so a slug at the maximum yields a key
    // over it. Caught at definition, where a person is reading the error —
    // not at enqueue, which runs on a scheduler tick with nobody watching, and
    // where a refused sweep is deliberately swallowed so it cannot fail a pass.
    expect(() =>
      defineJob({
        slug: "s".repeat(MAX_JOB_SLUG_LENGTH),
        handler: async () => {},
        sweep: true,
      })
    ).toThrow(/dedupe key is derived from it/);
  });

  it("accepts the same slug when it is NOT a sweep", () => {
    // The control. Charging every job type for a prefix only sweeps use would
    // narrow a limit that works, and would make the case above pass for a
    // reason unrelated to sweeps.
    expect(() =>
      defineJob({
        slug: "s".repeat(MAX_JOB_SLUG_LENGTH),
        handler: async () => {},
      })
    ).not.toThrow();
  });

  it("accepts a sweep slug that leaves room for the prefix", () => {
    expect(() =>
      defineJob({
        slug: "s".repeat(MAX_JOB_SLUG_LENGTH - SWEEP_KEY_PREFIX.length),
        handler: async () => {},
        sweep: true,
      })
    ).not.toThrow();
  });
});

describe("a pass keeps its sweeps queued", () => {
  it("enqueues a registered sweep", async () => {
    const adapter = adapterSpy();

    await runJobsPass(adapter as never, registryWith(sweeper), {
      retentionMs: null,
    });

    const slugs = adapter.inserted.map(row => row.slug);
    expect(slugs).toContain("test:sweep");
  });

  it("does NOT enqueue a job type that is not a sweep", async () => {
    // The control. A pass that queued every registered type would fill the
    // table with work nobody asked for, and would make the assertion above
    // pass for a reason that has nothing to do with `sweep`.
    const adapter = adapterSpy();

    await runJobsPass(adapter as never, registryWith(noop), {
      retentionMs: null,
    });

    const slugs = adapter.inserted.map(row => row.slug);
    expect(slugs).not.toContain("test:noop");
  });

  it("queues it under a stable dedupe key, so a second trigger adds no copy", async () => {
    // The key is what makes this safe to do on every tick. Two schedulers, or
    // one scheduler and an impatient operator, must not stack up sweeps.
    const adapter = adapterSpy();

    await runJobsPass(adapter as never, registryWith(sweeper), {
      retentionMs: null,
    });

    expect(adapter.inserted[0]?.dedupe_key).toBe(sweepDedupeKey("test:sweep"));
  });

  it("gives the sweep no principal", async () => {
    // A sweep acts as nobody and resolves each item's own identity when it
    // performs it. A user here would be an authority lent to work that never
    // asked for it — a privilege escalation with a delay on it.
    const adapter = adapterSpy();

    await runJobsPass(adapter as never, registryWith(sweeper), {
      retentionMs: null,
    });

    expect(adapter.inserted[0]?.run_as_user_id).toBeNull();
  });

  it("still drains when a sweep cannot be queued", async () => {
    // Housekeeping is not the work. The jobs already in the table are real, and
    // refusing to run them because an insert failed turns a hiccup into a
    // stalled queue.
    const adapter = adapterSpy();
    adapter.insert = async () => {
      throw new Error("insert refused");
    };
    const onSweepError = vi.fn();

    const result = await runJobsPass(adapter as never, registryWith(sweeper), {
      retentionMs: null,
      onSweepError,
    });

    expect(onSweepError).toHaveBeenCalledTimes(1);
    expect(result.claimed).toBe(0);
  });
});
