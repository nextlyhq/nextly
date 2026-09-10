/**
 * What the progress store treats as progress, and what it throws away.
 *
 * A recorded scope is a claim about the INDEX, not about a walk in the
 * abstract. That is why it carries the generation it was made under, and why a
 * row from another generation is discarded rather than kept for later: the
 * intervening generation MUTATED the index, so returning to earlier bounds
 * finds old rows standing over an index they no longer describe.
 *
 * @module usage-backfill-progress.test
 */
import { describe, expect, it } from "vitest";

import { usageBackfillStateStore } from "./class-usage-runtime";

/** A progress table as rows, recording what was deleted from it. */
function table(rows: { id: string; scopeKey: string; generation: string }[]) {
  const deleted: string[] = [];
  const created: Record<string, unknown>[] = [];
  const nextly = {
    find: async () => ({ items: [...rows], meta: { hasNext: false } }),
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return undefined;
    },
    delete: async (args: { id: string }) => {
      deleted.push(args.id);
      return undefined;
    },
  };
  return { deleted, created, nextly };
}

describe("reading which scopes are already done", () => {
  it("counts only rows from the generation being built", async () => {
    const t = table([
      { id: "r1", scopeKey: "here", generation: "10x500x1000" },
      { id: "r2", scopeKey: "elsewhere", generation: "10x400x1000" },
    ]);
    const store = usageBackfillStateStore(
      t.nextly as never,
      "state",
      "10x500x1000"
    );

    expect([...(await store.completed())]).toEqual(["here"]);
  });

  it("DISCARDS the other generation's rows rather than leaving them", async () => {
    // The half that makes the filter sound. Leaving them means moving the
    // bounds back finds old progress intact over an index the intervening
    // generation changed — lowering `maxNodes` removed references, and
    // returning to the higher bound would report those scopes complete without
    // restoring them, presenting an undercount as exact.
    const t = table([
      { id: "r1", scopeKey: "here", generation: "10x500x1000" },
      { id: "r2", scopeKey: "elsewhere", generation: "10x400x1000" },
    ]);
    const store = usageBackfillStateStore(
      t.nextly as never,
      "state",
      "10x500x1000"
    );

    await store.completed();

    expect(t.deleted).toEqual(["r2"]);
  });

  it("keeps this generation's rows, so a pass does not undo its own work", async () => {
    // The control on the deletion: an implementation that cleared everything
    // would satisfy the case above and never finish a backfill.
    const t = table([
      { id: "r1", scopeKey: "here", generation: "10x500x1000" },
    ]);
    const store = usageBackfillStateStore(
      t.nextly as never,
      "state",
      "10x500x1000"
    );

    await store.completed();

    expect(t.deleted).toEqual([]);
  });

  it("stamps the generation on what it records", async () => {
    const t = table([]);
    const store = usageBackfillStateStore(
      t.nextly as never,
      "state",
      "10x500x1000"
    );

    await store.record("a-scope");

    expect(t.created).toEqual([
      { scopeKey: "a-scope", generation: "10x500x1000" },
    ]);
  });
});
