/**
 * The statements that carry a moved field's values: run on SQLite, every value of every kind
 * arrives where the field now is and comes back unchanged on the way out; on PostgreSQL and MySQL
 * the statements are the ones the dialect's JSON functions take.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type { StoragePlace } from "../check-move";
import { moveDataStatements, type MoveColumn } from "../move-statements";

const column = (name: string): StoragePlace => ({ kind: "column", column: name });
const key = (name: string, ...keys: string[]): StoragePlace => ({
  kind: "json",
  column: name,
  keys,
});

/** Run `statements` on `db`, in order. */
function run(db: Database.Database, statements: readonly string[]): void {
  for (const statement of statements) db.exec(statement);
}

describe("moveDataStatements on SQLite", () => {
  const sqlite = (kind: MoveColumn["kind"], columnType = "text"): MoveColumn => ({
    table: "dc_posts",
    dialect: "sqlite",
    kind,
    columnType,
  });

  function table(columnSql: string): Database.Database {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE dc_posts (id integer primary key, ${columnSql}, meta text);`);
    return db;
  }

  it("copies a text column into the group, leaves entries without a value alone, and back out", () => {
    const db = table("title text");
    db.exec(
      `INSERT INTO dc_posts (id, title, meta) VALUES (1, 'Hello ''there''', '{"summary":"s"}'), (2, NULL, NULL), (3, 'Bare', NULL);`
    );
    const into = moveDataStatements(
      { from: column("title"), to: key("meta", "title") },
      sqlite("text")
    );
    run(db, into.copy);
    expect(db.prepare("SELECT id, meta FROM dc_posts ORDER BY id").all()).toEqual([
      { id: 1, meta: '{"summary":"s","title":"Hello \'there\'"}' },
      { id: 2, meta: null },
      { id: 3, meta: '{"title":"Bare"}' },
    ]);
    expect(into.clearSource).toEqual([]);

    db.exec("UPDATE dc_posts SET title = NULL;");
    const out = moveDataStatements(
      { from: key("meta", "title"), to: column("title") },
      sqlite("text")
    );
    run(db, out.copy);
    run(db, out.clearSource);
    expect(db.prepare("SELECT id, title, meta FROM dc_posts ORDER BY id").all()).toEqual([
      { id: 1, title: "Hello 'there'", meta: '{"summary":"s"}' },
      { id: 2, title: null, meta: null },
      { id: 3, title: "Bare", meta: "{}" },
    ]);
  });

  it("keeps a boolean a JSON boolean in the group, and 1 or 0 in its column", () => {
    const db = table("featured integer");
    db.exec(`INSERT INTO dc_posts (id, featured) VALUES (1, 1), (2, 0);`);
    run(
      db,
      moveDataStatements(
        { from: column("featured"), to: key("meta", "featured") },
        sqlite("boolean", "integer")
      ).copy
    );
    expect(db.prepare("SELECT meta FROM dc_posts ORDER BY id").all()).toEqual([
      { meta: '{"featured":true}' },
      { meta: '{"featured":false}' },
    ]);
    db.exec("UPDATE dc_posts SET featured = NULL;");
    run(
      db,
      moveDataStatements(
        { from: key("meta", "featured"), to: column("featured") },
        sqlite("boolean", "integer")
      ).copy
    );
    expect(db.prepare("SELECT featured FROM dc_posts ORDER BY id").all()).toEqual([
      { featured: 1 },
      { featured: 0 },
    ]);
  });

  it("writes a date the column holds in seconds as an ISO string in the group, and back", () => {
    const db = table("published integer");
    db.exec(`INSERT INTO dc_posts (id, published) VALUES (1, 1763280000);`);
    run(
      db,
      moveDataStatements(
        { from: column("published"), to: key("meta", "published") },
        sqlite("timestamp", "integer")
      ).copy
    );
    expect(db.prepare("SELECT meta FROM dc_posts").get()).toEqual({
      meta: '{"published":"2025-11-16T08:00:00.000Z"}',
    });
    db.exec("UPDATE dc_posts SET published = NULL;");
    run(
      db,
      moveDataStatements(
        { from: key("meta", "published"), to: column("published") },
        sqlite("timestamp", "integer")
      ).copy
    );
    expect(db.prepare("SELECT published FROM dc_posts").get()).toEqual({
      published: 1763280000,
    });
  });

  it("embeds a JSON value as JSON in the group, not as its text", () => {
    const db = table("tags text");
    db.exec(`INSERT INTO dc_posts (id, tags) VALUES (1, '["a","b"]');`);
    run(
      db,
      moveDataStatements(
        { from: column("tags"), to: key("meta", "tags") },
        sqlite("json")
      ).copy
    );
    expect(db.prepare("SELECT meta FROM dc_posts").get()).toEqual({
      meta: '{"tags":["a","b"]}',
    });
  });

  it("makes the groups above a key two levels down, keeping what they hold", () => {
    const db = table("title text");
    db.exec(
      `INSERT INTO dc_posts (id, title, meta) VALUES (1, 'A', '{"seo":{"index":true}}'), (2, 'B', NULL), (3, 'C', '{"seo":null}');`
    );
    run(
      db,
      moveDataStatements(
        { from: column("title"), to: key("meta", "seo", "title") },
        sqlite("text")
      ).copy
    );
    expect(db.prepare("SELECT meta FROM dc_posts ORDER BY id").all()).toEqual([
      { meta: '{"seo":{"index":true,"title":"A"}}' },
      { meta: '{"seo":{"title":"B"}}' },
      { meta: '{"seo":{"title":"C"}}' },
    ]);
  });

  it("moves a value between two groups as JSON, booleans and objects included", () => {
    const db = table("other text");
    db.exec(
      `INSERT INTO dc_posts (id, meta, other) VALUES (1, '{"flag":true,"card":{"a":1},"name":"x"}', NULL);`
    );
    for (const name of ["flag", "card", "name"]) {
      const moved = moveDataStatements(
        { from: key("meta", name), to: key("other", name) },
        sqlite("json")
      );
      run(db, moved.copy);
      run(db, moved.clearSource);
    }
    expect(db.prepare("SELECT meta, other FROM dc_posts").get()).toEqual({
      meta: "{}",
      other: '{"flag":true,"card":{"a":1},"name":"x"}',
    });
  });
});

describe("moveDataStatements on PostgreSQL and MySQL", () => {
  it("sets the key with jsonb_set on PostgreSQL, and reads it back with #>> and a cast", () => {
    const pg: MoveColumn = {
      table: "dc_posts",
      dialect: "postgresql",
      kind: "integer",
      columnType: "integer",
    };
    expect(
      moveDataStatements({ from: column("views"), to: key("meta", "views") }, pg)
        .copy
    ).toEqual([
      `UPDATE "dc_posts" SET "meta" = jsonb_set(COALESCE("meta", '{}'::jsonb), '{"views"}', to_jsonb("views"), true) WHERE "views" IS NOT NULL;`,
    ]);
    const out = moveDataStatements(
      { from: key("meta", "views"), to: column("views") },
      pg
    );
    expect(out.copy).toEqual([
      `UPDATE "dc_posts" SET "views" = ("meta" #>> '{"views"}')::integer WHERE jsonb_typeof("meta" #> '{"views"}') IS NOT NULL AND jsonb_typeof("meta" #> '{"views"}') <> 'null';`,
    ]);
    expect(out.clearSource).toEqual([
      `UPDATE "dc_posts" SET "meta" = "meta" #- '{"views"}' WHERE ("meta" #> '{"views"}') IS NOT NULL;`,
    ]);
  });

  it("sets the key with JSON_SET on MySQL, and reads it back unquoted", () => {
    const mysql: MoveColumn = {
      table: "dc_posts",
      dialect: "mysql",
      kind: "text",
      columnType: "varchar(255)",
    };
    expect(
      moveDataStatements({ from: column("title"), to: key("meta", "title") }, mysql)
        .copy
    ).toEqual([
      "UPDATE `dc_posts` SET `meta` = JSON_SET(COALESCE(`meta`, JSON_OBJECT()), '$.\"title\"', `title`) WHERE `title` IS NOT NULL;",
    ]);
    const out = moveDataStatements(
      { from: key("meta", "title"), to: column("title") },
      mysql
    );
    expect(out.copy).toEqual([
      "UPDATE `dc_posts` SET `title` = JSON_UNQUOTE(JSON_EXTRACT(`meta`, '$.\"title\"')) WHERE JSON_TYPE(JSON_EXTRACT(`meta`, '$.\"title\"')) IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`meta`, '$.\"title\"')) <> 'NULL';",
    ]);
    expect(out.clearSource).toEqual([
      "UPDATE `dc_posts` SET `meta` = JSON_REMOVE(`meta`, '$.\"title\"') WHERE JSON_CONTAINS_PATH(`meta`, 'one', '$.\"title\"');",
    ]);
  });

  it("refuses a key a JSON path cannot spell safely", () => {
    expect(() =>
      moveDataStatements(
        { from: column("title"), to: key("meta", `ti"tle`) },
        { table: "dc_posts", dialect: "sqlite", kind: "text", columnType: "text" }
      )
    ).toThrow();
  });
});
