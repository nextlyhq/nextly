/**
 * What `nextly migrate` retires when every migration is one `nextly migrate:create` wrote, on every
 * configured dialect: nothing where a table is only changed, which on SQLite is a rebuild, and each
 * document of a removed collection once, whatever the files before it in the run changed.
 *
 * And what it does with one of those files a person edited, or that has no snapshot to say what it
 * retires: an edit that leaves the drop plain still retires, one that keeps the table or renames it
 * refuses the run by name before any statement, another line ending is no edit, and a file with no
 * snapshot applies as it is.
 *
 * The commands are driven themselves against a project directory and a database of the test's own,
 * as `migrate-keeps-entity-contributions.integration.test.ts` drives them.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { col } from "../../../domains/schema/extension/dsl";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import type { TestDialect } from "../../../plugins/test-nextly";

import {
  appConfig,
  boot,
  deletions,
  DROP,
  edited,
  migrate,
  migrateCreate,
  orphanedPermissions,
  pathOf,
  POSTS,
  project,
  removalWritten,
  renameTo,
  stands,
  started,
  unrecorded,
  useGeneratedMigrations,
  WITH_POSTS,
  withoutEntities,
} from "./helpers/generated-migrations";

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

useGeneratedMigrations(loaded);

describeEachDialect("what generated migrations retire", dialect => {
  it("applies a change to a collection another names, which retires nothing", async () => {
    await started(dialect);
    const config = appConfig({ posts: "optional", pagesNamePosts: true });

    const { sql, refused } = await migrateCreate(config, "optional");

    expect(refused).toBeUndefined();
    // The premise: on SQLite the generator rebuilds the table.
    if (dialect === "sqlite") expect(sql).toContain(`__new_${POSTS}`);
    expect(await migrate(config), sql).toBeUndefined();
    expect(await deletions()).toEqual({});
  });

  it("ends each document once when one run changes a collection and then removes it", async () => {
    await started(dialect);
    const changed = await migrateCreate(
      appConfig({ posts: "optional", pagesNamePosts: false }),
      "change"
    );
    const gone = appConfig({ posts: "removed", pagesNamePosts: false });
    const removed = await migrateCreate(gone, "remove");
    expect([changed.refused, removed.refused]).toEqual([undefined, undefined]);

    expect(
      await migrate(gone),
      `${changed.sql}\n----\n${removed.sql}`
    ).toBeUndefined();

    expect(await deletions()).toEqual({ p1: 1, p2: 1 });
  });

  it("drops every table of a removed collection, and ends each document once", async () => {
    await started(dialect);
    const before = (await project.adapter.listTables()).filter(table =>
      table.includes("gt_posts")
    );
    const gone = appConfig({ posts: "removed", pagesNamePosts: false });
    const { sql, refused } = await migrateCreate(gone, "remove");
    expect(refused).toBeUndefined();

    expect(await migrate(gone), sql).toBeUndefined();

    const left = (await project.adapter.listTables()).filter(table =>
      table.includes("gt_posts")
    );
    expect(before.length, "the collection's tables").toBeGreaterThan(0);
    expect(left, `had ${before.join(", ")}\n${sql}`).toEqual([]);
    expect(await deletions()).toEqual({ p1: 1, p2: 1 });
  });

  it("writes no removal of a collection before the change that stops naming it", async () => {
    await started(dialect);

    // `pages` still names `posts`: the generator, not this run, is what keeps the order.
    const { refused } = await migrateCreate(
      appConfig({ posts: "removed", pagesNamePosts: true }),
      "remove_first"
    );

    expect(refused).toMatch(/gt_posts/);
  });

  it("retires nothing when only the table a collection is kept in changes", async () => {
    await started(dialect);
    const moved = appConfig({ ...WITH_POSTS, dbName: "dc_gt_moved" });
    const { refused } = await migrateCreate(moved, "moved");
    expect(refused).toBeUndefined();

    expect(await migrate(moved)).toBeUndefined();

    // As before this change: the old table gone, the collection's row naming the new one.
    expect([await stands(POSTS), await stands("dc_gt_moved")]).toEqual([
      false,
      true,
    ]);
    const rows = await project.adapter.select<{ tableName: string }>(
      "dynamic_collections",
      { where: { and: [{ column: "slug", op: "=", value: "gt_posts" }] } }
    );
    expect(rows.map(row => row.tableName)).toEqual(["dc_gt_moved"]);
    expect(await orphanedPermissions()).not.toContain(true);
    expect(await deletions()).toEqual({});
  });

  it.each([
    [
      "a comment added",
      (sql: string) => sql.replace("-- UP", "-- UP\n-- by hand"),
    ],
    [
      "a statement added",
      (sql: string) =>
        sql.replace(DROP, drop => `${drop}\nCREATE TABLE gt_added (id int);`),
    ],
    [
      "its drop written again by hand",
      (sql: string) => sql.replace(DROP, "DROP TABLE IF EXISTS dc_gt_posts;"),
    ],
  ] as const)(
    "ends each document once when the file was edited and still drops the table: %s",
    async (_label, edit) => {
      const gone = await removalWritten(dialect);
      edited("remove", edit);

      expect(await migrate(gone)).toBeUndefined();

      expect(await stands(POSTS)).toBe(false);
      expect(await deletions()).toEqual({ p1: 1, p2: 1 });
    }
  );

  it.each([
    [
      "renames the table instead",
      (d: TestDialect) => renameTo(d, "dc_gt_kept"),
    ],
    ["leaves the table there", () => ""],
    [
      "renames the table and drops it under its new name",
      (d: TestDialect) =>
        `${renameTo(d, "dc_gt_kept")}\nDROP TABLE dc_gt_kept;`,
    ],
  ] as const)(
    "refuses by name, before any statement, a file edited so that it %s",
    async (_label, statement) => {
      const gone = await removalWritten(dialect);
      edited("remove", sql => sql.replace(DROP, statement(dialect)));

      const refused = await migrate(gone);

      expect(refused, "applied").toBeDefined();
      expect(refused).toMatch(/gt_posts/);
      expect(refused).toMatch(/_remove\.sql/);
      expect(refused).toMatch(/differs from its snapshot/);
      expect([await stands(POSTS), await stands("dc_gt_kept")]).toEqual([
        true,
        false,
      ]);
      expect(await deletions()).toEqual({});
    }
  );

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("takes the file in %s for the file it is", async (_label, ending) => {
    const gone = await removalWritten(dialect);
    const path = pathOf("remove");
    const sql = readFileSync(path, "utf8");
    writeFileSync(path, sql.split("\n").join(ending));

    expect(await migrate(gone)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual({ p1: 1, p2: 1 });
  });

  it("takes a rebuild in CRLF for a table changed, which retires nothing", async () => {
    await started(dialect);
    const config = appConfig({ posts: "optional", pagesNamePosts: true });
    expect((await migrateCreate(config, "optional")).refused).toBeUndefined();
    const path = pathOf("optional");
    writeFileSync(path, readFileSync(path, "utf8").split("\n").join("\r\n"));

    expect(await migrate(config)).toBeUndefined();

    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual({});
  });

  it("ends each document once when the dialect's own variant of the file drops the table", async () => {
    const gone = await removalWritten(dialect);
    const path = pathOf("remove");
    writeFileSync(
      path.replace(/\.sql$/, `.${dialect}.sql`),
      readFileSync(path, "utf8").replace("-- UP", "-- UP\n-- this dialect's")
    );

    expect(await migrate(gone)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual({ p1: 1, p2: 1 });
  });

  it("refuses by name a dialect's variant that keeps the table its snapshot says is gone", async () => {
    const gone = await removalWritten(dialect);
    const path = pathOf("remove");
    writeFileSync(
      path.replace(/\.sql$/, `.${dialect}.sql`),
      readFileSync(path, "utf8").replace(DROP, renameTo(dialect, "dc_gt_kept"))
    );

    const refused = await migrate(gone);

    expect(refused, "applied").toBeDefined();
    expect(refused).toMatch(/gt_posts/);
    expect(refused).toMatch(/differs from its snapshot/);
    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual({});
  });

  it("applies a drop as it is, and says so, where the snapshot before it records no declarations", async () => {
    const gone = await removalWritten(dialect);
    withoutEntities("start");
    const said: string[] = [];

    expect(await migrate(gone, said)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual({});
    expect(unrecorded(said)).toHaveLength(1);
    expect(unrecorded(said)[0]).toContain("gt_posts");
  });

  it("is refused before any statement, as it was, where its own snapshot records no declarations", async () => {
    const gone = await removalWritten(dialect);
    withoutEntities("remove");

    const refused = await migrate(gone);

    expect(refused, "applied").toBeDefined();
    expect(refused).toMatch(/snapshot without registry metadata/);
    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual({});
  });

  it("applies a drop with no snapshot as it is, and says once that its documents end with no event", async () => {
    const gone = await removalWritten(dialect);
    rmSync(pathOf("remove", "snapshot"));
    const said: string[] = [];

    // The configuration still declares it: with no snapshot nothing says it is removed.
    void gone;
    expect(await migrate(appConfig(WITH_POSTS), said)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual({});
    expect(unrecorded(said)).toHaveLength(1);
    expect(unrecorded(said)[0]).toContain("gt_posts");
  });

  it("says nothing of a rebuild written by hand with no snapshot, which applies as it is", async () => {
    await started(dialect);
    const quoted = dialect === "mysql" ? `\`${POSTS}\`` : `"${POSTS}"`;
    writeFileSync(
      join(
        project.dir,
        "migrations",
        "20261113_130000_000_rebuilt_by_hand.sql"
      ),
      [
        "-- Migration: rebuilt_by_hand",
        "",
        "-- UP",
        `CREATE TABLE gt_copy AS SELECT * FROM ${quoted};`,
        `DROP TABLE ${quoted};`,
        dialect === "mysql"
          ? `ALTER TABLE gt_copy RENAME TO ${quoted};`
          : `ALTER TABLE gt_copy RENAME TO ${quoted};`,
        "",
        "-- DOWN",
        "",
      ].join("\n")
    );
    const said: string[] = [];

    expect(await migrate(appConfig(WITH_POSTS), said)).toBeUndefined();

    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual({});
    expect(unrecorded(said)).toEqual([]);
  });

  it("applies a drop with no snapshot of a collection carrying a plugin's column, as it did before", async () => {
    const contributor = definePlugin({
      name: "@test/contributor",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        schema: {
          extend: [
            ({ schema }) => {
              schema.extendTable(POSTS, {
                columns: { searchKey: col.shortText({ nullable: true }) },
                indexes: [{ columns: ["searchKey"] }],
              });
            },
          ],
        },
      },
    });
    await boot(dialect);
    const config = appConfig({
      posts: "required",
      pagesNamePosts: false,
      plugins: [contributor],
    });
    expect((await migrateCreate(config, "start")).refused).toBeUndefined();
    expect(await migrate(config)).toBeUndefined();
    const quoted = dialect === "mysql" ? `\`${POSTS}\`` : `"${POSTS}"`;
    writeFileSync(
      join(
        project.dir,
        "migrations",
        "20261113_130000_000_dropped_by_hand.sql"
      ),
      `-- Migration: dropped_by_hand\n\n-- UP\nDROP TABLE ${quoted}${dialect === "postgresql" ? " CASCADE" : ""};\n\n-- DOWN\n`
    );

    expect(await migrate(config)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual({});
  });

  it("applies a drop with no snapshot of a collection another still names, as it did before", async () => {
    await started(dialect);
    const quoted = dialect === "mysql" ? `\`${POSTS}\`` : `"${POSTS}"`;
    writeFileSync(
      join(
        project.dir,
        "migrations",
        "20261113_130000_000_dropped_by_hand.sql"
      ),
      `-- Migration: dropped_by_hand\n\n-- UP\nDROP TABLE ${quoted}${dialect === "postgresql" ? " CASCADE" : ""};\n\n-- DOWN\n`
    );

    expect(await migrate(appConfig(WITH_POSTS))).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual({});
    const rows = await project.adapter.select<{ slug: string }>(
      "dynamic_collections",
      {}
    );
    expect(rows.map(row => row.slug)).toContain("gt_posts");
  });
});
