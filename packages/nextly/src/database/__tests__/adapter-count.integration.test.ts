/**
 * The adapter's COUNT primitive, against a real database.
 *
 * Only an integration test can establish this. `distinctOn` compiles to a
 * `SELECT DISTINCT` subquery specifically because the inline
 * `COUNT(DISTINCT a, b)` is not portable -- MySQL accepts it, PostgreSQL needs a
 * row constructor, and SQLite rejects it with "wrong number of arguments to
 * function count()". A unit test over a fake would assert the shape this file
 * was written to avoid depending on, and would pass on a query no engine runs.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, Postgres and MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../schemas/versions/types";

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

/** One version row: the columns the count reads, with the rest defaulted. */
function versionRow(patch: {
  entryId: string;
  locale: string | null;
  scopeSlug?: string;
}) {
  return {
    id: crypto.randomUUID(),
    scopeKind: "collection",
    scopeSlug: patch.scopeSlug ?? "posts",
    entryId: patch.entryId,
    versionNo: null,
    status: "draft",
    isAutosave: false,
    snapshot: JSON.stringify({}),
    label: null,
    locale: patch.locale,
    sourceVersionNo: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe.each(getConfiguredTestDialects())("adapter.count (%s)", dialect => {
  it("counts rows, and counts DISTINCT documents differently", async () => {
    // 🔴 The two answers must differ, or the test cannot tell the primitive
    // apart from one that ignores `distinctOn`. Three rows over two
    // documents: one document edited in two locales, one in a single locale.
    const app = await boot(dialect);
    const adapter = app.adapter;

    for (const row of [
      versionRow({ entryId: "e1", locale: "en" }),
      versionRow({ entryId: "e1", locale: "fr" }),
      versionRow({ entryId: "e2", locale: "en" }),
    ]) {
      await adapter.insert(VERSIONS_TABLE, row);
    }

    expect(await adapter.count(VERSIONS_TABLE)).toBe(3);
    expect(
      await adapter.count(VERSIONS_TABLE, {
        distinctOn: ["scopeKind", "scopeSlug", "entryId"],
      })
    ).toBe(2);
  });

  it("applies the filter to BOTH forms", async () => {
    // The control on the where clause. A distinct count that dropped the
    // filter would answer 2 here and look plausible.
    const app = await boot(dialect);
    const adapter = app.adapter;

    for (const row of [
      versionRow({ entryId: "e1", locale: "en" }),
      versionRow({ entryId: "e1", locale: "fr" }),
      versionRow({ entryId: "e2", locale: "en", scopeSlug: "pages" }),
    ]) {
      await adapter.insert(VERSIONS_TABLE, row);
    }

    const where = {
      and: [{ column: "scopeSlug", op: "=" as const, value: "posts" }],
    };
    expect(await adapter.count(VERSIONS_TABLE, { where })).toBe(2);
    expect(
      await adapter.count(VERSIONS_TABLE, {
        where,
        distinctOn: ["scopeKind", "scopeSlug", "entryId"],
      })
    ).toBe(1);
  });

  it("counts zero without throwing when nothing matches", async () => {
    const app = await boot(dialect);
    expect(
      await app.adapter.count(VERSIONS_TABLE, {
        where: {
          and: [{ column: "scopeSlug", op: "=" as const, value: "nope" }],
        },
        distinctOn: ["entryId"],
      })
    ).toBe(0);
  });

  it("refuses a distinctOn naming no column this table has", async () => {
    // Counting rows there would answer a DIFFERENT question than the caller
    // asked -- silently, and larger.
    const app = await boot(dialect);
    await expect(
      app.adapter.count(VERSIONS_TABLE, { distinctOn: ["not_a_column"] })
    ).rejects.toThrow(/distinctOn/);
  });
});
