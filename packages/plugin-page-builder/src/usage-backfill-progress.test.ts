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
function table(
  rows: { id: string; scopeKey: string; generation: string }[],
  options: { deleteFails?: boolean } = {}
) {
  const deleted: string[] = [];
  const created: Record<string, unknown>[] = [];
  const nextly = {
    find: async () => ({ items: [...rows], meta: { hasNext: false } }),
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return undefined;
    },
    delete: async (args: { id: string }) => {
      if (options.deleteFails === true) {
        throw new Error("the database refused the delete");
      }
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

  it("REFUSES when a stale row cannot be discarded", async () => {
    // Swallowing it is only safe if this cleanup runs again BEFORE the bounds
    // return to that row's generation, and nothing guarantees that ordering. A
    // row that outlives the discard is accepted as progress over an index the
    // intervening generation changed — the exact defect the discard exists to
    // prevent, arriving through the mechanism built to stop it.
    const t = table(
      [
        { id: "r1", scopeKey: "here", generation: "10x500x1000" },
        { id: "r2", scopeKey: "elsewhere", generation: "10x400x1000" },
      ],
      { deleteFails: true }
    );
    const store = usageBackfillStateStore(
      t.nextly as never,
      "state",
      "10x500x1000"
    );

    await expect(store.completed()).rejects.toThrow(/could not discard stale/);
  });

  it("REFUSES when a stale row has no id it could be discarded by", async () => {
    // The same defect one step earlier. An `afterRead` hook that strips `id`
    // from the progress collection leaves a stale row that cannot be addressed
    // for deletion, so it outlives the discard exactly as a failed delete
    // would — and is read as completed progress the next time the bounds
    // return to its generation. Skipping it, as an unreadable row elsewhere is
    // skipped, would be the silent version of the failure the case above
    // refuses loudly.
    const t = table([
      { id: "r1", scopeKey: "here", generation: "10x500x1000" },
      { scopeKey: "elsewhere", generation: "10x400x1000" } as never,
    ]);
    const store = usageBackfillStateStore(
      t.nextly as never,
      "state",
      "10x500x1000"
    );

    await expect(store.completed()).rejects.toThrow(/no readable id/);
    // And nothing was deleted on the way: the refusal is the whole answer.
    expect(t.deleted).toEqual([]);
  });
});
