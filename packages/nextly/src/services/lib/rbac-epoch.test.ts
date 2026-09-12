import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";

import {
  EPOCH_TTL_MS,
  bumpEpoch,
  currentEpoch,
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
type Row = { revision: number };

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
    install(fakeAdapter(() => [{ revision: 7 }]));

    expect(currentEpoch()).toBe(0);
    await expect(refreshEpoch()).resolves.toBe(7);
    expect(currentEpoch()).toBe(7);
  });

  it("takes another instance's bump on the next refresh", async () => {
    // The property the whole module exists for: a change this process did not
    // make still retires what it has cached.
    let shared = 3;
    install(fakeAdapter(() => [{ revision: shared }]));

    await refreshEpoch();
    expect(currentEpoch()).toBe(3);

    shared = 4;
    vi.advanceTimersByTime(EPOCH_TTL_MS);
    await refreshEpoch();

    expect(currentEpoch()).toBe(4);
  });

  it("reads at most once per interval, so the hot path is not a query", async () => {
    // The control on the case above. Without it, "it sees the new value" is
    // satisfied by reading on every single check, which is the cost this design
    // exists to avoid.
    let reads = 0;
    install(
      fakeAdapter(() => {
        reads += 1;
        return [{ revision: 1 }];
      })
    );

    await refreshEpoch();
    await refreshEpoch();
    await refreshEpoch();

    expect(reads).toBe(1);
  });

  it("never goes backwards, even if a read returns an older value", async () => {
    // A local bump can land while a read is in flight. Taking the older answer
    // would re-serve exactly what that bump retired.
    install(fakeAdapter(() => [{ revision: 1 }]));
    await refreshEpoch();

    await bumpEpoch();
    const afterBump = currentEpoch();
    expect(afterBump).toBe(2);

    // The shared row still answers 1, as it would for a read that raced.
    vi.advanceTimersByTime(EPOCH_TTL_MS);
    await refreshEpoch();

    expect(currentEpoch()).toBe(afterBump);
  });

  it("moves this process's own value before the shared write", async () => {
    // An instance must honour its own revocation immediately rather than
    // waiting out the interval it uses for everyone else's.
    install(fakeAdapter(() => [{ revision: 0 }]));
    await refreshEpoch();

    await bumpEpoch();

    expect(currentEpoch()).toBe(1);
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

    await expect(refreshEpoch()).resolves.toBe(0);
    await expect(bumpEpoch()).resolves.toBe(1);
    expect(currentEpoch()).toBe(1);
  });

  it("still invalidates locally when the shared write fails", async () => {
    // The half of degrading that matters. A shared write nobody can make must
    // not stop this process retiring its own caches, or a failed upgrade turns
    // a staleness bug into a revocation that never happens anywhere.
    install({
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: () => {
        throw new Error("unwritable");
      },
    });

    const before = currentEpoch();
    await bumpEpoch();

    expect(currentEpoch()).toBeGreaterThan(before);
  });

  it("treats a missing row as epoch zero rather than as a failure", async () => {
    // A table that exists with nothing in it is a fresh install that has never
    // invalidated, which is zero — not an error, and not a reason to degrade.
    install(fakeAdapter(() => []));

    await expect(refreshEpoch()).resolves.toBe(0);
  });
});
