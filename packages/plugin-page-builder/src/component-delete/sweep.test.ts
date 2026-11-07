/**
 * Delete component's sweep: it turns a run whose delete committed before the
 * run moved into its tombstone, and touches nothing else. A tombstone is never
 * closed, however old.
 */
import { describe, expect, it } from "vitest";

import type { DeletionRun } from "../host-rewrite/fence";

import { sweepComponentDeletes } from "./sweep";

const NOW = new Date("2026-11-06T12:00:00.000Z");

const run = (over: Partial<DeletionRun>): DeletionRun => ({
  id: "r",
  componentId: "card",
  purpose: "delete",
  startedBy: "user:1",
  phase: "deleting",
  cursor: null,
  ...over,
});

function sweep(runs: DeletionRun[], existing: readonly string[] = []) {
  const moves: unknown[] = [];
  return {
    moves,
    pass: () =>
      sweepComponentDeletes({
        deleting: () => Promise.resolve(runs),
        store: () => ({
          markDeleted: async (...args) => {
            moves.push(args);
            return true;
          },
        }),
        exists: id => Promise.resolve(existing.includes(id)),
        now: () => NOW,
      }),
  };
}

describe("the component delete sweep", () => {
  it("makes the tombstone of a run whose component is gone, and leaves one whose component is still there", async () => {
    const s = sweep(
      [run({ componentId: "gone" }), run({ id: "r2", componentId: "kept" })],
      ["kept"]
    );

    await s.pass();

    expect(s.moves).toEqual([["r", NOW.toISOString()]]);
  });

  it("touches no tombstone, however old, no run still converting, and no retired-field run", async () => {
    const s = sweep([
      run({ phase: "deleted", cursor: "2020-01-01T00:00:00.000Z" }),
      run({ id: "r2", phase: "converting" }),
      run({ id: "r3", purpose: "strip-retired" }),
    ]);

    await s.pass();

    expect(s.moves).toEqual([]);
  });
});
