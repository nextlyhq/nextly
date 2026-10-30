/**
 * The drain's overdue pass, as each pass runs it before anything is applied.
 *
 * It runs on every pass, ahead of the releases due now, so what it costs is
 * charged to them: a miss already told must cost no transaction. It reads
 * the overdue releases before it writes, so a release cancelled or moved in
 * between must not be told it missed a time it no longer has. And one
 * release that cannot be told must not keep every one after it untold.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadDialectTables } from "../../../database/dialect-tables";
import {
  getNextlyLogger,
  setNextlyLogger,
  type NextlyLogger,
} from "../../../observability/logger";
import { NOTICES_TABLE } from "../../../schemas/notices/table-name";
import {
  clearNoticeKindsForTests,
  registerNoticeKind,
} from "../../notices/notice-kinds";
import { noticeDedupeKey } from "../../notices/notices-service";
import { RELEASE_OVERDUE_NOTICE } from "../release-overdue-notice";
import { RELEASES_TABLE } from "../release-tables";
import { ReleasesRepository, type ReleasesDbApi } from "../releases-repository";

// The email job is written through the jobs table's Drizzle model, which is
// the loaded dialect's.
beforeAll(() => loadDialectTables("postgresql"));

const saved = getNextlyLogger();
afterEach(() => {
  clearNoticeKindsForTests();
  setNextlyLogger(saved);
});

const MISSED = new Date("2020-01-01T09:00:00.000Z");

/** The identity an overdue notice for this release is stored under. */
function toldKey(releaseId: string): string {
  return noticeDedupeKey({
    userId: "owner",
    kind: RELEASE_OVERDUE_NOTICE.key,
    subjectType: RELEASE_OVERDUE_NOTICE.subjectType,
    subjectId: releaseId,
    occurrence: MISSED.toISOString(),
  });
}

/**
 * A database holding these overdue releases, each owned by "owner".
 *
 * `told` are the releases whose miss is already recorded; `moved` are those
 * no longer scheduled at that instant once a transaction reads them; `broken`
 * are those whose notice cannot be written.
 */
function overdue(
  ids: string[],
  options: { told?: string[]; moved?: string[]; broken?: string[] } = {}
) {
  const transactions: string[] = [];
  const recorded: string[] = [];
  const db = {
    dialect: "postgresql",
    tableExists: async () => true,
    select: async (table: string): Promise<unknown[]> => {
      if (table === RELEASES_TABLE) {
        return ids.map(id => ({ id, scheduledAt: MISSED, createdBy: "owner" }));
      }
      if (table === NOTICES_TABLE) {
        return (options.told ?? []).map(id => ({ dedupeKey: toldKey(id) }));
      }
      return [];
    },
    transaction: async <T>(work: (tx: unknown) => Promise<T>) => {
      let releaseId = "";
      const tx = {
        select: async (
          table: string,
          query?: {
            where?: { and: Array<{ column: string; value?: unknown }> };
          }
        ): Promise<unknown[]> => {
          if (table === "users") return [{ id: "owner" }];
          const conditions = query?.where?.and ?? [];
          releaseId = String(
            conditions.find(condition => condition.column === "id")?.value
          );
          transactions.push(releaseId);
          const fenced = conditions.some(c => c.column === "state");
          if (fenced && options.moved?.includes(releaseId)) return [];
          return [
            { title: "Launch", createdBy: "owner", timezone: "Europe/Berlin" },
          ];
        },
        upsert: async (_table: string, row: Record<string, unknown>) => {
          if (options.broken?.includes(releaseId)) {
            throw new Error("the notice could not be written");
          }
          recorded.push(releaseId);
          return { id: row.id };
        },
        getDrizzle: () => ({
          insert: () => ({ values: async () => undefined }),
        }),
      };
      return work(tx);
    },
  };
  return { db: db as unknown as ReleasesDbApi, transactions, recorded };
}

describe("the drain's overdue pass", () => {
  it("opens no transaction for a miss already told", async () => {
    registerNoticeKind(RELEASE_OVERDUE_NOTICE);
    const { db, transactions, recorded } = overdue(["r1", "r2"], {
      told: ["r1"],
    });

    expect(
      await new ReleasesRepository(db).recordOverdueReleases(new Date())
    ).toBe(1);

    expect(transactions).toEqual(["r2"]);
    expect(recorded).toEqual(["r2"]);
  });

  it("tells nobody of a release no longer scheduled at the instant it read", async () => {
    registerNoticeKind(RELEASE_OVERDUE_NOTICE);
    const { db, recorded } = overdue(["r1"], { moved: ["r1"] });

    expect(
      await new ReleasesRepository(db).recordOverdueReleases(new Date())
    ).toBe(0);

    expect(recorded).toEqual([]);
  });

  it("tells the others when one release cannot be told, and says which", async () => {
    registerNoticeKind(RELEASE_OVERDUE_NOTICE);
    const warn = vi.fn();
    const logger: NextlyLogger = {
      error: () => {},
      warn,
      info: () => {},
      debug: () => {},
    };
    setNextlyLogger(logger);
    const { db, recorded } = overdue(["r1", "r2"], { broken: ["r1"] });

    expect(
      await new ReleasesRepository(db).recordOverdueReleases(new Date())
    ).toBe(1);

    expect(recorded).toEqual(["r2"]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "release-overdue-notice-failed",
        releaseId: "r1",
      })
    );
  });
});
