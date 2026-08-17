/**
 * The scoped autosave deletes, and what each one must NOT reach.
 *
 * Nothing else in the system collects autosave rows: they are excluded from
 * history listings, from version reads and from retention pruning alike. So
 * these three predicates are the only thing standing between a removed entity
 * or account and a snapshot that outlives it permanently -- and equally, the
 * only thing stopping one of those deletes taking rows it has no business
 * touching.
 */
import { describe, expect, it, vi } from "vitest";

import type { VersionsDbApi, VersionsWhere } from "../db-api";
import { VersionsRepository } from "../versions-repository";

function stubDb() {
  const deletes: VersionsWhere[] = [];
  const db = {
    insert: vi.fn(),
    select: vi.fn(async () => [] as never),
    update: vi.fn(),
    delete: vi.fn(async (_t: string, where: VersionsWhere) => {
      deletes.push(where);
      return 0;
    }),
  } as unknown as VersionsDbApi;
  return { db, deletes };
}

const REF = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "entry-1",
};

describe("scoped autosave deletes", () => {
  it("restricts an entity sweep to that entity's autosave rows", async () => {
    const { db, deletes } = stubDb();

    await new VersionsRepository(db).deleteAutosavesForEntity(
      "collection",
      "posts"
    );

    const conditions = deletes[0]?.and ?? [];
    expect(conditions).toEqual(
      expect.arrayContaining([
        { column: "scopeKind", op: "=", value: "collection" },
        { column: "scopeSlug", op: "=", value: "posts" },
        { column: "isAutosave", op: "=", value: true },
      ])
    );
    // Exactly those. An entity sweep that lost `isAutosave` would take the
    // durable history and working drafts with it -- the archival question this
    // change deliberately does not answer.
    expect(conditions).toHaveLength(3);
  });

  it("restricts an author sweep to that author's autosave rows", async () => {
    const { db, deletes } = stubDb();

    await new VersionsRepository(db).deleteAutosavesByAuthor("user-1");

    const conditions = deletes[0]?.and ?? [];
    expect(conditions).toEqual(
      expect.arrayContaining([
        { column: "isAutosave", op: "=", value: true },
        { column: "createdBy", op: "=", value: "user-1" },
      ])
    );
    // Without `isAutosave` this would delete every version the person ever
    // authored, turning an account deletion into history destruction.
    expect(conditions).toHaveLength(2);
  });

  it("narrows a document sweep by author only when one is named", async () => {
    const { db, deletes } = stubDb();
    const repo = new VersionsRepository(db);

    await repo.deleteAutosaves(REF);
    await repo.deleteAutosaves(REF, "user-1");

    // Absent author: every author's recovery point for this document, which is
    // what a deleted document needs.
    expect(deletes[0]?.and).not.toContainEqual(
      expect.objectContaining({ column: "createdBy" })
    );
    // Named author: narrowed.
    expect(deletes[1]?.and).toContainEqual({
      column: "createdBy",
      op: "=",
      value: "user-1",
    });
  });
});
