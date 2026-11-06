/**
 * Delete component's sweep: it closes a settled run once its window has
 * passed, settles a run whose delete committed before the run moved, and
 * touches nothing else.
 */
import { describe, expect, it } from "vitest";

import type { DeletionRun } from "../host-rewrite/fence";

import { SETTLE_MS } from "./job";
import { sweepComponentDeletes } from "./sweep";

const NOW = new Date("2026-11-06T12:00:00.000Z");

const run = (over: Partial<DeletionRun>): DeletionRun => ({
  id: "r",
  componentId: "card",
  purpose: "delete",
  startedBy: "user:1",
  phase: "settling",
  cursor: null,
  ...over,
});

function sweep(runs: DeletionRun[], existing: readonly string[] = []) {
  const moves: unknown[] = [];
  const closes: unknown[] = [];
  return {
    moves,
    closes,
    pass: () =>
      sweepComponentDeletes({
        runs: () => Promise.resolve(runs),
        store: () => ({
          advance: async (...args) => {
            moves.push(args);
            return true;
          },
          close: async (...args) => {
            closes.push(args);
          },
        }),
        exists: id => Promise.resolve(existing.includes(id)),
        now: () => NOW,
      }),
  };
}

describe("the component delete sweep", () => {
  it("closes a settled run whose window has passed, and keeps one still settling", async () => {
    const past = new Date(NOW.getTime() - SETTLE_MS).toISOString();
    const recent = new Date(NOW.getTime() - SETTLE_MS + 1000).toISOString();
    const s = sweep([
      run({ componentId: "old", cursor: past }),
      run({ id: "r2", componentId: "new", cursor: recent }),
    ]);

    await s.pass();

    expect(s.closes).toEqual([["old", "delete"]]);
  });

  it("settles a run whose component is gone, and leaves one whose component is still there", async () => {
    const s = sweep(
      [
        run({ componentId: "gone", phase: "deleting" }),
        run({ id: "r2", componentId: "kept", phase: "deleting" }),
      ],
      ["kept"]
    );

    await s.pass();

    expect(s.moves).toEqual([["r", "deleting", "settling", NOW.toISOString()]]);
    expect(s.closes).toEqual([]);
  });

  it("touches no run still converting, and no retired-field run", async () => {
    const s = sweep([
      run({ phase: "converting" }),
      run({ id: "r2", purpose: "strip-retired", phase: "done" }),
    ]);

    await s.pass();

    expect(s.moves).toEqual([]);
    expect(s.closes).toEqual([]);
  });
});
