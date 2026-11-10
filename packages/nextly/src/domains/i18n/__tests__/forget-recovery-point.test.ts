/**
 * Forgetting an author's recovery point on a discard asks the database once,
 * with the language in the question.
 *
 * The author's point is one row per document, rewritten by every autosave, in
 * whichever language that tab is in. Read first and deleted after, a point
 * read in the discarded language can be rewritten by another tab in another
 * language in between, and the delete then removes that other language's
 * work. The connection here answers a read with the point as it WAS (in
 * English) while the row it holds is the one rewritten since (in German):
 * the plausible broken implementation, read-then-delete, removes the German
 * work; a delete that names the language removes nothing.
 */
import { describe, expect, it } from "vitest";

import type {
  VersionsDbApi,
  VersionsWhere,
  VersionsWhereCondition,
} from "../../versions/db-api";
import { forgetRecoveryPointIn } from "../forget-recovery-point";

type Row = Record<string, unknown>;

/** Whether a stored row meets a where, as the adapter judges it. */
function meets(
  row: Row,
  where: VersionsWhere | VersionsWhereCondition
): boolean {
  if ("column" in where) {
    const value = row[where.column];
    if (where.op === "IS NULL") return value === null || value === undefined;
    if (where.op === "=") return value === where.value;
    throw new Error(`unexpected operator ${where.op}`);
  }
  if (where.and && !where.and.every(part => meets(row, part))) return false;
  if (where.or && !where.or.some(part => meets(row, part))) return false;
  return true;
}

/** A connection whose reads see `seen` and whose writes act on `stored`. */
function racingConnection(seen: Row, stored: Row[]): VersionsDbApi {
  return {
    insert: () => Promise.reject(new Error("no insert expected")),
    select: <T>() => Promise.resolve([seen] as T[]),
    delete: (_table: string, where: VersionsWhere) => {
      const before = stored.length;
      for (let at = stored.length - 1; at >= 0; at -= 1) {
        if (meets(stored[at], where)) stored.splice(at, 1);
      }
      return Promise.resolve(before - stored.length);
    },
  } as unknown as VersionsDbApi;
}

const ref = {
  scopeKind: "collection" as const,
  scopeSlug: "notes",
  entryId: "e1",
};
const point = (locale: string | null): Row => ({
  scopeKind: "collection",
  scopeSlug: "notes",
  entryId: "e1",
  isAutosave: true,
  createdBy: "author-1",
  locale,
});

describe("forgetting a recovery point on a discard", () => {
  it("keeps a point rewritten in another language since it was read", async () => {
    const stored = [point("de")];
    await forgetRecoveryPointIn(racingConnection(point("en"), stored), {
      ref,
      author: "author-1",
      slot: "en",
      documentLocalized: true,
      defaultLocale: "en",
    });
    expect(stored).toEqual([point("de")]);
  });

  it("forgets a point recorded in the discarded language, the default spelled as no language", async () => {
    for (const recorded of ["en", null]) {
      const stored = [point(recorded)];
      await forgetRecoveryPointIn(racingConnection(point(recorded), stored), {
        ref,
        author: "author-1",
        slot: "en",
        documentLocalized: true,
        defaultLocale: "en",
      });
      expect(stored, String(recorded)).toEqual([]);
    }
  });

  it("forgets nothing of another author's", async () => {
    const theirs = { ...point("en"), createdBy: "author-2" };
    const stored = [theirs];
    await forgetRecoveryPointIn(racingConnection(theirs, stored), {
      ref,
      author: "author-1",
      slot: "en",
      documentLocalized: true,
      defaultLocale: "en",
    });
    expect(stored).toEqual([theirs]);
  });
});
