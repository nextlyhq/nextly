/**
 * A registry write that joins a save's file transaction is not what other connections read until
 * that transaction commits, so the cached registry rows are cleared and the schema version
 * signalled again once it has (`afterEnclosingCommit`); outside a transaction nothing more is owed.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signals = vi.hoisted(() => ({ cleared: 0, bumped: 0 }));

vi.mock(
  "../../../domains/dynamic-collections/services/collection-row-cache",
  () => ({
    clearRegistryRowCache: () => {
      signals.cleared += 1;
    },
  })
);
vi.mock("../../../route-handler/schema-version", () => ({
  bumpSchemaVersion: () => {
    signals.bumped += 1;
    return 0;
  },
}));

import { afterEnclosingCommit } from "../applied-fields-row";

/** An adapter inside a transaction or not, holding each effect `afterCommit` is given. */
function adapterThat(inTransaction: boolean) {
  const held: (() => unknown)[] = [];
  const adapter = {
    inTransaction: () => inTransaction,
    afterCommit: vi.fn(async (effect: () => unknown) => {
      held.push(effect);
    }),
  };
  return {
    adapter: adapter as unknown as DrizzleAdapter,
    held,
    afterCommit: adapter.afterCommit,
  };
}

describe("a registry write's signals once the transaction it joined commits", () => {
  beforeEach(() => {
    signals.cleared = 0;
    signals.bumped = 0;
  });

  it("clears the cached rows and signals the version only once the transaction commits", async () => {
    const { adapter, held } = adapterThat(true);

    await afterEnclosingCommit(adapter);

    // Held, not run: the row is not what other connections read yet.
    expect(held).toHaveLength(1);
    expect(signals).toEqual({ cleared: 0, bumped: 0 });

    // The commit runs what was held.
    for (const effect of held) await effect();
    expect(signals).toEqual({ cleared: 1, bumped: 1 });
  });

  it("holds nothing outside a transaction, where the write has committed", async () => {
    const { adapter, afterCommit } = adapterThat(false);

    await afterEnclosingCommit(adapter);

    expect(afterCommit).not.toHaveBeenCalled();
    expect(signals).toEqual({ cleared: 0, bumped: 0 });
  });
});
