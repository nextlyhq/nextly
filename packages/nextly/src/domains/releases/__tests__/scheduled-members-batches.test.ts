/**
 * Re-checking every scheduled release reads them in runs a statement can
 * bind: SQLite binds at most 999 parameters by default, and a site can hold
 * more scheduled releases than that.
 */
import { describe, expect, it } from "vitest";

import { ReleasesRepository, type ReleasesDbApi } from "../releases-repository";

const SQLITE_MAX_PARAMETERS = 999;

interface Condition {
  column?: string;
  op?: string;
  value?: unknown;
  and?: Condition[];
  or?: Condition[];
}

/** Every `IN` list in a where clause. */
function inLists(where: Condition | undefined): unknown[][] {
  if (where === undefined) return [];
  const own =
    where.op === "IN" && Array.isArray(where.value) ? [where.value] : [];
  return [
    ...own,
    ...(where.and ?? []).flatMap(inLists),
    ...(where.or ?? []).flatMap(inLists),
  ];
}

/** The ids an `IN` on `column` names, if the clause has one. */
function named(where: Condition | undefined, column: string): string[] | null {
  for (const condition of where?.and ?? []) {
    if (condition.column === column && condition.op === "IN") {
      return condition.value as string[];
    }
  }
  return null;
}

/** A database holding `count` scheduled releases of one member each. */
function scheduledReleases(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `r${i}`);
  let widest = 0;
  const select = async (
    table: string,
    options?: { where?: Condition }
  ): Promise<unknown[]> => {
    for (const list of inLists(options?.where)) {
      widest = Math.max(widest, list.length);
    }
    if (table === "nextly_releases") {
      const asked = named(options?.where, "id");
      return (asked ?? ids).map(id => ({
        id,
        state: "scheduled",
        scheduledAt: new Date("2099-01-01T00:00:00Z"),
        revision: 1,
      }));
    }
    const releaseIds = named(options?.where, "releaseId") ?? [];
    return releaseIds.map(releaseId => ({
      id: `m-${releaseId}`,
      releaseId,
      createdBy: "author",
    }));
  };
  return {
    db: { select } as unknown as ReleasesDbApi,
    widest: () => widest,
  };
}

describe("re-checking every scheduled release", () => {
  it("reads more releases than one statement can bind, in runs it can", async () => {
    const count = SQLITE_MAX_PARAMETERS * 2 + 3;
    const { db, widest } = scheduledReleases(count);

    const found = await new ReleasesRepository(db).scheduledMembersFor({
      everyScheduled: true,
    });

    expect(found).toHaveLength(count);
    expect(found.every(({ members }) => members.length === 1)).toBe(true);
    expect(widest()).toBeLessThan(SQLITE_MAX_PARAMETERS);
  });
});
