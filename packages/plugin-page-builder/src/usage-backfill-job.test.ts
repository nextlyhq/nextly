/**
 * That the backfill sweep uses its tick and then stops.
 *
 * A sweep shares a drain with every other job, so the failure that matters is
 * not slowness - it is a pass that never returns. Two ways in: a loop whose
 * stop condition cannot change, and a finished site whose sweep keeps working
 * anyway. Both are here.
 *
 * @module usage-backfill-job.test
 */
import { describe, expect, it } from "vitest";

import { usageBackfillJob } from "./usage-backfill-job";
import { backfillScopeKey, type BackfillScope } from "./usage-backfill-scope";

function scope(field: string): BackfillScope {
  return { entity: "pages", field, locale: "", variant: "published" };
}

function store(initial: string[] = []) {
  const done = new Set(initial);
  return {
    done,
    state: () => ({
      completed: async () => done,
      record: async (key: string) => {
        done.add(key);
      },
    }),
  };
}

/**
 * The instant every fixture treats as the start of the pass.
 *
 * Named and shared because the deadline and the fake clock must be on ONE
 * scale. Building the deadline from an epoch-shaped instant while a clock
 * returned small relative numbers made `now() >= deadline` unsatisfiable, so
 * the budget cases walked everything and read as the handler ignoring its
 * deadline - a test failing for a reason that had nothing to do with the code.
 */
const PASS_START = 1_000_000;

/** A context standing in for the runner's, with a deadline this far ahead. */
function context(msAhead: number) {
  const start = PASS_START;
  return {
    user: null,
    now: new Date(start),
    deadline: new Date(start + msAhead),
    content: {} as never,
  };
}

describe("one pass of the backfill sweep", () => {
  it("walks every outstanding scope when the tick allows", async () => {
    const s = store();
    const walked: string[] = [];
    const job = usageBackfillJob({
      scopes: async () => [scope("a"), scope("b"), scope("c")],
      state: s.state,
      rebuild: async sc => {
        walked.push(sc.field);
      },
      clock: () => PASS_START,
    });

    await job.handler(null as never, context(10_000) as never);

    expect(walked).toEqual(["a", "b", "c"]);
  });

  it("STOPS at the deadline and leaves the rest for the next tick", async () => {
    // The budget is real work rather than advice: a pass that ignored it would
    // hold the drain for as long as the site is large.
    const s = store();
    const walked: string[] = [];
    let ticks = 0;
    const job = usageBackfillJob({
      scopes: async () => [scope("a"), scope("b"), scope("c")],
      state: s.state,
      rebuild: async sc => {
        walked.push(sc.field);
      },
      // Two scopes' worth of budget, then past the deadline.
      clock: () => {
        ticks += 1;
        return ticks > 2 ? PASS_START + 10_000 : PASS_START;
      },
    });

    await job.handler(null as never, context(5_000) as never);

    expect(walked).toEqual(["a", "b"]);
  });

  it("leaves the unwalked scopes UNRECORDED, so the next tick finds them", async () => {
    // Stopping early must defer work, never discharge it. A scope recorded but
    // unwalked is one no later pass revisits.
    const s = store();
    let ticks = 0;
    const job = usageBackfillJob({
      scopes: async () => [scope("a"), scope("b")],
      state: s.state,
      rebuild: async () => undefined,
      clock: () => {
        ticks += 1;
        return ticks > 1 ? PASS_START + 10_000 : PASS_START;
      },
    });

    await job.handler(null as never, context(5_000) as never);

    expect([...s.done]).toEqual([backfillScopeKey(scope("a"))]);
  });

  it("returns without spending a rebuild on a finished site", async () => {
    // The condition that lets a sweep go quiet. Without it the job re-reads its
    // own progress on every tick for the life of the installation.
    const s = store([backfillScopeKey(scope("a"))]);
    let rebuilds = 0;
    const job = usageBackfillJob({
      scopes: async () => [scope("a")],
      state: s.state,
      rebuild: async () => {
        rebuilds += 1;
      },
      clock: () => PASS_START,
    });

    await job.handler(null as never, context(10_000) as never);

    expect(rebuilds).toBe(0);
  });

  it("is declared a sweep, which is what keeps one queued", async () => {
    // Without this the handler is registered and nothing ever enqueues it - a
    // job that exists, is reachable, and never runs.
    const job = usageBackfillJob({
      scopes: async () => [],
      state: store().state,
      rebuild: async () => undefined,
    });

    expect({ sweep: job.sweep, slug: job.slug }).toEqual({
      sweep: true,
      slug: "page-builder:usage-backfill",
    });
  });
});
