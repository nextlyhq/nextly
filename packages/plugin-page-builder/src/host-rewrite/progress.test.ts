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
 * A database whose transactions keep their inserts only when they finish,
 * and whose run-table update fails when told to.
 */
function database(failPhaseUpdate: boolean) {
  const committed: Record<string, unknown>[] = [];
  const surface = (staged: Record<string, unknown>[]) => ({
    table: () => columns as never,
    select: (table: unknown) => ({
      where: () => ({
        all: async () =>
          table === componentDeletions
            ? [{ id: "run-1", componentId: "card", purpose: "delete" }]
            : [],
      }),
    }),
    update: (table: unknown) => ({
      where: async () => {
        if (table === componentDeletions && failPhaseUpdate) {
          throw new Error("the connection dropped");
        }
        return 0;
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
