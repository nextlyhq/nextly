/**
 * Re-queueing a document written while its component is fenced: the pending
 * row and the run's return to its converting walk land together or not at
 * all, so a run never sits done (or in its final walk) holding a pending
 * document nobody will visit.
 */
import { describe, expect, it } from "vitest";

import { componentDeletionHosts, componentDeletions } from "../schema/tables";

import { progressStore } from "./progress";

/** Any column a query names, for predicates the fake does not read. */
const columns = new Proxy(
  {},
  { get: (_target, key) => ({ name: String(key) }) }
);

/**
 * A database whose transactions keep their writes only when they finish, and
 * whose run-table update fails when told to. The hosts table holds one row
 * for `doc` when `held` names its state.
 */
function database(failPhaseUpdate: boolean, held?: string) {
  const committed: Record<string, unknown>[] = [];
  const surface = (staged: Record<string, unknown>[]) => ({
    table: () => columns as never,
    select: (table: unknown) => ({
      where: () => ({
        all: async () =>
          table === componentDeletions
            ? [{ id: "run-1", componentId: "card", purpose: "delete" }]
            : [],
        first: async () =>
          table === componentDeletionHosts && held !== undefined
            ? { hostKey: "doc", state: held }
            : null,
      }),
    }),
    update: (table: unknown, set: Record<string, unknown>) => ({
      where: async () => {
        if (table === componentDeletions && failPhaseUpdate) {
          throw new Error("the connection dropped");
        }
        if (table === componentDeletionHosts) staged.push({ update: set });
        return 1;
      },
    }),
    insert: async (table: unknown, row: Record<string, unknown>) => {
      if (table === componentDeletionHosts) staged.push(row);
    },
  });
  return {
    committed,
    db: {
      ...surface(committed),
      transaction: async <R>(fn: (tx: never) => Promise<R>): Promise<R> => {
        const staged: Record<string, unknown>[] = [];
        const result = await fn(surface(staged) as never);
        committed.push(...staged);
        return result;
      },
    },
  };
}

describe("re-queueing a document written while fenced", () => {
  it("records nothing when the run cannot be sent back to converting", async () => {
    const { db, committed } = database(true);

    await expect(
      progressStore(db as never, "sqlite").requeue(["card"], "doc")
    ).rejects.toThrow("the connection dropped");

    expect(committed).toEqual([]);
  });

  it("CONTROL: records the pending row when the run moves too", async () => {
    const { db, committed } = database(false);

    await progressStore(db as never, "sqlite").requeue(["card"], "doc");

    expect(committed).toEqual([
      expect.objectContaining({
        deletionId: "run-1",
        hostKey: "doc",
        state: "pending",
      }),
    ]);
  });
});

describe("reopening a finished run's left documents", () => {
  it("marks nothing pending when the run cannot leave done", async () => {
    const { db, committed } = database(true, "left");

    await expect(
      progressStore(db as never, "sqlite").reopenLeft("run-1")
    ).rejects.toThrow("the connection dropped");

    expect(committed).toEqual([]);
  });

  it("CONTROL: marks the left documents pending when the run moves too", async () => {
    const { db, committed } = database(false, "left");

    await expect(
      progressStore(db as never, "sqlite").reopenLeft("run-1")
    ).resolves.toBe(true);

    expect(committed).toEqual([{ update: { state: "pending", reason: null } }]);
  });
});

describe("recording a document's state", () => {
  it("updates a row that already holds the state rather than inserting it again", async () => {
    // A row whose state an update would not change: MySQL counts it as no row.
    const { db, committed } = database(false, "unchanged");

    await progressStore(db as never, "mysql").record(
      "run-1",
      "doc",
      "unchanged"
    );

    expect(committed).toEqual([
      { update: { state: "unchanged", reason: null } },
    ]);
  });
});
