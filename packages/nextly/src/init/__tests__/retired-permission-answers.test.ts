import { describe, expect, it, vi } from "vitest";

import {
  emptyStoredAnswers,
  type StoredAnswersOps,
} from "../retired-permission-answers";

/** The columns `user_permission_cache` had in every dialect. */
const STORED_SHAPE = [
  "id",
  "user_id",
  "action",
  "resource",
  "has_permission",
  "role_ids",
  "expires_at",
  "created_at",
];

/** A database whose table answers `exists` in turn, with `columns`, and a delete. */
function ops(
  exists: boolean[],
  deleteAll: () => Promise<unknown>,
  columns: string[] = STORED_SHAPE
): StoredAnswersOps & { deleteAll: ReturnType<typeof vi.fn> } {
  const answers = [...exists];
  return {
    tableExists: vi.fn(async () => answers.shift() ?? false),
    columnsOf: vi.fn(async () => columns),
    deleteAll: vi.fn(deleteAll),
  };
}

describe("emptying the retired stored permission answers", () => {
  it("deletes every row of the table in the shape Nextly created", async () => {
    const db = ops([true], async () => undefined);
    await emptyStoredAnswers(db);
    expect(db.deleteAll).toHaveBeenCalledTimes(1);
  });

  it("does nothing where the table is gone", async () => {
    const db = ops([false], async () => undefined);
    await emptyStoredAnswers(db);
    expect(db.deleteAll).not.toHaveBeenCalled();
  });

  it("leaves a table that only shares the name alone", async () => {
    const db = ops([true], async () => undefined, [
      "id",
      "owner",
      "permission",
    ]);
    await emptyStoredAnswers(db);
    expect(db.deleteAll).not.toHaveBeenCalled();
  });

  it("counts a delete the drop raced as emptied, once the table is gone", async () => {
    // Dropped between the checks and the delete: nothing left to serve, so
    // the caller may publish rather than withhold the version.
    const db = ops([true, false], async () => {
      throw new Error("no such table: user_permission_cache");
    });
    await expect(emptyStoredAnswers(db)).resolves.toBeUndefined();
    expect(db.deleteAll).toHaveBeenCalledTimes(1);
  });

  it("still fails a delete that failed with the table there", async () => {
    // The control: without it, the case above is equally satisfied by
    // swallowing every failure, which would publish over a live stored row.
    const db = ops([true, true], async () => {
      throw new Error("the table is locked");
    });
    await expect(emptyStoredAnswers(db)).rejects.toThrow("the table is locked");
  });
});
