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

/** One member, of the release named, about the entry named. */
function member(releaseId: string, entryId?: string) {
  return {
    id: `m-${entryId ?? releaseId}`,
    releaseId,
    entryId,
    createdBy: "author",
    createdAt: new Date("2020-01-01T00:00:00Z"),
  };
}

/**
 * The member rows a lookup asks for: by entry for the member index, giving
 * each entry a release of its own, or by release.
 */
function membersAsked(where: Condition | undefined): unknown[] {
  const entryIds = named(where, "entryId");
  if (entryIds !== null) {
    return entryIds.map(entryId => member(`r-${entryId}`, entryId));
  }
  return (named(where, "releaseId") ?? []).map(id => member(id));
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
    if (table !== "nextly_releases") return membersAsked(options?.where);
    return (named(options?.where, "id") ?? ids).map(id => ({
      id,
      state: "scheduled",
      scheduledAt: new Date("2099-01-01T00:00:00Z"),
      revision: 1,
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

describe("re-checking the releases holding many documents of one scope", () => {
  it("finds every holding release in runs a statement can bind", async () => {
    const count = SQLITE_MAX_PARAMETERS * 2 + 3;
    const { db, widest } = scheduledReleases(0);
    const documents = Array.from({ length: count }, (_, i) => ({
      scopeKind: "collection" as const,
      scopeSlug: "articles",
      entryId: `e${i}`,
    }));

    const found = await new ReleasesRepository(db).scheduledMembersFor({
      documents,
    });

    expect(found).toHaveLength(count);
    expect(widest()).toBeLessThan(SQLITE_MAX_PARAMETERS);
  });
});
