import { describe, expect, it, vi } from "vitest";

import { isWriteIntegrityFailure } from "../../../shared/write-integrity";
import type { VersionsDbApi } from "../db-api";
import { underSavepoint } from "../version-capture-service";

/** A transaction handle that takes savepoints, recording what it was sent. */
function savepointDb(rollback: () => Promise<void> = () => Promise.resolve()) {
  const sent: string[] = [];
  const db = {
    savepoint: vi.fn((name: string) => {
      sent.push(`SAVEPOINT ${name}`);
      return Promise.resolve();
    }),
    rollbackToSavepoint: vi.fn((name: string) => {
      sent.push(`ROLLBACK TO ${name}`);
      return rollback();
    }),
    releaseSavepoint: vi.fn((name: string) => {
      sent.push(`RELEASE ${name}`);
      return Promise.resolve();
    }),
  } as unknown as VersionsDbApi;
  return { db, sent };
}

describe("underSavepoint", () => {
  it("rolls back to the savepoint when the work fails, and throws the work's failure", async () => {
    const { db, sent } = savepointDb();
    const failure = new Error("work failed");

    await expect(
      underSavepoint(db, () => Promise.reject(failure))
    ).rejects.toBe(failure);

    expect(sent.map(line => line.split(" ").slice(0, -1).join(" "))).toEqual([
      "SAVEPOINT",
      "ROLLBACK TO",
      "RELEASE",
    ]);
    expect(isWriteIntegrityFailure(failure)).toBe(false);
  });

  it("aborts the transaction when the savepoint is gone, throwing the work's failure", async () => {
    // MySQL rolls a whole transaction back on a deadlock, savepoints and all.
    const { db } = savepointDb(() =>
      Promise.reject(new Error("SAVEPOINT does not exist"))
    );
    const failure = new Error("Deadlock found when trying to get lock");

    await expect(
      underSavepoint(db, () => Promise.reject(failure))
    ).rejects.toBe(failure);

    expect(isWriteIntegrityFailure(failure)).toBe(true);
  });
});
