/**
 * A batch whose `beforeRemove` holds it back keeps its own rows for the next
 * batch, which goes on from what the first removed; a held-back batch that
 * removed nothing ends the sweep rather than repeating itself.
 */
import { describe, expect, it, vi } from "vitest";

import {
  pruneInBatches,
  type BeforeRemoveResult,
  type PruneInBatchesAdapter,
} from "../prune-in-batches";

type Row = { id: string; at: Date };
type Condition = { column: string; op: string; value: unknown };

/** A one-table adapter that understands the two conditions the sweep writes. */
function tableOf(rows: Row[]): {
  adapter: PruneInBatchesAdapter;
  ids: () => string[];
} {
  const matches = (row: Row, where: { and?: Condition[] } | undefined) =>
    (where?.and ?? []).every(condition => {
      const value = row[condition.column as keyof Row];
      if (condition.op === "<") return value < (condition.value as Date);
      if (condition.op === "IN") {
        return (condition.value as string[]).includes(value as string);
      }
      throw new Error(`unexpected operator ${condition.op}`);
    });
  const adapter = {
    select: (_table: string, query: { where?: { and?: Condition[] } }) =>
      Promise.resolve(
        rows.filter(row => matches(row, query.where)).map(row => ({ ...row }))
      ),
    delete: (_table: string, where: { and?: Condition[] }) => {
      const before = rows.length;
      rows.splice(0, rows.length, ...rows.filter(row => !matches(row, where)));
      return Promise.resolve(before - rows.length);
    },
  } as unknown as PruneInBatchesAdapter;
  return { adapter, ids: () => rows.map(row => row.id) };
}

const cutoff = new Date("2026-01-02T00:00:00Z");
const expired = { id: "expired", at: new Date("2026-01-01T00:00:00Z") };

describe("pruneInBatches holds a batch back for what its rows take", () => {
  it("keeps the batch's rows until what they take is gone, then removes them", async () => {
    const { adapter, ids } = tableOf([{ ...expired }]);
    const seen: string[][] = [];
    const answers: BeforeRemoveResult[] = [
      { removed: 500, holdBack: true },
      { removed: 2 },
    ];
    const beforeRemove = vi.fn(() => {
      seen.push(ids());
      return Promise.resolve(answers.shift() ?? { removed: 0 });
    });

    const result = await pruneInBatches(adapter, {
      table: "t",
      key: "id",
      at: "at",
      cutoff,
      beforeRemove,
    });

    expect(beforeRemove).toHaveBeenCalledTimes(2);
    // Held back the first time, so still there when the next batch read it.
    expect(seen).toEqual([["expired"], ["expired"]]);
    expect(ids()).toEqual([]);
    expect(result).toEqual({ removed: 503, started: true });
  });

  it("ends the sweep when a held-back batch removed nothing", async () => {
    const { adapter, ids } = tableOf([{ ...expired }]);
    const beforeRemove = vi.fn(() =>
      Promise.resolve({ removed: 0, holdBack: true })
    );

    const result = await pruneInBatches(adapter, {
      table: "t",
      key: "id",
      at: "at",
      cutoff,
      beforeRemove,
    });

    expect(beforeRemove).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(["expired"]);
    expect(result).toEqual({ removed: 0, started: true });
  });
});
