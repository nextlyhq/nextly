/**
 * The blog template's migration, run on a real database: its author keys act.
 *
 * A blog's tables come from the SQL the template ships, written by hand per
 * dialect, so the keys nextly would give a relationship are only there if the
 * file declares them. This runs each configured dialect's file (its UP
 * section, split as `nextly migrate` splits it) on a fresh instance, which
 * holds nextly's own `users` and `media` the keys name, and checks that
 * deleting an author profile clears the byline of a post that named it,
 * rather than leaving a dangling id.
 *
 * @module domains/schema/migrate-create/__tests__/blog-template-migration-keys.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { parseSqlSections } from "../../migrate/sql-sections";
import { splitSqlStatements } from "../../migrate/split-sql";

const TEMPLATE = new URL(
  "../../../../../../../templates/blog/",
  import.meta.url
);

/** The SQL file each dialect runs. */
const MIGRATION_FILES: Record<TestDialect, string> = {
  postgresql: "migrations/0001_000000_blog_schema.sql",
  mysql: "migrations/0001_000000_blog_schema.mysql.sql",
  sqlite: "migrations/0001_000000_blog_schema.sqlite.sql",
};

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A fresh instance with the template's migration applied. */
async function migrated(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  current = t;
  const { upSql } = parseSqlSections(
    readFileSync(new URL(MIGRATION_FILES[dialect], TEMPLATE), "utf8")
  );
  const statements = splitSqlStatements(upSql, dialect);
  // A floor, so a file the splitter read as empty cannot pass.
  expect(statements.length).toBeGreaterThan(10);
  for (const statement of statements) await t.adapter.executeQuery(statement);
  return t;
}

/**
 * The statements the test runs on the migrated tables. The template's tables
 * are made by its SQL, not registered with this instance, so the adapter's
 * table API cannot build statements for them; these are written for the
 * dialect instead, with bound values.
 */
function statementsFor(dialect: TestDialect) {
  const name = (identifier: string) =>
    dialect === "mysql" ? "`" + identifier + "`" : '"' + identifier + '"';
  const value = (position: number) =>
    dialect === "postgresql" ? "$" + String(position) : "?";
  const insert = (table: string, columns: string[]) =>
    `INSERT INTO ${name(table)} (${columns.map(name).join(", ")}) ` +
    `VALUES (${columns.map((_, i) => value(i + 1)).join(", ")})`;
  const byId = `WHERE ${name("id")} = ${value(1)}`;
  return {
    insertAuthor: insert("dc_authors", ["id", "title", "name", "slug"]),
    insertPost: insert("dc_posts", ["id", "title", "slug", "byline"]),
    deleteAuthor: `DELETE FROM ${name("dc_authors")} ${byId}`,
    readPost: `SELECT ${name("title")}, ${name("byline")} FROM ${name("dc_posts")} ${byId}`,
  };
}

describe.each(getConfiguredTestDialects())(
  "the blog template's migration, run (%s)",
  dialect => {
    it("clears a post's byline when its author profile is deleted", async () => {
      const t = await migrated(dialect);
      const sql = statementsFor(dialect);
      const post = async () =>
        (
          await t.adapter.executeQuery<{ title: string; byline: unknown }>(
            sql.readPost,
            ["post-1"]
          )
        )[0];
      await t.adapter.executeQuery(sql.insertAuthor, [
        "author-1",
        "Ada",
        "Ada",
        "ada",
      ]);
      await t.adapter.executeQuery(sql.insertPost, [
        "post-1",
        "Notes",
        "notes",
        "author-1",
      ]);
      expect((await post())?.byline).toBe("author-1");

      await t.adapter.executeQuery(sql.deleteAuthor, ["author-1"]);
      const after = await post();
      expect(after?.title).toBe("Notes");
      expect(after?.byline ?? null).toBeNull();
    });
  }
);
