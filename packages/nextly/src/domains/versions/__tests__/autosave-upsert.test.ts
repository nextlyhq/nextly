/**
 * The rolling autosave row: one per document and author, rewritten in place.
 *
 * Tested against a stub rather than a live database because the property is
 * about WHICH STATEMENT is issued. A unique index enforces the same rule on
 * Postgres, so a live-database test there would pass whether the repository
 * chose update or insert-and-violate — and it would pass for the wrong reason
 * on MySQL and SQLite, where that index is not declared at all and unlimited
 * rows are permitted. The stub is what can see the difference on every dialect.
 */
import { describe, expect, it, vi } from "vitest";

import type { VersionsDbApi, VersionsWhere } from "../db-api";
import { VersionsRepository } from "../versions-repository";

const REF = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "entry-1",
};

/**
 * A database holding `existing` rows for the next `select`.
 *
 * Records every insert and update so a test can assert which was issued, and
 * the `where` of each so the addressing can be checked rather than assumed.
 */
function stubDb(existing: Array<{ id: string }> = []) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{
    values: Record<string, unknown>;
    where: VersionsWhere;
  }> = [];
  const db: VersionsDbApi = {
    insert: vi.fn(async (_t: string, values: Record<string, unknown>) => {
      inserts.push(values);
      return undefined as never;
    }),
    select: vi.fn(async () => existing as never),
    update: vi.fn(
      async (
        _t: string,
        values: Record<string, unknown>,
        where: VersionsWhere
      ) => {
        updates.push({ values, where });
        return 1;
      }
    ),
    delete: vi.fn(async () => 0),
  } as unknown as VersionsDbApi;
  return { db, inserts, updates };
}

const input = {
  ref: REF,
  status: "draft" as const,
  snapshot: { title: "hello" },
  createdBy: "user-1",
};

describe("VersionsRepository.upsertAutosave", () => {
  it("inserts when the author has no autosave row yet", async () => {
    const { db, inserts, updates } = stubDb([]);

    await new VersionsRepository(db).upsertAutosave(input);

    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect(inserts[0]).toMatchObject({
      isAutosave: true,
      // Null, never a number: the durable-sequence index treats a non-null
      // value as durable, so a numbered autosave would consume a sequence slot
      // and surface in history.
      versionNo: null,
      createdBy: "user-1",
    });
  });

  /**
   * The property the whole design rests on. A second autosave must REWRITE the
   * first, not add to it. An implementation that inserted again would grow one
   * row per pause, which is the accumulation the rolling row exists to avoid,
   * and on MySQL and SQLite nothing would stop it.
   */
  it("updates in place when a row already exists, and inserts nothing", async () => {
    const { db, inserts, updates } = stubDb([{ id: "existing-row" }]);

    await new VersionsRepository(db).upsertAutosave({
      ...input,
      snapshot: { title: "hello again" },
    });

    expect(updates).toHaveLength(1);
    expect(inserts).toHaveLength(0);
  });

  /**
   * Two people editing one document have two recovery points. Addressing the
   * row by document alone would let one author's snapshot overwrite the
   * other's, and the loser would recover somebody else's work.
   */
  it("addresses the row by author as well as document", async () => {
    const { db, updates } = stubDb([{ id: "existing-row" }]);

    await new VersionsRepository(db).upsertAutosave(input);

    const conditions = updates[0]?.where.and ?? [];
    expect(conditions).toContainEqual({
      column: "createdBy",
      op: "=",
      value: "user-1",
    });
    expect(conditions).toContainEqual({
      column: "isAutosave",
      op: "=",
      value: true,
    });
  });

  /**
   * An anonymous author is a distinct bucket, not a wildcard. Comparing NULL
   * with `=` matches nothing in SQL, so an equality condition here would fail
   * to find the existing row and insert a second one on every save.
   */
  it("matches a null author with IS NULL rather than equality", async () => {
    const { db, updates } = stubDb([{ id: "existing-row" }]);

    await new VersionsRepository(db).upsertAutosave({
      ...input,
      createdBy: null,
    });

    expect(updates[0]?.where.and).toContainEqual({
      column: "createdBy",
      op: "IS NULL",
    });
  });

  /**
   * A recovery point is not a version somebody kept and not a restore. Writing
   * either field would put an autosave into surfaces that read them.
   */
  it("stores no label and no restore lineage", async () => {
    const { db, inserts } = stubDb([]);

    await new VersionsRepository(db).upsertAutosave(input);

    expect(inserts[0]).toMatchObject({ label: null, sourceVersionNo: null });
  });
});
