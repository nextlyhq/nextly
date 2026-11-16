/**
 * That a backfill makes progress, records it durably, and knows when it is done.
 *
 * The three properties that make it safe to run from a shared drain: one scope
 * per pass so it cannot starve the queue or time out for ever; a scope recorded
 * only AFTER its walk resolved, so a crash costs a repeat rather than a hole;
 * and completion derived from the scopes that exist NOW, so a site that grows
 * goes back to reporting a floor.
 *
 * @module usage-backfill.test
 */
import { describe, expect, it } from "vitest";

import {
  advanceBackfill,
  backfillComplete,
  type ScopeWalk,
} from "./usage-backfill";
import { backfillScopeKey, type BackfillScope } from "./usage-backfill-scope";

function scope(field: string): BackfillScope {
  return {
    scope: "collection",
    entity: "pages",
    field,
    locale: "",
    variant: "published",
  };
}

/** What a rebuild that walked its scope to the end answers. */
const WHOLE = { finished: true };

/** A state store over a plain set, recording what it was told and when. */
function store(initial: string[] = [], cursors = new Map<string, string>()) {
  const done = new Set(initial);
  const recorded: string[] = [];
  const checkpoints: string[] = [];
  // Counted, because the production store answers `completed()` by paging the
  // whole progress collection — so "did this read the store at all" is the
  // property, not an implementation detail.
  const counter = { reads: 0 };
  return {
    done,
    recorded,
    checkpoints,
    get reads() {
      return counter.reads;
    },
    state: {
      completed: async () => {
        counter.reads += 1;
        return done;
      },
      record: async (key: string) => {
        recorded.push(key);
        done.add(key);
      },
      cursorOf: (key: string) => cursors.get(key),
      checkpoint: async (key: string, cursor: string) => {
        checkpoints.push(`${key}@${cursor}`);
        cursors.set(key, cursor);
      },
      fenced: <T>(write: () => Promise<T>) => write(),
      finish: async () => undefined,
    },
  };
}

describe("advancing a backfill", () => {
  it("walks ONE scope per pass, however many are outstanding", async () => {
    // Unbounded is the failure that does not announce itself: the pass shares a
    // drain with every other job, and on a serverless deploy it is retried from
    // the beginning for ever, never finishing and never recording progress.
    const s = store();
    const walked: string[] = [];

    const pass = await advanceBackfill({
      scopes: [scope("a"), scope("b"), scope("c")],
      state: s.state,
      rebuild: async sc => {
        walked.push(sc.field);
        return WHOLE;
      },
    });

    expect({ walked, complete: pass.complete }).toEqual({
      walked: ["a"],
      complete: false,
    });
  });

  it("resumes at the first scope no pass has recorded", async () => {
    const s = store([backfillScopeKey(scope("a"))]);
    const walked: string[] = [];

    await advanceBackfill({
      scopes: [scope("a"), scope("b")],
      state: s.state,
      rebuild: async sc => {
        walked.push(sc.field);
        return WHOLE;
      },
    });

    expect(walked).toEqual(["b"]);
  });

  it("reports complete on the pass that finishes the LAST scope", async () => {
    // Without this the caller has to run one more pass to learn it is done,
    // and a sweep that always has one more pass to run never goes quiet.
    const s = store([backfillScopeKey(scope("a"))]);

    const pass = await advanceBackfill({
      scopes: [scope("a"), scope("b")],
      state: s.state,
      rebuild: async () => WHOLE,
    });

    expect({ walked: pass.walked?.field, complete: pass.complete }).toEqual({
      walked: "b",
      complete: true,
    });
  });

  it("does nothing, and spends no rebuild, once every scope is recorded", async () => {
    const s = store([backfillScopeKey(scope("a"))]);
    let rebuilds = 0;

    const pass = await advanceBackfill({
      scopes: [scope("a")],
      state: s.state,
      rebuild: async () => {
        rebuilds += 1;
        return WHOLE;
      },
    });

    expect({ pass, rebuilds }).toEqual({
      pass: {
        walked: null,
        complete: true,
        completed: new Set([backfillScopeKey(scope("a"))]),
        finished: true,
      },
      rebuilds: 0,
    });
  });

  it("takes the completed set a caller supplies instead of reading the store", async () => {
    /*
     * The store answers `completed()` by paging the whole progress collection,
     * so a handler making one pass per scope paged it once per scope — quadratic
     * in the number of scopes, and on a site of many small ones most of what the
     * drain does.
     */
    const s = store([backfillScopeKey(scope("a"))]);
    let rebuilds = 0;

    const pass = await advanceBackfill({
      scopes: [scope("a")],
      state: s.state,
      rebuild: async () => {
        rebuilds += 1;
        return WHOLE;
      },
      completed: new Set([backfillScopeKey(scope("a"))]),
    });

    expect({ walked: pass.walked, rebuilds, reads: s.reads }).toEqual({
      walked: null,
      rebuilds: 0,
      reads: 0,
    });
  });

  it("hands back the set INCLUDING what it just recorded, so the next pass sees it", async () => {
    // Threading a stale set would make the next pass pick the same scope again
    // and walk it twice — which is the cost this exists to avoid, paid twice.
    const s = store();

    const first = await advanceBackfill({
      scopes: [scope("a"), scope("b")],
      state: s.state,
      rebuild: async () => WHOLE,
      completed: new Set<string>(),
    });

    expect(first.completed.has(backfillScopeKey(scope("a")))).toBe(true);

    const second = await advanceBackfill({
      scopes: [scope("a"), scope("b")],
      state: s.state,
      rebuild: async () => WHOLE,
      completed: first.completed,
    });

    expect(second.walked).toEqual(scope("b"));
  });

  it("does NOT record a scope whose rebuild rejected", async () => {
    // The direction that destroys data quietly: a scope marked done that was
    // never walked is one no later pass revisits, so its documents stay
    // unindexed while readiness reports the index whole.
    const s = store();

    await expect(
      advanceBackfill({
        scopes: [scope("a")],
        state: s.state,
        rebuild: async () => {
          throw new Error("the database went away");
        },
      })
    ).rejects.toThrow("the database went away");

    expect(s.recorded).toEqual([]);
  });

  it("retries that same scope on the next pass", async () => {
    // The other half of refusing to record: the work has to come back, or
    // refusing merely loses it more slowly.
    const s = store();
    const walked: string[] = [];

    await advanceBackfill({
      scopes: [scope("a")],
      state: s.state,
      rebuild: async sc => {
        walked.push(sc.field);
        return WHOLE;
      },
    });
    // A second store, standing for a pass that crashed before recording.
    const crashed = store();
    await advanceBackfill({
      scopes: [scope("a")],
      state: crashed.state,
      rebuild: async sc => {
        walked.push(sc.field);
        return WHOLE;
      },
    });

    expect(walked).toEqual(["a", "a"]);
  });
});

describe("a scope larger than one tick", () => {
  it("resumes the walk after the cursor an earlier tick recorded", async () => {
    // Without the cursor each tick would start the scope again and, on a
    // scope larger than a tick, never reach its end.
    const key = backfillScopeKey(scope("a"));
    const s = store([], new Map([[key, "doc-5"]]));
    let resumedAfter: string | undefined;

    await advanceBackfill({
      scopes: [scope("a")],
      state: s.state,
      rebuild: async (_sc, walk) => {
        resumedAfter = walk.after;
        return WHOLE;
      },
    });

    expect(resumedAfter).toBe("doc-5");
  });

  it("records the walk's checkpoints under the scope's key", async () => {
    const s = store();
    await advanceBackfill({
      scopes: [scope("a")],
      state: s.state,
      rebuild: async (_sc, walk: ScopeWalk) => {
        await walk.checkpoint("doc-1");
        return { finished: false };
      },
    });

    expect(s.checkpoints).toEqual([`${backfillScopeKey(scope("a"))}@doc-1`]);
  });

  it("does NOT record a scope the budget stopped inside", async () => {
    // Recorded, a half-walked scope would never be revisited, and the
    // documents after the cursor would stay unindexed while health said whole.
    const s = store();

    const pass = await advanceBackfill({
      scopes: [scope("a"), scope("b")],
      state: s.state,
      rebuild: async () => ({ finished: false }),
    });

    expect({ recorded: s.recorded, pass }).toEqual({
      recorded: [],
      pass: {
        walked: scope("a"),
        complete: false,
        completed: new Set(),
        finished: false,
      },
    });
  });

  it("hands the walk the caller's budget", async () => {
    const s = store();
    let asked = false;
    await advanceBackfill({
      scopes: [scope("a")],
      state: s.state,
      stop: () => {
        asked = true;
        return true;
      },
      rebuild: async (_sc, walk) => ({ finished: !walk.stop() }),
    });
    expect(asked).toBe(true);
  });
});

describe("deciding whether the index has been walked whole", () => {
  it("is false while any scope that exists now is unrecorded", async () => {
    expect(
      backfillComplete(
        [scope("a"), scope("b")],
        new Set([backfillScopeKey(scope("a"))])
      )
    ).toBe(false);
  });

  it("goes BACK to false when a new scope appears", async () => {
    // Why completion is recomputed rather than latched. A stored "done" flag is
    // true about the site it was written for; add a collection, a locale or
    // drafts and there are scopes nothing has walked, while the flag still says
    // the index is whole.
    const recorded = new Set([backfillScopeKey(scope("a"))]);

    expect({
      before: backfillComplete([scope("a")], recorded),
      afterGrowth: backfillComplete([scope("a"), scope("b")], recorded),
    }).toEqual({ before: true, afterGrowth: false });
  });

  it("is true for a site with no blocks field anywhere", async () => {
    // An empty scope list is FINISHED, not short. Reporting a floor here would
    // caveat every count on a site that can never have one.
    expect(backfillComplete([], new Set())).toBe(true);
  });
});
