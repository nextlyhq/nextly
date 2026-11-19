import { afterEach, describe, expect, it, vi } from "vitest";

import { isWriteIntegrityFailure } from "../../../shared/write-integrity";
import type { VersionsDbApi } from "../db-api";
import {
  VersionCaptureService,
  underSavepoint,
} from "../version-capture-service";
import { VersionsRepository } from "../versions-repository";

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

describe("a version insert that collides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not retried when its savepoint cannot be rolled back, and aborts the transaction", async () => {
    // The savepoint is gone with its transaction, so the collision's rollback fails.
    const { db, sent } = savepointDb(() =>
      Promise.reject(new Error("SAVEPOINT does not exist"))
    );
    const collision = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
    });
    vi.spyOn(VersionsRepository.prototype, "getMaxVersionNo").mockResolvedValue(
      1
    );
    const insertVersion = vi
      .spyOn(VersionsRepository.prototype, "insertVersion")
      .mockRejectedValue(collision);

    const captured = new VersionCaptureService().capture(db, {
      ref: { scopeKind: "collection", scopeSlug: "posts", entryId: "e1" },
      status: "draft",
      snapshot: {},
      lifecycle: true,
    });

    await expect(captured).rejects.toBe(collision);
    expect(isWriteIntegrityFailure(collision)).toBe(true);
    // One insert, one savepoint: nothing more ran on the transaction.
    expect(insertVersion).toHaveBeenCalledTimes(1);
    expect(sent.filter(line => line.startsWith("SAVEPOINT"))).toHaveLength(1);
  });
});
