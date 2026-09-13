import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";

import {
  EPOCH_TTL_MS,
  bumpEpoch,
  currentEpoch,
  epochIsTrustworthy,
  refreshEpoch,
  duringRetirement,
  resetEpochForTests,
  stampIsCurrent,
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

/**
 * A shared row that actually applies the increment the statement carries.
 *
 * `fakeAdapter` answers reads and reports writes as successful without moving
 * anything, which cannot show a count applied twice or lost. The upsert's own
 * `values({ revision })` carries the backlog being claimed, so the fake adds
 * exactly what the statement asked the database to add.
 */
function countingAdapter(state: { revision: number; generation: string }) {
  return {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: () => ({
      select: () =>
        chainOf([{ revision: state.revision, generation: state.generation }]),
      insert: () => {
        let owed = 0;
        const self: Record<string, unknown> = {
          values: (row: { revision: number }) => {
            owed = Number(row.revision);
            return self;
          },
          onConflictDoUpdate: () => {
            state.revision += owed;
            return Promise.resolve([{ changes: 1 }]);
          },
          then: (resolve: (value: unknown) => unknown) =>
            resolve([{ changes: 1 }]),
        };
        return self;
      },
      update: () => chainOf([{ changes: 1 }]),
    }),
  };
}

/** A select chain whose answer arrives when the given promise settles. */
function pending(answer: Promise<Row[]>) {
  const self: Record<string, unknown> = {
    from: () => self,
    where: () => self,
    limit: () => self,
    then: (
      resolve: (value: Row[]) => unknown,
      reject: (reason: unknown) => unknown
    ) => answer.then(resolve, reject),
  };
  return self;
}

/**
 * A shared store that actually holds the row, so creating it is observable.
 *
 * `countingAdapter` models the increment; this models the row's EXISTENCE, and
 * whether it was given an identity when it was created.
 */
function storeWithRow(state: { row: Row | null }) {
  return {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: () => ({
      select: () => chainOf(state.row === null ? [] : [state.row]),
      insert: () => {
        let pending: Row | null = null;
        const self: Record<string, unknown> = {
          values: (r: { revision: number; generation: string }) => {
            pending = {
              revision: Number(r.revision),
              generation: r.generation,
            };
            return self;
          },
          onConflictDoUpdate: () => {
            // The database decides: created when absent, left alone when
            // present, which is what makes the identity stable for life.
            if (state.row === null) state.row = pending;
            return Promise.resolve([{ changes: 1 }]);
          },
          then: (resolve: (value: unknown) => unknown) =>
            resolve([{ changes: 1 }]),
        };
        return self;
      },
      update: () => chainOf([{ changes: 1 }]),
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

  it("lands both of two invalidations that race, rather than one", async () => {
    // A second invalidation raised while the first is still writing has to
    // reach the row on its own account. Folded into a write already in flight
    // it is simply gone: no other instance is ever told about it, while this
    // one goes on believing its backlog is persisted.
    const shared = { revision: 0, generation: "g" };
    install(countingAdapter(shared));

    await Promise.all([bumpEpoch(), bumpEpoch()]);

    // Two invalidations, two increments — not one, and not three.
    expect(shared.revision).toBe(2);
    // And nothing is left owed, which is what lets caching resume.
    expect(epochIsTrustworthy()).toBe(true);
  });

  it("does not hand a forced caller a read that began before it", async () => {
    // Forcing exists for the post-write verification, whose window is the
    // write's own flight time. A read already running may have queried before
    // that write, so joining it answers with an observation older than the
    // thing being confirmed — the check then passes on evidence that predates
    // what it is checking.
    let shared = 1;
    let reads = 0;
    let releaseFirst: () => void = () => {};

    function rows() {
      // Snapshotted when the query is ISSUED, which is what makes a held read
      // an old observation rather than a slow one.
      const snapshot = [{ revision: shared, generation: "g" }];
      reads += 1;
      if (reads > 1) return Promise.resolve(snapshot);
      return new Promise<Row[]>(resolve => {
        releaseFirst = () => resolve(snapshot);
      });
    }

    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => ({
        select: () => pending(rows()),
        insert: () => chainOf([{ changes: 1 }]),
        update: () => chainOf([{ changes: 1 }]),
      }),
    });

    const first = refreshEpoch();
    // Let that read reach the database before anything moves under it. Asserted
    // rather than assumed: if it has not started, the case below proves nothing.
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(1);

    // The change a forced caller is verifying, made while the first read is out.
    shared = 2;
    const forced = refreshEpoch({ force: true });

    releaseFirst();
    await expect(first).resolves.toBe("g:1");
    await expect(forced).resolves.toBe("g:2");
    expect(reads).toBe(2);
  });

  it("refuses a stamp that matches while an invalidation is still owed", async () => {
    // The whole reason the tiers ask this rather than comparing stamps
    // themselves. The stamp matches — it is the value this process is
    // answering with — and it matches nothing any other instance has seen,
    // because the change that produced it never reached the shared row.
    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => {
        throw new Error("no such table: nextly_rbac_epoch");
      },
    });

    const stamp = currentEpoch();
    expect(stampIsCurrent(stamp)).toBe(true);

    await bumpEpoch();

    expect(currentEpoch()).toBe(stamp);
    expect(stampIsCurrent(stamp)).toBe(false);
  });

  it("accepts a matching stamp and refuses a stale one when nothing is owed", async () => {
    // The control on both halves. Without the first, "refuses while owed" is
    // satisfied by refusing everything; without the second, by accepting
    // everything.
    install(fakeAdapter(() => [{ revision: 4, generation: "g" }]));
    await refreshEpoch();

    expect(stampIsCurrent("g:4")).toBe(true);
    expect(stampIsCurrent("g:3")).toBe(false);
  });

  it("gives a store with no row an identity instead of a shared zero", async () => {
    // `:0` is what every never-yet-invalidated store answered, so two of them
    // were indistinguishable — and a failover onto a different one, or a
    // restore from a backup taken before the first role change, left every
    // cached answer looking current. Epoch zero is where a fresh install sits
    // for longest, which is the worst place to have no identity.
    const store = { row: null as Row | null };
    install(storeWithRow(store));

    await refreshEpoch();

    expect(store.row).not.toBeNull();
    expect(currentEpoch()).not.toBe(":0");
    expect(currentEpoch()).toBe(`${store.row?.generation}:0`);
  });

  it("gives a DIFFERENT store a different one, which is the whole point", async () => {
    // The control, and the property itself. An identity that is the same for
    // every empty store is the `:0` this replaced.
    const first = { row: null as Row | null };
    install(storeWithRow(first));
    await refreshEpoch();
    const before = currentEpoch();

    // A different store, reached by the same process: a failover, or a restore.
    resetEpochForTests();
    const second = { row: null as Row | null };
    install(storeWithRow(second));
    await refreshEpoch();

    expect(currentEpoch()).not.toBe(before);
  });

  it("stays untrusted when the write landed but the read did not", async () => {
    // The half that made a landed write look settled. The count is clear —
    // the row really did move — so every stamp comparison starts passing
    // again, against the value from BEFORE the write.
    let reads = 0;
    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => ({
        select: () => {
          reads += 1;
          if (reads === 1) return chainOf([{ revision: 3, generation: "g" }]);
          throw new Error("the row cannot be read");
        },
        insert: () => chainOf([{ changes: 1 }]),
        update: () => chainOf([{ changes: 1 }]),
      }),
    });

    await refreshEpoch();
    const stamp = currentEpoch();
    expect(stampIsCurrent(stamp)).toBe(true);

    // The write lands; the read that should have followed it does not.
    await bumpEpoch();

    expect(currentEpoch()).toBe(stamp);
    expect(epochIsTrustworthy()).toBe(false);
    expect(stampIsCurrent(stamp)).toBe(false);
  });

  it("trusts it again once a read finally succeeds", async () => {
    // The control on the case above, and the recovery path: without it,
    // "untrusted after an unread write" is satisfied by never trusting again.
    const shared = { revision: 0, generation: "g" };
    install(countingAdapter(shared));

    await bumpEpoch();

    expect(epochIsTrustworthy()).toBe(true);
  });

  it("serves nothing while a retirement is running", async () => {
    // A retirement empties caches, and emptying the shared tier is an awaited
    // write: inside that window the stored rows are still readable and the
    // epoch has not moved, so a check starting and finishing there compares
    // two values that never changed. Every tier asks this one predicate, which
    // is what reaches the caches that are not maps in this module.
    install(fakeAdapter(() => [{ revision: 1, generation: "g" }]));
    await refreshEpoch();
    const stamp = currentEpoch();

    const during = await duringRetirement(async () => stampIsCurrent(stamp));

    expect(during).toBe(false);
    // And the control: it is current again once the retirement is over,
    // otherwise "refuses during" is satisfied by refusing always.
    expect(stampIsCurrent(stamp)).toBe(true);
  });

  it("releases the retirement even when the work throws", async () => {
    // A partial retirement is exactly when serving from cache is worst, and a
    // scope that leaked would leave the install permanently uncached.
    install(fakeAdapter(() => [{ revision: 1, generation: "g" }]));
    await refreshEpoch();
    const stamp = currentEpoch();

    await expect(
      duringRetirement(async () => {
        throw new Error("half the retirement landed");
      })
    ).rejects.toThrow("half the retirement landed");

    expect(stampIsCurrent(stamp)).toBe(true);
  });

  it("answers zero rather than failing when the seed does not take", async () => {
    // This fake accepts the write and stays empty, which is what a store that
    // silently refuses the create looks like from here. Zero is the honest
    // answer: a table that exists with nothing in it has never invalidated,
    // which is not an error and not a reason to refuse an authorization check.
    // It costs the identity, and the case above is what buys that back
    // wherever the create does take.
    install(fakeAdapter(() => []));

    await expect(refreshEpoch()).resolves.toBe(":0");
  });
});
