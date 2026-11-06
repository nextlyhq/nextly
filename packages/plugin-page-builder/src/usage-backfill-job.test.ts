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

import type { PluginTransaction } from "@nextlyhq/plugin-sdk/schema";

import { usageBackfillJob } from "./usage-backfill-job";
import { backfillScopeKey, type BackfillScope } from "./usage-backfill-scope";
import { usageBookkeeping } from "./usage-bookkeeping";

/** What a rebuild that walked its scope to the end answers. */
const WHOLE = { finished: true };

function scope(field: string): BackfillScope {
  return { entity: "pages", field, locale: "", variant: "published" };
}

function store(initial: string[] = []) {
  const done = new Set(initial);
  const cursors = new Map<string, string>();
  const finished = { count: 0 };
  return {
    done,
    cursors,
    finished,
    state: async () => ({
      completed: async () => done,
      record: async (key: string) => {
        done.add(key);
        cursors.delete(key);
      },
      cursorOf: (key: string) => cursors.get(key),
      checkpoint: async (key: string, cursor: string) => {
        cursors.set(key, cursor);
      },
      fenced: <T>(write: () => Promise<T>) => write(),
      finish: async () => {
        finished.count += 1;
      },
    }),
  };
}

/** The refusal a write meets once a newer run has replaced its own. */
async function supersededRefusal(): Promise<unknown> {
  // A database whose run row no longer carries the pass's token: the fence's
  // update matches nothing.
  const tx = {
    table: () => new Proxy({}, { get: () => ({}) }),
    update: () => ({ where: async () => 0 }),
  } as unknown as PluginTransaction;
  const db = {
    transaction: <R>(fn: (handle: PluginTransaction) => Promise<R>) => fn(tx),
  };
  return usageBookkeeping(db, "postgresql")
    .fenced("replaced", async () => undefined)
    .catch((error: unknown) => error);
}

/**
 * A rebuild over `documents`, walking them in order after the walk's cursor,
 * and stopping as a real one does: after a document, when the budget is
 * spent, recording that document first.
 */
function walkOver(documents: readonly string[], walked: string[]) {
  return async (
    _sc: BackfillScope,
    walk: {
      after?: string;
      checkpoint(cursor: string): Promise<void>;
      stop(): boolean;
    }
  ) => {
    const start =
      walk.after === undefined ? 0 : documents.indexOf(walk.after) + 1;
    for (const id of documents.slice(start)) {
      walked.push(id);
      if (walk.stop()) {
        await walk.checkpoint(id);
        return { finished: false };
      }
    }
    return WHOLE;
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
        return WHOLE;
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
        return WHOLE;
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
      rebuild: async () => WHOLE,
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
        return WHOLE;
      },
      clock: () => PASS_START,
    });

    await job.handler(null as never, context(10_000) as never);

    expect(rebuilds).toBe(0);
  });

  it("STOPS inside a scope at the deadline, and the next tick resumes after it", async () => {
    // A scope larger than one tick used to start again on every tick and never
    // finish. The cursor is what lets the second tick pick up at d2.
    const s = store();
    const walked: string[] = [];
    let ticks = 0;
    let spentFrom = 2;
    const job = usageBackfillJob({
      scopes: async () => [scope("a")],
      state: s.state,
      rebuild: walkOver(["d1", "d2", "d3"], walked),
      // The first check, before the scope, is within budget; the one after d1
      // is past it. The second tick's budget never runs out.
      clock: () => {
        ticks += 1;
        return ticks >= spentFrom ? PASS_START + 10_000 : PASS_START;
      },
    });

    await job.handler(null as never, context(5_000) as never);
    expect({ walked: [...walked], done: [...s.done] }).toEqual({
      walked: ["d1"],
      done: [],
    });

    spentFrom = Number.POSITIVE_INFINITY;
    await job.handler(null as never, context(5_000) as never);
    expect({ walked, done: [...s.done] }).toEqual({
      walked: ["d1", "d2", "d3"],
      done: [backfillScopeKey(scope("a"))],
    });
  });

  it("clears the dirty mark only on the tick that walks the LAST scope", async () => {
    // Cleared early, a failed write would stop showing while documents after
    // the cursor were still unwalked.
    const s = store();
    let ticks = 0;
    const job = usageBackfillJob({
      scopes: async () => [scope("a"), scope("b")],
      state: s.state,
      rebuild: async () => WHOLE,
      clock: () => {
        ticks += 1;
        return ticks > 1 ? PASS_START + 10_000 : PASS_START;
      },
    });

    await job.handler(null as never, context(5_000) as never);
    expect(s.finished.count).toBe(0);

    ticks = Number.NEGATIVE_INFINITY;
    await job.handler(null as never, context(5_000) as never);
    expect(s.finished.count).toBe(1);
  });

  it("ends QUIETLY when a newer run has replaced the one it walks", async () => {
    // The newer run walks every scope itself; failing the job would only
    // retry work that is already being redone.
    const s = store();
    const refusal = await supersededRefusal();
    const job = usageBackfillJob({
      scopes: async () => [scope("a")],
      state: s.state,
      rebuild: async () => {
        throw refusal;
      },
      clock: () => PASS_START,
    });

    await expect(
      job.handler(null as never, context(10_000) as never)
    ).resolves.toBeUndefined();
    expect([...s.done]).toEqual([]);
  });

  it("CONTROL: still fails on any other error", async () => {
    const s = store();
    const job = usageBackfillJob({
      scopes: async () => [scope("a")],
      state: s.state,
      rebuild: async () => {
        throw new Error("the database went away");
      },
      clock: () => PASS_START,
    });

    await expect(
      job.handler(null as never, context(10_000) as never)
    ).rejects.toThrow("the database went away");
  });

  it("is declared a sweep, which is what keeps one queued", async () => {
    // Without this the handler is registered and nothing ever enqueues it - a
    // job that exists, is reachable, and never runs.
    const job = usageBackfillJob({
      scopes: async () => [],
      state: store().state,
      rebuild: async () => WHOLE,
    });

    expect({ sweep: job.sweep, slug: job.slug }).toEqual({
      sweep: true,
      slug: "page-builder:usage-backfill",
    });
  });
});
