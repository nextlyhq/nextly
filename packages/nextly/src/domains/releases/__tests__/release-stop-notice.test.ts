/**
 * The owner's notice a stop records, and the one connection it may use.
 *
 * The stop is a transaction; the notice is written in it. Whether the notices
 * table exists is asked before the transaction opens, because the question
 * goes through the pool, and a pool whose only connection the transaction
 * holds would wait for a second one forever.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearNoticeKindsForTests,
  registerNoticeKind,
} from "../../notices/notice-kinds";
import { RELEASE_STOPPED_NOTICE } from "../release-stopped-notice";
import { ReleasesRepository, type ReleasesDbApi } from "../releases-repository";

afterEach(() => clearNoticeKindsForTests());

/** A database whose pool refuses every question while a transaction is open. */
function oneConnection() {
  let inTransaction = false;
  const poolAskedInside = vi.fn();
  const tx = {
    lockRow: async () => {},
    select: async (
      table: string,
      options?: { columns?: string[] }
    ): Promise<unknown[]> => {
      if (table === "users") return [{ id: "owner" }];
      if (options?.columns?.includes("revision")) {
        return [{ revision: 3, kind: "release" }];
      }
      return [{ title: "Launch", createdBy: "owner" }];
    },
    updateCount: async () => 1,
    insert: async () => undefined,
    delete: async () => 0,
    upsert: vi.fn(async (_table: string, row: Record<string, unknown>) => ({
      id: row.id,
    })),
  };
  const db = {
    dialect: "postgresql",
    tableExists: async () => {
      if (inTransaction) poolAskedInside();
      return true;
    },
    transaction: async <T>(work: (handle: typeof tx) => Promise<T>) => {
      inTransaction = true;
      try {
        return await work(tx);
      } finally {
        inTransaction = false;
      }
    },
  };
  return { db: db as unknown as ReleasesDbApi, tx, poolAskedInside };
}

describe("stopping a release tells its owner", () => {
  it("in the stop's transaction, without asking the pool while it is open", async () => {
    registerNoticeKind(RELEASE_STOPPED_NOTICE);
    const { db, tx, poolAskedInside } = oneConnection();

    const stopped = await new ReleasesRepository(db).blockReleases([
      { id: "r1", scheduledAt: new Date("2020-01-01T00:00:00Z") },
    ]);

    expect(stopped).toEqual(["r1"]);
    expect(poolAskedInside).not.toHaveBeenCalled();
    expect(tx.upsert).toHaveBeenCalledTimes(1);
    expect(tx.upsert.mock.calls[0][1]).toMatchObject({
      userId: "owner",
      kind: "releases.stopped",
      subjectId: "r1",
      occurrence: "4",
    });
  });
});
