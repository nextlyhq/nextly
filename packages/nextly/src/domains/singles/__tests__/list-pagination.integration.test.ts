/**
 * Registry list pagination on every configured dialect.
 *
 * An `offset` without a `limit` is refused once, at the shared registry list
 * boundary, as the same client error from every surface that exposes the
 * options — before any query runs, because SQLite and MySQL refuse a bare
 * `OFFSET` in SQL while PostgreSQL silently returns the unbounded tail.
 * Pagination with both, a list with neither, an offset of 0 and a `limit` of
 * 0 keep today's semantics; `findSingles`' search ignores case whatever the
 * column's collation and matches `%` and `_` as characters.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { getPluginRouteRegistry } from "../../../plugins/routes/route-registry";
import { runPluginRoute } from "../../../plugins/routes/dispatch";
import type { TestDialect, TestNextly } from "../../../plugins/test-nextly";
import { createTestNextly } from "../../../plugins/test-nextly";
import { text } from "../../../config";
import { defineSingle } from "../../../singles/config/define-single";

/** The contract's own sentence: the public message every surface refuses with. */
const REFUSAL_MESSAGE =
  "An offset requires a limit: pass limit alongside offset to paginate.";

/**
 * The singles the suite boots on. The slugs are the search fixtures: `a_b`
 * beside `axb` separates the literal `_` from its wildcard reading. A slug
 * cannot hold a `%`, so the literal-`%` fixture is a label: `half_off` is
 * labelled "50% off everything", and `years_50` is the decoy a wildcard `%`
 * would also match. Page slices are asserted as sorted sets, since the
 * registration order is not the sort order.
 */
const SINGLES: Array<{ slug: string; label?: { singular: string } }> = [
  { slug: "spring_launch" },
  { slug: "a_b" },
  { slug: "axb" },
  { slug: "half_off", label: { singular: "50% off everything" } },
  { slug: "years_50" },
];

/**
 * The surface that reaches the registry the way a plugin does: the read-only
 * singles list a plugin holds. The handler catches the refusal itself and
 * answers with its code and public message, so the test can compare all three
 * surfaces' refusals verbatim.
 */
const probe = {
  name: "list-probe",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/singles",
        public: true,
        handler: async (
          _request: Request,
          ctx: { services: { singles: { list(o: unknown): Promise<unknown> } } }
        ) => {
          try {
            await ctx.services.singles.list({ offset: 10 });
            return Response.json({ refused: false });
          } catch (error) {
            return Response.json({
              refused: true,
              code: (error as { code?: string }).code,
              message: (error as { publicMessage?: string }).publicMessage,
            });
          }
        },
      },
    ],
  },
} as unknown as PluginDefinition;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  return createTestNextly({
    dialect,
    plugins: [probe],
    singles: SINGLES.map(({ slug, label }) =>
      defineSingle({
        slug,
        ...(label ? { label } : {}),
        fields: [text({ name: "body" })],
      })
    ),
  });
}

async function slugsOf(t: TestNextly): Promise<string[]> {
  const found = await t.nextly.findSingles();
  return found.docs.map(doc => doc.slug).sort();
}

async function slugsSearched(
  t: TestNextly,
  search: string,
  page: { limit?: number; offset?: number } = {}
): Promise<string[]> {
  const found = await t.nextly.findSingles({ search, ...page });
  return found.docs.map(doc => doc.slug).sort();
}

async function query<T>(t: TestNextly, sql: string): Promise<T[]> {
  return (
    t.adapter as unknown as {
      executeQuery<R>(statement: string): Promise<R[]>;
    }
  ).executeQuery<T>(sql);
}

describeEachDialect("registry list pagination", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    current = await boot(dialect);
  });

  afterEach(async () => {
    await current.destroy();
  });

  /** The MySQL half of the collation control; see `makeSearchCaseSensitive`. */
  async function holdSearchColumnsCaseSensitive(): Promise<void> {
    if (dialect !== "mysql") return;
    for (const column of ["slug", "label"]) {
      const [info] = await query<{
        type: string;
        nullable: string;
      }>(
        current,
        `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dynamic_singles' AND COLUMN_NAME = '${column}'`
      );
      await query(
        current,
        `ALTER TABLE dynamic_singles MODIFY ${column} ${info.type} COLLATE utf8mb4_bin ${info.nullable === "NO" ? "NOT NULL" : "NULL"}`
      );
    }
    const [control] = await query<{ n: number | string }>(
      current,
      "SELECT COUNT(*) AS n FROM dynamic_singles WHERE slug LIKE '%SPRING%' OR label LIKE '%SPRING%'"
    );
    expect(Number(control.n)).toBe(0);
  }

  it("refuses an offset without a limit on every dialect", async () => {
    const refusal = await current.nextly.findSingles({ offset: 10 }).then(
      () => null,
      (error: unknown) => error
    );

    expect(NextlyError.is(refusal)).toBe(true);
    expect((refusal as NextlyError).code).toBe("INVALID_INPUT");
    expect((refusal as NextlyError).statusCode).toBe(400);
    expect((refusal as NextlyError).publicMessage).toBe(REFUSAL_MESSAGE);

    // The whole unpaginated list still answers: the refusal binds the one
    // combination, not the option.
    expect(await slugsOf(current)).toHaveLength(SINGLES.length);
  });

  it("the refusal reads the same from findSingles, the field-groups find and the plugin singles list", async () => {
    const refusals: Array<{ code?: string; message?: string }> = [];

    try {
      await current.nextly.findSingles({ offset: 10 });
      refusals.push({ code: "not-refused" });
    } catch (error) {
      refusals.push({
        code: (error as NextlyError).code,
        message: (error as NextlyError).publicMessage,
      });
    }

    try {
      await current.nextly.fieldGroups.find({ offset: 10 });
      refusals.push({ code: "not-refused" });
    } catch (error) {
      refusals.push({
        code: (error as NextlyError).code,
        message: (error as NextlyError).publicMessage,
      });
    }

    const match = getPluginRouteRegistry().match(
      "GET",
      "/plugins/list-probe/singles",
      "plugin"
    );
    if (match === null) throw new Error("the probe route was not registered");
    const response = await runPluginRoute(
      new Request("http://localhost:3000/admin/api/plugins/list-probe/singles"),
      match
    );
    const answered = (await response.json()) as {
      refused: boolean;
      code?: string;
      message?: string;
    };
    expect(answered.refused).toBe(true);
    refusals.push({ code: answered.code, message: answered.message });

    expect(refusals).toHaveLength(3);
    for (const refusal of refusals) {
      expect(refusal.code).toBe("INVALID_INPUT");
      expect(refusal.message).toBe(REFUSAL_MESSAGE);
    }
  });

  it("a refused call issues no query", async () => {
    const issued: string[] = [];
    const adapter = current.adapter as unknown as {
      select: (...args: unknown[]) => Promise<unknown>;
    };
    const original = adapter.select.bind(current.adapter);
    adapter.select = async (...args: unknown[]) => {
      issued.push(JSON.stringify(args[0]));
      return original(...args);
    };

    // The boot's own tail — warm-companion readiness checks read the
    // registries asynchronously — must drain before the measured call, so
    // what this test counts is the refused call's queries and nobody else's.
    let quiet = 0;
    while (quiet < 3) {
      const seen = issued.length;
      await new Promise(resolve => setTimeout(resolve, 10));
      quiet = issued.length === seen ? quiet + 1 : 0;
    }
    const before = issued.length;

    await expect(
      current.nextly.findSingles({ offset: 10 })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(issued.slice(before)).toEqual([]);
    expect(issued.length).toBe(before);
  });

  it("a limit alone, and a limit with an offset, paginate as today", async () => {
    const firstPage = await current.nextly.findSingles({ limit: 2 });
    expect(firstPage.docs).toHaveLength(2);
    expect(firstPage.totalDocs).toBe(SINGLES.length);

    const secondPage = await current.nextly.findSingles({
      limit: 2,
      offset: 2,
    });
    expect(secondPage.docs).toHaveLength(2);
    expect(secondPage.totalDocs).toBe(SINGLES.length);

    const lastPage = await current.nextly.findSingles({ limit: 2, offset: 4 });
    expect(lastPage.docs).toHaveLength(1);
    expect(lastPage.totalDocs).toBe(SINGLES.length);

    // The pages repeat no row, and together they hold the whole registry.
    // Which rows a page holds follows the list's order, oldest first, and
    // singles registered in the same second tie there: MySQL keeps
    // `created_at` to the whole second and returns tied rows in key order,
    // so no order among them is assumed.
    const pages = [
      ...firstPage.docs.map(doc => doc.slug),
      ...secondPage.docs.map(doc => doc.slug),
      ...lastPage.docs.map(doc => doc.slug),
    ].sort();
    expect(pages).toEqual(await slugsOf(current));
  });

  it("a page past the end returns no rows and keeps the full total", async () => {
    const probe = await current.nextly.findSingles({ limit: 10, offset: 10 });
    expect(probe.docs).toEqual([]);
    expect(probe.totalDocs).toBe(SINGLES.length);
  });

  it("a list with neither option returns everything", async () => {
    const all = await current.nextly.findSingles();
    expect(all.docs).toHaveLength(SINGLES.length);
    expect(all.totalDocs).toBe(SINGLES.length);
    expect(all.offset).toBe(0);
  });

  it("an offset of 0 without a limit is not a skip", async () => {
    const unpaginated = await current.nextly.findSingles({ offset: 0 });
    expect(unpaginated.docs).toHaveLength(SINGLES.length);
    expect(unpaginated.totalDocs).toBe(SINGLES.length);
  });

  it("a limit of 0 with an offset returns today's empty page", async () => {
    const empty = await current.nextly.findSingles({ limit: 0, offset: 1 });
    expect(empty.docs).toEqual([]);
    expect(empty.totalDocs).toBe(SINGLES.length);
  });

  it("search plus pagination counts before it slices", async () => {
    const matched = await current.nextly.findSingles({
      search: "spring",
      limit: 10,
      offset: 10,
    });
    expect(matched.docs).toEqual([]);
    expect(matched.totalDocs).toBe(1);

    const page = await current.nextly.findSingles({
      search: "spring",
      limit: 2,
      offset: 0,
    });
    expect(page.docs.map(doc => doc.slug)).toEqual(["spring_launch"]);
    expect(page.totalDocs).toBe(1);
  });

  it("a source filter plus pagination counts before it slices", async () => {
    const code = await current.nextly.findSingles({
      source: "code",
      limit: 2,
      offset: 0,
    });
    expect(code.docs).toHaveLength(2);
    expect(code.totalDocs).toBe(SINGLES.length);

    const codePastEnd = await current.nextly.findSingles({
      source: "code",
      limit: 10,
      offset: 10,
    });
    expect(codePastEnd.docs).toEqual([]);
    expect(codePastEnd.totalDocs).toBe(SINGLES.length);

    const ui = await current.nextly.findSingles({
      source: "ui",
      limit: 10,
      offset: 0,
    });
    expect(ui.docs).toEqual([]);
    expect(ui.totalDocs).toBe(0);
  });

  it("findSingles search ignores case, whatever the collation", async () => {
    await holdSearchColumnsCaseSensitive();

    expect(await slugsSearched(current, "SPRING")).toEqual(["spring_launch"]);
    expect(await slugsSearched(current, "Spring")).toEqual(["spring_launch"]);
    expect(await slugsSearched(current, "A_B")).toEqual(["a_b"]);
  });

  it("findSingles search matches % and _ as characters", async () => {
    // As a wildcard, `_` would also match `axb`.
    expect(await slugsSearched(current, "a_b")).toEqual(["a_b"]);
    // The `%` is found only in `half_off`'s label. As a wildcard, `50%`
    // would also match `years_50`, whose slug ends in `50`.
    expect(await slugsSearched(current, "50%")).toEqual(["half_off"]);
    expect(await slugsSearched(current, "%")).toEqual(["half_off"]);
  });
});
