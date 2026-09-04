/**
 * Counting and listing pending edits across collections, against a real database.
 *
 * The distinctness is the whole claim and only a database can settle it: a
 * working draft is one row per document per LOCALE, so "14 documents have
 * unpublished changes" counted from rows says 42 for an install translating
 * into three languages.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import { VersionsRepository } from "../versions-repository";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

function draft(patch: {
  entryId: string;
  locale: string | null;
  scopeSlug?: string;
  isAutosave?: boolean;
  updatedAt?: Date;
}) {
  return {
    id: crypto.randomUUID(),
    scopeKind: "collection",
    scopeSlug: patch.scopeSlug ?? "posts",
    entryId: patch.entryId,
    versionNo: null,
    status: "draft",
    isAutosave: patch.isAutosave ?? false,
    snapshot: JSON.stringify({ secret: "unpublished body" }),
    label: null,
    locale: patch.locale,
    sourceVersionNo: null,
    createdBy: null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: patch.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
  };
}

describe.each(getConfiguredTestDialects())("pending edits (%s)", dialect => {
  it("counts DOCUMENTS, not the rows their locales create", async () => {
    // 🔴 The distinguishing case. One document translated into two languages is
    // one thing an editor must publish; counting rows reports two, and the
    // number a dashboard shows would grow with the install's locale count
    // rather than with its unpublished work.
    const app = await boot(dialect);
    const repo = new VersionsRepository(app.adapter);

    for (const row of [
      draft({ entryId: "e1", locale: "en" }),
      draft({ entryId: "e1", locale: "fr" }),
      draft({ entryId: "e2", locale: "en" }),
    ]) {
      await app.adapter.insert(VERSIONS_TABLE, row);
    }

    expect(await repo.countDocumentsWithPendingEdits(["posts"])).toBe(2);
  });

  it("ignores autosaves, which are not pending edits", async () => {
    // An autosave is the editor's in-flight buffer, not a change awaiting
    // publication. Counting it tells a reader to publish something nobody
    // decided to keep.
    const app = await boot(dialect);
    const repo = new VersionsRepository(app.adapter);

    await app.adapter.insert(
      VERSIONS_TABLE,
      draft({ entryId: "e1", locale: null })
    );
    await app.adapter.insert(
      VERSIONS_TABLE,
      draft({ entryId: "e2", locale: null, isAutosave: true })
    );

    expect(await repo.countDocumentsWithPendingEdits(["posts"])).toBe(1);
  });

  it("counts and lists only the collections the caller may read", async () => {
    const app = await boot(dialect);
    const repo = new VersionsRepository(app.adapter);

    await app.adapter.insert(
      VERSIONS_TABLE,
      draft({ entryId: "e1", locale: null })
    );
    await app.adapter.insert(
      VERSIONS_TABLE,
      draft({ entryId: "e2", locale: null, scopeSlug: "secrets" })
    );

    expect(await repo.countDocumentsWithPendingEdits(["posts"])).toBe(1);
    const listed = await repo.findRecentPendingEdits({
      slugs: ["posts"],
      limit: 10,
      maxPerDocument: 1,
    });
    expect(listed.map(r => r.scopeSlug)).toEqual(["posts"]);
  });

  it("answers ZERO and an empty list for a caller who may read nothing", async () => {
    // 🔴 `[]` means exactly nothing, and it is the only empty answer the
    // allowlist has — there is no value meaning "no filter". Reading it as
    // unfiltered hands every document to a caller granted none, which is the
    // widest possible wrong answer.
    const app = await boot(dialect);
    const repo = new VersionsRepository(app.adapter);
    await app.adapter.insert(
      VERSIONS_TABLE,
      draft({ entryId: "e1", locale: null })
    );

    expect(await repo.countDocumentsWithPendingEdits([])).toBe(0);
    expect(
      await repo.findRecentPendingEdits({
        slugs: [],
        limit: 10,
        maxPerDocument: 1,
      })
    ).toEqual([]);
  });

  it("lists one row per DOCUMENT, so locales cannot crowd out other work", async () => {
    // 🔴 The separating case for the collapse. A document translated into two
    // languages is two rows, so limiting the query alone gives one document both
    // slots and the second document never appears -- while the count beside it,
    // being document-based, says two. The card's `select` omits `locale`, so
    // those two rows render as the same line twice.
    const app = await boot(dialect);
    const repo = new VersionsRepository(app.adapter);

    for (const row of [
      draft({
        entryId: "translated",
        locale: "en",
        updatedAt: new Date("2026-06-03T00:00:00Z"),
      }),
      draft({
        entryId: "translated",
        locale: "fr",
        updatedAt: new Date("2026-06-02T00:00:00Z"),
      }),
      draft({
        entryId: "other",
        locale: "en",
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ]) {
      await app.adapter.insert(VERSIONS_TABLE, row);
    }

    const rows = await repo.findRecentPendingEdits({
      slugs: ["posts"],
      limit: 2,
      maxPerDocument: 2,
    });
    expect(rows.map(r => r.entryId)).toEqual(["translated", "other"]);
    // The row kept is the document's LATEST instant, which is what makes the
    // list agree with the order it claims.
    expect(rows[0]?.locale).toBe("en");
  });

  it("lists the most recently touched first, and never the snapshot", async () => {
    const app = await boot(dialect);
    const repo = new VersionsRepository(app.adapter);

    await app.adapter.insert(
      VERSIONS_TABLE,
      draft({
        entryId: "old",
        locale: null,
        updatedAt: new Date("2020-06-01T00:00:00Z"),
      })
    );
    await app.adapter.insert(
      VERSIONS_TABLE,
      draft({
        entryId: "new",
        locale: null,
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      })
    );

    const rows = await repo.findRecentPendingEdits({
      slugs: ["posts"],
      limit: 10,
      maxPerDocument: 1,
    });
    expect(rows.map(r => r.entryId)).toEqual(["new", "old"]);
    // The snapshot is the document's unpublished content and the largest column
    // in the table; a card listing titles has no use for it.
    expect(rows.every(r => !("snapshot" in r))).toBe(true);
  });
});
