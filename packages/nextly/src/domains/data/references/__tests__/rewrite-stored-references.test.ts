/**
 * What the stored rewrite refuses before it reads anything. Its rewriting of
 * every stored place is covered on each database by
 * `rewrite-stored-references.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  rewriteStoredReferences,
  type RewriteDb,
} from "../rewrite-stored-references";

/** A database that records every read and write it is asked for. */
function recordingDb(): { db: RewriteDb; calls: string[] } {
  const calls: string[] = [];
  const db = {
    select: (table: string) => {
      calls.push(`select ${table}`);
      return Promise.resolve([]);
    },
    update: (table: string) => {
      calls.push(`update ${table}`);
      return Promise.resolve([]);
    },
  } as unknown as RewriteDb;
  return { db, calls };
}

describe("rewriteStoredReferences", () => {
  // A page of no rows would read the same empty page for ever.
  it.each([0, -1, 1.5])(
    "refuses a page size of %s before reading anything",
    async pageSize => {
      const { db, calls } = recordingDb();
      await expect(
        rewriteStoredReferences(
          {
            db,
            site: { collections: [], singles: [], fieldGroups: [] },
            maxParamsPerQuery: 100,
            pageSize,
          },
          {}
        )
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
      expect(calls).toEqual([]);
    }
  );
});
