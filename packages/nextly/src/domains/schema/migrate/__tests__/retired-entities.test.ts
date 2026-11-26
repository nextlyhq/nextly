/**
 * Which collections and Singles a migration file retires, judged from the snapshot before it, its
 * own, and whether its text is the one that snapshot was written for.
 */
import { describe, expect, it } from "vitest";

import { computeMigrationHash } from "../../migrate-create/snapshot-io";
import {
  droppedRegisteredEntities,
  matchesMigrationHash,
  retirementsOf,
} from "../retired-entities";

type Dialect = "postgresql" | "mysql" | "sqlite";

/** A snapshot recording these collections and Singles, each kept in its own table. */
const snapshot = (
  collections: Record<string, string>,
  singles: Record<string, string> = {}
) => {
  const recorded = (of: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(of).map(([slug, dbName]) => [
        slug,
        { source: "code" as const, settings: { dbName } },
      ])
    );
  return {
    snapshot: {
      tables: [...Object.values(collections), ...Object.values(singles)].map(
        name => ({ name, columns: [] })
      ),
    },
    entities: {
      collections: recorded(collections),
      singles: recorded(singles),
      fieldGroups: {},
    },
  } as never;
};

const BEFORE = snapshot({ posts: "dc_posts", pages: "dc_pages" });
const AFTER = snapshot({ pages: "dc_pages" });
const POSTS = { kind: "collection", slug: "posts", table: "dc_posts" };

const judged = (
  statements: string[],
  over: Partial<Parameters<typeof retirementsOf>[0]> = {}
) =>
  retirementsOf({
    before: BEFORE,
    after: AFTER,
    statements,
    dialect: "postgresql",
    matches: true,
    ...over,
  });

/** The guard and rebuild `migrate:create` writes on SQLite for a table it changes. */
const REBUILD = [
  'CREATE TABLE "__nextly_rebuild_dc_pages_guard" ("foreign_keys" INTEGER NOT NULL)',
  'DROP TABLE "__nextly_rebuild_dc_pages_guard"',
  'CREATE TABLE "__new_dc_pages" ("id" text PRIMARY KEY NOT NULL)',
  'INSERT INTO "__new_dc_pages" ("id") SELECT "id" FROM "dc_pages"',
  'DROP TABLE "dc_pages"',
  'ALTER TABLE "__new_dc_pages" RENAME TO "dc_pages"',
];

describe("what a file retires", () => {
  it.each([
    ["postgresql", 'DROP TABLE "dc_posts" CASCADE'],
    ["mysql", "DROP TABLE `dc_posts`"],
    ["sqlite", 'DROP TABLE IF EXISTS "dc_posts"'],
  ] as [Dialect, string][])(
    "is the collection its snapshot leaves out and it drops, on %s",
    (dialect, drop) => {
      expect(judged([drop], { dialect })).toEqual({
        retired: [POSTS],
        unsettled: [],
      });
    }
  );

  it("is a Single as a collection", () => {
    expect(
      judged(['DROP TABLE "single_home"'], {
        before: snapshot({}, { home: "single_home" }),
        after: snapshot({}),
      }).retired
    ).toEqual([{ kind: "single", slug: "home", table: "single_home" }]);
  });

  it("is never a table the file rebuilds, beside one it retires", () => {
    expect(
      judged([...REBUILD, 'DROP TABLE "dc_posts"'], { dialect: "sqlite" })
    ).toEqual({ retired: [POSTS], unsettled: [] });
  });

  it("is the old slug where the slug changed with its table", () => {
    expect(
      judged(['DROP TABLE "dc_posts"', 'CREATE TABLE "dc_news" (id text)'], {
        after: snapshot({ pages: "dc_pages", news: "dc_news" }),
      }).retired
    ).toEqual([POSTS]);
  });

  it.each([
    [
      "its slug stays, whatever table it is kept in",
      snapshot({ posts: "dc_moved", pages: "dc_pages" }),
    ],
    [
      "its table stays, under another slug",
      snapshot({ news: "dc_posts", pages: "dc_pages" }),
    ],
  ])("is nothing where %s", (_label, after) => {
    expect(judged(['DROP TABLE "dc_posts"'], { after })).toEqual({
      retired: [],
      unsettled: [],
    });
  });

  it.each([
    ["there is no snapshot before it", { before: null }],
    ["it has no snapshot", { after: null }],
    [
      "the one before it records no declarations",
      { before: { snapshot: (BEFORE as { snapshot: unknown }).snapshot } },
    ],
    [
      "its own records no declarations",
      { after: { snapshot: (AFTER as { snapshot: unknown }).snapshot } },
    ],
  ])("is nothing where %s", (_label, over) => {
    expect(judged(['DROP TABLE "dc_posts"'], over as never)).toEqual({
      retired: [],
      unsettled: [],
    });
  });

  describe("where the file is the one its snapshot was written for", () => {
    it("is nothing it plainly keeps, or plainly renames", () => {
      for (const statements of [
        [],
        ['ALTER TABLE "dc_posts" RENAME TO "dc_kept"'],
      ]) {
        expect(judged(statements)).toEqual({ retired: [], unsettled: [] });
      }
    });

    it.each([
      ["a drop of it in a form not read", ['DROP TABLE "public"."dc_posts"']],
      [
        "a drop beside a rename of it",
        ['ALTER TABLE "dc_posts" RENAME TO "dc_kept"', 'DROP TABLE "dc_posts"'],
      ],
      [
        "a drop beside a rename to it",
        ['DROP TABLE "dc_posts"', 'ALTER TABLE "copy" RENAME TO "dc_posts"'],
      ],
      [
        "a drop beside a rename of it in a form not read",
        [
          'DROP TABLE "dc_posts"',
          'ALTER TABLE "public"."copy" RENAME TO "dc_posts"',
        ],
      ],
    ])("is unsettled by %s", (_label, statements) => {
      expect(judged(statements)).toEqual({ retired: [], unsettled: [POSTS] });
    });

    it("is unsettled by a drop written into a string", () => {
      expect(
        judged(["SET @s = 'DROP TABLE dc_posts'"], { dialect: "mysql" })
      ).toEqual({ retired: [], unsettled: [POSTS] });
    });
  });

  describe("where the file differs from its snapshot", () => {
    const edited = (statements: string[]) =>
      judged(statements, { matches: false });

    it("is what it still plainly drops", () => {
      expect(
        edited(["DROP TABLE IF EXISTS dc_posts", "CREATE TABLE x (id int)"])
      ).toEqual({ retired: [POSTS], unsettled: [] });
    });

    it.each([
      ["keeps it", []],
      ["renames it", ['ALTER TABLE "dc_posts" RENAME TO "dc_kept"']],
      [
        "renames it and drops it under that name",
        ['ALTER TABLE "dc_posts" RENAME TO "kept"', 'DROP TABLE "kept"'],
      ],
      ["drops it in a form not read", ['DROP TABLE "public"."dc_posts"']],
    ])("is unsettled where the file %s", (_label, statements) => {
      expect(edited(statements)).toEqual({ retired: [], unsettled: [POSTS] });
    });
  });

  describe("on PostgreSQL, where the entity's table is spelled in capitals", () => {
    const upper = (statements: string[], dialect: Dialect = "postgresql") =>
      retirementsOf({
        before: snapshot({ posts: "dc_Posts", pages: "dc_pages" }),
        after: AFTER,
        statements,
        dialect,
        matches: false,
      });
    const UPPER = { ...POSTS, table: "dc_Posts" };

    it("is retired by a drop that quotes it", () => {
      expect(upper(['DROP TABLE "dc_Posts" CASCADE'])).toEqual({
        retired: [UPPER],
        unsettled: [],
      });
    });

    it("is not taken for the lower-case table an unquoted drop names", () => {
      expect(upper(["DROP TABLE dc_posts", 'DROP TABLE "dc_posts"'])).toEqual({
        retired: [],
        unsettled: [UPPER],
      });
    });

    it.each(["mysql", "sqlite"] as const)(
      "is retired on %s by a drop in any case",
      dialect => {
        expect(upper(["DROP TABLE dc_posts"], dialect)).toEqual({
          retired: [UPPER],
          unsettled: [],
        });
      }
    );
  });

  it("takes no comment, index or longer name for the table", () => {
    expect(
      judged([
        '-- rename dc_posts\nDROP TABLE "dc_posts"',
        'ALTER INDEX "idx_dc_posts_title" RENAME TO "idx_kept"',
        'ALTER TABLE "dc_posts_old" RENAME TO "dc_posts_older"',
      ])
    ).toEqual({ retired: [POSTS], unsettled: [] });
  });
});

describe("a file and its snapshot's hash", () => {
  const sql = "-- UP\nDROP TABLE x;\n\n-- DOWN\n";
  const crlf = sql.replaceAll("\n", "\r\n");

  it.each([
    ["LF, written in LF", sql, sql],
    ["CRLF, written in LF", crlf, sql],
    ["LF, written in CRLF", sql, crlf],
    ["CRLF, written in CRLF", crlf, crlf],
  ])("match in %s", (_label, text, written) => {
    expect(matchesMigrationHash(text, computeMigrationHash(written))).toBe(
      true
    );
  });

  it("do not match where anything else differs", () => {
    expect(
      matchesMigrationHash(`${sql}-- more\n`, computeMigrationHash(sql))
    ).toBe(false);
  });
});

describe("the registered entities a file with no snapshot drops", () => {
  const entity = (over: object) =>
    ({
      kind: "collection",
      slug: "posts",
      table: "dc_posts",
      ...over,
    }) as never;

  it("is each whose main table it plainly drops", () => {
    expect(
      droppedRegisteredEntities(
        [entity({}), entity({ slug: "pages", table: "dc_pages" })],
        ["DROP TABLE dc_posts"],
        "postgresql"
      )
    ).toEqual([POSTS]);
  });

  it("is no field group, no other owner's, and no table rebuilt or only named", () => {
    expect(
      droppedRegisteredEntities(
        [
          entity({ kind: "fieldGroup", slug: "seo", table: "comp_seo" }),
          entity({ slug: "users", table: "users", excluded: true }),
          entity({ slug: "pages", table: "dc_pages" }),
          entity({}),
        ],
        ["DROP TABLE comp_seo", "DROP TABLE users", ...REBUILD],
        "sqlite"
      )
    ).toEqual([]);
  });
});
