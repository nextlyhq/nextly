import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";

import {
  EPOCH_TTL_MS,
  bumpEpoch,
  currentEpoch,
  epochIsTrustworthy,
  refreshEpoch,
  resetEpochForTests,
} from "./rbac-epoch";

/**
 * The epoch answers for the INSTALL, and keeps answering when it cannot.
 *
 * Two properties matter and they pull against each other. It has to reflect a
 * change made by another instance, which is the whole reason it left memory.
 * And it must never fail an authorization check to do so: an install upgraded
 * from a version without the table has nothing to read until its core tables
 * are reconciled, and refusing every request until then would be a worse
 * outcome than the staleness this replaces.
 *
 * A fake adapter rather than a database, because what is under test is the
 * read-and-cache logic rather than SQL. The statements themselves are exercised
 * against real databases by the integration suite that drives invalidation end
 * to end.
 */
type Row = { revision: number; generation: string };

function chainOf(result: unknown) {
  const self: Record<string, unknown> = {
    from: () => self,
    where: () => self,
    set: () => self,
    values: () => self,
    limit: () => self,
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  return self;
}

function fakeAdapter(rows: () => Row[], onWrite?: () => void) {
  const chain = (result: unknown) => {
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      set: () => self,
      values: () => self,
      limit: () => self,
      then: (resolve: (value: unknown) => unknown) => resolve(result),
    };
    return self;
  };
  return {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: () => ({
      select: () => chain(rows()),
      update: () => {
        onWrite?.();
        return chain([{ changes: 1 }]);
      },
      insert: () => chain([{ changes: 1 }]),
    }),
  };
}

function install(adapter: unknown) {
  container.register("adapter", () => adapter);
}

describe("the RBAC epoch answers for the install", () => {
  beforeEach(() => {
    resetEpochForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetEpochForTests();
  });

  it("starts at zero and reads the shared value", async () => {
    install(fakeAdapter(() => [{ revision: 7, generation: "g" }]));

    expect(currentEpoch()).toBe(":0");
    await expect(refreshEpoch()).resolves.toBe("g:7");
    expect(currentEpoch()).toBe("g:7");
  });

  it("takes another instance's bump on the next refresh", async () => {
    // The property the whole module exists for: a change this process did not
    // make still retires what it has cached.
    let shared = 3;
    install(fakeAdapter(() => [{ revision: shared, generation: "g" }]));

    await refreshEpoch();
    expect(currentEpoch()).toBe("g:3");

    shared = 4;
    vi.advanceTimersByTime(EPOCH_TTL_MS);
    await refreshEpoch();

    expect(currentEpoch()).toBe("g:4");
  });

  it("reads at most once per interval, so the hot path is not a query", async () => {
    // The control on the case above. Without it, "it sees the new value" is
    // satisfied by reading on every single check, which is the cost this design
    // exists to avoid.
    let reads = 0;
    install(
      fakeAdapter(() => {
        reads += 1;
        return [{ revision: 1, generation: "g" }];
      })
    );

    await refreshEpoch();
    await refreshEpoch();
    await refreshEpoch();

    expect(reads).toBe(1);
  });

  it("answers only with values the shared row gave it", async () => {
    // The property that removes a whole class of bug. Inventing `epoch + 1`
    // locally means two counters that both advance, and the local one then
    // wins every comparison — so an instance that bumped while the shared row
    // was unreachable would stay permanently ahead and stop noticing anybody
    // else. Whatever the row says is what this answers.
    let shared = 9;
    install(fakeAdapter(() => [{ revision: shared, generation: "g" }]));
    await refreshEpoch();
    expect(currentEpoch()).toBe("g:9");

    // A bump the row does not reflect must not invent a value: the fake's read
    // still answers 9, so 9 is what this process may claim.
    shared = 9;
    await bumpEpoch();

    expect(currentEpoch()).toBe("g:9");
  });

  it("distrusts its caches while an invalidation is owed", async () => {
    // The fail-safe direction. An epoch other instances have never seen cannot
    // decide whether an answer is current, so nothing may be served from cache
    // until the shared row accepts the change.
    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => {
        throw new Error("no such table: nextly_rbac_epoch");
      },
    });

    expect(epochIsTrustworthy()).toBe(true);
    await bumpEpoch();
    expect(epochIsTrustworthy()).toBe(false);
  });

  it("trusts them again once the shared row accepts the backlog", async () => {
    // The control on the case above, and the recovery path. Without it,
    // "distrusts while owed" is satisfied by never trusting anything again,
    // which would leave an install permanently uncached after one hiccup.
    let reachable = false;
    let shared = 0;
    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => {
        if (!reachable) throw new Error("unreachable");
        return {
          select: () => chainOf([{ revision: shared, generation: "g" }]),
          // The real statement is an upsert, so the fake has to be one too: a
          // fake that only models the UPDATE reports a backlog as persisted
          // while the counter never moves.
          insert: () => {
            const chain = chainOf([{ changes: 1 }]) as Record<string, unknown>;
            chain.values = () => chain;
            chain.onConflictDoUpdate = () => {
              shared += 1;
              return Promise.resolve([{ changes: 1 }]);
            };
            return chain;
          },
          update: () => chainOf([{ changes: 1 }]),
        };
      },
    });

    await bumpEpoch();
    expect(epochIsTrustworthy()).toBe(false);

    reachable = true;
    vi.advanceTimersByTime(EPOCH_TTL_MS);
    await refreshEpoch();

    expect(epochIsTrustworthy()).toBe(true);
    // And the invalidation made while unreachable reached the row rather than
    // being dropped on the way.
    expect(shared).toBeGreaterThan(0);
  });

  it("collapses concurrent refreshes onto one read", async () => {
    // The interval bounds when a read may START, not how many run. Every check
    // arriving after expiry sees the same stale timestamp, so without sharing
    // the in-flight promise a burst issues one query per request.
    let reads = 0;
    install(
      fakeAdapter(() => {
        reads += 1;
        return [{ revision: 1, generation: "g" }];
      })
    );

    await Promise.all([refreshEpoch(), refreshEpoch(), refreshEpoch()]);

    expect(reads).toBe(1);
  });

  it("rate-limits FAILING reads too, so a missing table is not a query storm", async () => {
    // The upgrade window. Leaving the timestamp unset on failure means one
    // failing query per authorization check rather than one per interval.
    let attempts = 0;
    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => {
        attempts += 1;
        throw new Error("no such table");
      },
    });

    await refreshEpoch();
    await refreshEpoch();
    await refreshEpoch();

    expect(attempts).toBe(1);
  });

  it("forces a read when told to, whatever the interval says", async () => {
    // The post-write verification depends on this: the window it closes is the
    // write's own flight time, so a revocation inside it is newer than the last
    // read by definition.
    let shared = 1;
    install(fakeAdapter(() => [{ revision: shared, generation: "g" }]));
    await refreshEpoch();

    shared = 2;
    await expect(refreshEpoch()).resolves.toBe("g:1");
    await expect(refreshEpoch({ force: true })).resolves.toBe("g:2");
  });

  it("keeps answering when the table cannot be read", async () => {
    // An install that has not reconciled its core tables has no row to read.
    // Degrading to a local counter is what it had before; failing the check
    // would be worse than not having upgraded at all.
    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => {
        throw new Error("no such table: nextly_rbac_epoch");
      },
    });

    // Neither call throws, which is the property: an authorization check must
    // not fail because a counter is unreachable.
    await expect(refreshEpoch()).resolves.toBe(":0");
    await expect(bumpEpoch()).resolves.toBe(":0");
  });

  it("still takes effect locally when the shared write fails", async () => {
    // The half of degrading that matters. A shared write nobody can make must
    // not stop this process retiring its own caches, or a failed upgrade turns
    // a staleness bug into a revocation that never happens anywhere.
    //
    // It takes effect by refusing to serve rather than by moving the number.
    // Moving it would invent a value no other instance has seen, which is the
    // divergence this model exists to make unrepresentable.
    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => {
        throw new Error("unwritable");
      },
    });

    await bumpEpoch();

    expect(epochIsTrustworthy()).toBe(false);
  });

  it("treats a missing row as epoch zero rather than as a failure", async () => {
    // A table that exists with nothing in it is a fresh install that has never
    // invalidated, which is zero — not an error, and not a reason to degrade.
    install(fakeAdapter(() => []));

    await expect(refreshEpoch()).resolves.toBe(":0");
  });
});
