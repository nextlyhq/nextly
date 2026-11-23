/**
 * The statements that carry a moved field's values: run on SQLite, every value of every kind
 * arrives where the field now is and comes back unchanged on the way out; on PostgreSQL and MySQL
 * the statements are the ones the dialect's JSON functions take.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type { StoragePlace } from "../check-move";
import {
  emptiedContainers,
  mediaUsePathStatement,
  missingValuesStop,
  moveDataStatements,
  movesAsTheSameDate,
  type MoveColumn,
} from "../move-statements";

const column = (name: string): StoragePlace => ({
  kind: "column",
  column: name,
});
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
  const sqlite = (
    kind: MoveColumn["kind"],
    columnType = "text"
  ): MoveColumn => ({
    table: "dc_posts",
    dialect: "sqlite",
    kind,
    columnType,
  });

  function table(columnSql: string): Database.Database {
    const db = new Database(":memory:");
    db.exec(
      `CREATE TABLE dc_posts (id integer primary key, ${columnSql}, meta text);`
    );
    return db;
  }

  it("puts each group back as it was once a move into a nested group is undone", () => {
    const db = table("title text");
    db.exec(
      `INSERT INTO dc_posts (id, title, meta) VALUES (1, 'a', NULL), (2, 'b', '{"note":"n"}'), (3, NULL, '{"note":"n","seo":{"hint":"h"}}'), (4, 'd', '{"seo":{}}');`
    );
    const into = { from: column("title"), to: key("meta", "seo", "title") };
    const target = sqlite("text");
    run(db, moveDataStatements(into, target).copy);
    expect(db.prepare("SELECT meta FROM dc_posts WHERE id = 1").get()).toEqual({
      meta: '{"seo":{"title":"a"}}',
    });
    db.exec("UPDATE dc_posts SET title = NULL;");
    const back = moveDataStatements({ from: into.to, to: into.from }, target);
    run(db, [
      ...back.copy,
      ...back.clearSource,
      ...emptiedContainers(
        into.to as Extract<StoragePlace, { kind: "json" }>,
        target,
        true
      ),
    ]);
    expect(
      db.prepare("SELECT id, title, meta FROM dc_posts ORDER BY id").all()
    ).toEqual([
      { id: 1, title: "a", meta: null },
      { id: 2, title: "b", meta: '{"note":"n"}' },
      { id: 3, title: null, meta: '{"note":"n","seo":{"hint":"h"}}' },
      // A container that was already empty reads the same as one the way in made: both go.
      { id: 4, title: "d", meta: null },
    ]);
  });

  it("keeps a required group's empty object, whose column cannot be NULL", () => {
    expect(
      emptiedContainers(
        key("meta", "title") as Extract<StoragePlace, { kind: "json" }>,
        sqlite("text"),
        false
      )
    ).toEqual([]);
  });

  it("moves a media use's recorded path with the field, and the paths under it, for one entity only", () => {
    const db = new Database(":memory:");
    db.exec(
      "CREATE TABLE nextly_media_usage (id text primary key, media_id text, subject_kind text, subject_slug text, document_id text, field_path text, locale text, UNIQUE (subject_kind, subject_slug, document_id, field_path, locale, media_id));"
    );
    const row = (id: string, slug: string, path: string) =>
      `('${id}', 'm', 'collection', '${slug}', 'd', '${path}', '')`;
    db.exec(
      `INSERT INTO nextly_media_usage VALUES ${[
        row("1", "posts", "meta.hero"),
        row("2", "posts", "meta.hero.alt"),
        row("3", "posts", "meta.heroic"),
        row("4", "pages", "meta.hero"),
        row("5", "posts", "meta.note"),
      ].join(", ")};`
    );
    run(db, [
      mediaUsePathStatement(
        "sqlite",
        { kind: "collection", slug: "posts" },
        ["meta", "hero"],
        ["hero"]
      ),
    ]);
    expect(
      db
        .prepare("SELECT id, field_path FROM nextly_media_usage ORDER BY id")
        .all()
    ).toEqual([
      { id: "1", field_path: "hero" },
      { id: "2", field_path: "hero.alt" },
      { id: "3", field_path: "meta.heroic" },
      { id: "4", field_path: "meta.hero" },
      { id: "5", field_path: "meta.note" },
    ]);
  });

  it("copies a text column into the group, an empty one as JSON null, and back out", () => {
    const db = table("title text");
    db.exec(
      `INSERT INTO dc_posts (id, title, meta) VALUES (1, 'Hello ''there''', '{"summary":"s"}'), (2, NULL, NULL), (3, 'Bare', NULL);`
    );
    const into = moveDataStatements(
      { from: column("title"), to: key("meta", "title") },
      sqlite("text")
    );
    run(db, into.copy);
    expect(
      db.prepare("SELECT id, meta FROM dc_posts ORDER BY id").all()
    ).toEqual([
      { id: 1, meta: '{"summary":"s","title":"Hello \'there\'"}' },
      // SQL NULL, which the entry read as null, is a JSON null in the group: not a missing key.
      { id: 2, meta: '{"title":null}' },
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
    expect(
      db.prepare("SELECT id, title, meta FROM dc_posts ORDER BY id").all()
    ).toEqual([
      { id: 1, title: "Hello 'there'", meta: '{"summary":"s"}' },
      { id: 2, title: null, meta: "{}" },
      { id: 3, title: "Bare", meta: "{}" },
    ]);
  });

  // A column the move adds, or the way back puts back, may carry a database default (a table an
  // earlier version made, described as it stands): an entry whose group says null must read null,
  // not that default, once its key is cleared.
  it("carries an explicit JSON null out of a group as NULL, over the column's default", () => {
    const db = table("title text DEFAULT 'untitled'");
    db.exec(
      `INSERT INTO dc_posts (id, meta) VALUES (1, '{"title":null}'), (2, '{"title":"Kept"}'), (3, '{}');`
    );
    const out = moveDataStatements(
      { from: key("meta", "title"), to: column("title") },
      sqlite("text")
    );
    run(db, out.copy);
    run(db, out.clearSource);
    expect(
      db.prepare("SELECT id, title, meta FROM dc_posts ORDER BY id").all()
    ).toEqual([
      { id: 1, title: null, meta: "{}" },
      { id: 2, title: "Kept", meta: "{}" },
      // No key: nothing said, so the column's default stands, as for any row the move did not reach.
      { id: 3, title: "untitled", meta: "{}" },
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
    expect(
      db.prepare("SELECT featured FROM dc_posts ORDER BY id").all()
    ).toEqual([{ featured: 1 }, { featured: 0 }]);
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

  it("reads a date written with an offset back as the same instant", () => {
    const db = table("published integer");
    db.exec(
      `INSERT INTO dc_posts (id, meta) VALUES (1, '{"published":"2026-11-16T10:00:00+05:00"}');`
    );
    run(
      db,
      moveDataStatements(
        { from: key("meta", "published"), to: column("published") },
        sqlite("timestamp", "integer")
      ).copy
    );
    expect(db.prepare("SELECT published FROM dc_posts").get()).toEqual({
      published: Date.parse("2026-11-16T10:00:00+05:00") / 1000,
    });
  });

  it("stops before it writes where an entry holds a date SQLite cannot keep, every value where it was", () => {
    for (const unkept of ["July 17, 2026", "2026-07-17T10:00:05.123Z"]) {
      const db = table("published integer");
      db.exec(
        `INSERT INTO dc_posts (id, meta) VALUES (1, '{"published":"${unkept}"}'), (2, '{"published":"2026-07-17T00:00:00.000Z"}');`
      );
      const out = moveDataStatements(
        { from: key("meta", "published"), to: column("published") },
        sqlite("timestamp", "integer")
      );
      expect(() => run(db, [...out.stop, ...out.copy]), unkept).toThrow(
        "NOT NULL constraint failed: nextly_unreadable_date_published.an_entry_holds_a_date_sqlite_cannot_keep"
      );
      expect(
        db.prepare("SELECT id, published, meta FROM dc_posts ORDER BY id").all()
      ).toEqual([
        { id: 1, published: null, meta: `{"published":"${unkept}"}` },
        {
          id: 2,
          published: null,
          meta: '{"published":"2026-07-17T00:00:00.000Z"}',
        },
      ]);
    }
  });

  it("stops before it writes where an entry holds a checkbox value other than true or false", () => {
    const out = moveDataStatements(
      { from: key("meta", "featured"), to: column("featured") },
      sqlite("boolean", "integer")
    );
    for (const unkept of ['"yes"', "2", '"True"']) {
      const db = table("featured integer");
      db.exec(
        `INSERT INTO dc_posts (id, meta) VALUES (1, '{"featured":${unkept}}'), (2, '{"featured":true}');`
      );
      expect(() => run(db, [...out.stop, ...out.copy]), unkept).toThrow(
        "NOT NULL constraint failed: nextly_unkept_featured.cannot_keep_featured"
      );
      expect(
        db.prepare("SELECT featured FROM dc_posts ORDER BY id").all()
      ).toEqual([{ featured: null }, { featured: null }]);
    }
    const db = table("featured integer");
    db.exec(
      `INSERT INTO dc_posts (id, meta) VALUES (1, '{"featured":true}'), (2, '{"featured":0}'), (3, '{"featured":"false"}');`
    );
    run(db, [...out.stop, ...out.copy]);
    expect(
      db.prepare("SELECT featured FROM dc_posts ORDER BY id").all()
    ).toEqual([{ featured: 1 }, { featured: 0 }, { featured: 0 }]);
  });

  it("stops before it writes where an entry holds no value for a field required where it moves", () => {
    const stop = missingValuesStop(
      sqlite("text"),
      key("meta", "summary") as Extract<StoragePlace, { kind: "json" }>,
      "summary"
    );
    for (const missing of ["NULL", "'{}'", `'{"summary":null}'`]) {
      const db = table("summary text");
      db.exec(
        `INSERT INTO dc_posts (id, meta) VALUES (1, '{"summary":"kept"}'), (2, ${missing});`
      );
      expect(() => run(db, stop), missing).toThrow(
        "NOT NULL constraint failed: nextly_unfilled_summary.needs_a_value_summary"
      );
    }
    const db = table("summary text");
    db.exec(
      `INSERT INTO dc_posts (id, meta) VALUES (1, '{"summary":"kept"}');`
    );
    run(db, stop);
  });

  it("bounds a stop's names within 63 characters, keeping the field's as far as it fits", () => {
    const name = `featured${"x".repeat(52)}`;
    const [create] = moveDataStatements(
      { from: key("meta", name), to: column(name) },
      sqlite("boolean", "integer")
    ).stop;
    const names = [...(create ?? "").matchAll(/"([^"]+)"/g)].map(
      m => m[1] ?? ""
    );
    expect(names).toHaveLength(2);
    for (const identifier of names) {
      expect(identifier.length, identifier).toBeLessThanOrEqual(63);
      expect(identifier).toMatch(/featuredx+_[0-9a-z]+$/);
    }
  });

  it("stops before it writes where an entry holds a day or a time of day that does not exist", () => {
    const out = moveDataStatements(
      { from: key("meta", "published"), to: column("published") },
      sqlite("timestamp", "integer")
    );
    // SQLite reads each as the day or time it rolls into: 2 March, the next day.
    for (const unkept of [
      "2026-02-30",
      "2025-02-29T10:00:00Z",
      "2026-07-17T24:00:00Z",
      "2026-07-17T10:60:00Z",
      // No offset: read at UTC by the copy and in the server's zone by the application.
      "2026-07-17T10:00:00",
      "2026-07-17 10:00:00Z",
    ]) {
      const db = table("published integer");
      db.exec(
        `INSERT INTO dc_posts (id, meta) VALUES (1, '{"published":"${unkept}"}');`
      );
      expect(() => run(db, [...out.stop, ...out.copy]), unkept).toThrow(
        "NOT NULL constraint failed: nextly_unreadable_date_published.an_entry_holds_a_date_sqlite_cannot_keep"
      );
    }
    const db = table("published integer");
    // Each form the save's check takes moves: as the API writes a date, a negative offset, no
    // seconds, a date alone.
    db.exec(
      `INSERT INTO dc_posts (id, meta) VALUES (1, '{"published":"2024-02-29T23:59:59Z"}'), (2, '{"published":"2026-07-17T10:00:05+05:00"}'), (3, '{"published":"2026-07-17T10:00:05.000Z"}'), (4, '{"published":"2026-07-17T10:00:05-05:00"}'), (5, '{"published":"2026-07-17T10:00Z"}'), (6, '{"published":"2026-07-17"}');`
    );
    run(db, [...out.stop, ...out.copy]);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS moved FROM dc_posts WHERE published IS NOT NULL"
        )
        .get()
    ).toEqual({ moved: 6 });
  });

  it("copies dates SQLite keeps, whole seconds written with milliseconds among them", () => {
    const db = table("published integer");
    db.exec(
      `INSERT INTO dc_posts (id, meta) VALUES (1, '{"published":"2026-07-17T10:00:05.000Z"}'), (2, '{"published":"2026-07-17"}');`
    );
    const out = moveDataStatements(
      { from: key("meta", "published"), to: column("published") },
      sqlite("timestamp", "integer")
    );
    run(db, [...out.stop, ...out.copy, ...out.clearSource]);
    expect(
      db.prepare("SELECT id, published, meta FROM dc_posts ORDER BY id").all()
    ).toEqual([
      {
        id: 1,
        published: Date.parse("2026-07-17T10:00:05.000Z") / 1000,
        meta: "{}",
      },
      { id: 2, published: Date.parse("2026-07-17") / 1000, meta: "{}" },
    ]);
  });

  it("carries an explicit JSON null between groups as null, not as a missing key", () => {
    const db = table("other text");
    db.exec(`INSERT INTO dc_posts (id, meta) VALUES (1, '{"note":null}');`);
    const moved = moveDataStatements(
      { from: key("meta", "note"), to: key("other", "note") },
      sqlite("json")
    );
    run(db, moved.copy);
    run(db, moved.clearSource);
    expect(db.prepare("SELECT meta, other FROM dc_posts").get()).toEqual({
      meta: "{}",
      other: '{"note":null}',
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
      moveDataStatements(
        { from: column("views"), to: key("meta", "views") },
        pg
      ).copy
    ).toEqual([
      // An empty column is a JSON null in the group, over any key the group kept from before.
      `UPDATE "dc_posts" SET "meta" = jsonb_set(COALESCE("meta", '{}'::jsonb), '{"views"}', 'null'::jsonb, true) WHERE "views" IS NULL;`,
      `UPDATE "dc_posts" SET "meta" = jsonb_set(COALESCE("meta", '{}'::jsonb), '{"views"}', to_jsonb("views"), true) WHERE "views" IS NOT NULL;`,
    ]);
    const out = moveDataStatements(
      { from: key("meta", "views"), to: column("views") },
      pg
    );
    expect(out.copy).toEqual([
      `UPDATE "dc_posts" SET "views" = ("meta" #>> '{"views"}')::integer WHERE jsonb_typeof("meta" #> '{"views"}') IS NOT NULL AND jsonb_typeof("meta" #> '{"views"}') <> 'null';`,
      // An explicit JSON null arrives as NULL, over any default the column has.
      `UPDATE "dc_posts" SET "views" = NULL WHERE ("meta" #> '{"views"}') IS NOT NULL AND NOT (jsonb_typeof("meta" #> '{"views"}') IS NOT NULL AND jsonb_typeof("meta" #> '{"views"}') <> 'null');`,
    ]);
    expect(out.clearSource).toEqual([
      `UPDATE "dc_posts" SET "meta" = "meta" #- '{"views"}' WHERE ("meta" #> '{"views"}') IS NOT NULL AND ("views" IS NOT NULL OR NOT (jsonb_typeof("meta" #> '{"views"}') IS NOT NULL AND jsonb_typeof("meta" #> '{"views"}') <> 'null'));`,
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
      moveDataStatements(
        { from: column("title"), to: key("meta", "title") },
        mysql
      ).copy
    ).toEqual([
      "UPDATE `dc_posts` SET `meta` = JSON_SET(COALESCE(`meta`, JSON_OBJECT()), '$.\"title\"', CAST('null' AS JSON)) WHERE `title` IS NULL;",
      "UPDATE `dc_posts` SET `meta` = JSON_SET(COALESCE(`meta`, JSON_OBJECT()), '$.\"title\"', `title`) WHERE `title` IS NOT NULL;",
    ]);
    const out = moveDataStatements(
      { from: key("meta", "title"), to: column("title") },
      mysql
    );
    expect(out.copy).toEqual([
      "UPDATE `dc_posts` SET `title` = JSON_UNQUOTE(JSON_EXTRACT(`meta`, '$.\"title\"')) WHERE JSON_TYPE(JSON_EXTRACT(`meta`, '$.\"title\"')) IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`meta`, '$.\"title\"')) <> 'NULL';",
      "UPDATE `dc_posts` SET `title` = NULL WHERE JSON_CONTAINS_PATH(`meta`, 'one', '$.\"title\"') AND NOT (JSON_TYPE(JSON_EXTRACT(`meta`, '$.\"title\"')) IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`meta`, '$.\"title\"')) <> 'NULL');",
    ]);
    expect(out.clearSource).toEqual([
      "UPDATE `dc_posts` SET `meta` = JSON_REMOVE(`meta`, '$.\"title\"') WHERE JSON_CONTAINS_PATH(`meta`, 'one', '$.\"title\"') AND (`title` IS NOT NULL OR NOT (JSON_TYPE(JSON_EXTRACT(`meta`, '$.\"title\"')) IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`meta`, '$.\"title\"')) <> 'NULL'));",
    ]);
  });

  it("reads a date out of a group as an instant on PostgreSQL and MySQL, whatever its offset", () => {
    const date = (
      dialect: "postgresql" | "mysql",
      columnType: string
    ): MoveColumn => ({
      table: "dc_posts",
      dialect,
      kind: "timestamp",
      columnType,
    });
    const out = { from: key("meta", "published"), to: column("published") };
    expect(
      moveDataStatements(out, date("postgresql", "timestamp")).copy[0]
    ).toContain(
      // A date alone is read at UTC midnight, not in the session's zone.
      `SET "published" = (("meta" #>> '{"published"}' || CASE WHEN length("meta" #>> '{"published"}') = 10 THEN 'T00:00:00Z' ELSE '' END)::timestamptz AT TIME ZONE 'UTC')`
    );
    expect(
      moveDataStatements(out, date("postgresql", "timestamp with time zone"))
        .copy[0]
    ).toContain(
      `SET "published" = ("meta" #>> '{"published"}' || CASE WHEN length("meta" #>> '{"published"}') = 10 THEN 'T00:00:00Z' ELSE '' END)::timestamptz WHERE`
    );
    // MySQL takes the offset off in minutes: CONVERT_TZ leaves a value outside the range its
    // TIMESTAMP holds as it was, an instant shifted by its offset.
    const mysql = moveDataStatements(out, date("mysql", "datetime(3)")).copy[0];
    expect(mysql).toContain("TIMESTAMPADD(MINUTE, -(");
    expect(mysql).toContain(
      "CAST(REPLACE(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(`meta`, '$.\"published\"')), '(Z|[+-][0-9]{2}:[0-9]{2})$', ''), 'T', ' ') AS DATETIME(3))"
    );
    expect(mysql).not.toContain("CONVERT_TZ");
  });

  it("stops a SQLite copy of dates out of a group, before it writes, where one cannot be kept", () => {
    const out = { from: key("meta", "published"), to: column("published") };
    const moved = moveDataStatements(out, {
      table: "dc_posts",
      dialect: "sqlite",
      kind: "timestamp",
      columnType: "integer",
    });
    // The guard table's NOT NULL column takes 1 for each held date SQLite keeps, NULL where it
    // reads none or would drop its milliseconds: the run stops there, its transaction undone.
    const [create, insert, drop] = moved.stop;
    expect(create).toBe(
      `CREATE TEMP TABLE "nextly_unreadable_date_published" ("an_entry_holds_a_date_sqlite_cannot_keep" INTEGER NOT NULL);`
    );
    // One row at most, NULL, from the first entry whose date SQLite does not keep.
    expect(insert).toMatch(
      /^INSERT INTO "nextly_unreadable_date_published" \("an_entry_holds_a_date_sqlite_cannot_keep"\) SELECT NULL FROM "dc_posts" WHERE json_type\("meta", '\$\."published"'\) IS NOT NULL AND .* LIMIT 1;$/
    );
    expect(insert).toContain(
      `date(substr(json_extract("meta", '$."published"'), 1, 10)) = substr(json_extract("meta", '$."published"'), 1, 10)`
    );
    expect(drop).toBe(`DROP TABLE "nextly_unreadable_date_published";`);
    expect(moved.copy[0]).toMatch(/^UPDATE "dc_posts" SET "published" = /);
  });

  it("counts PostgreSQL's spelled-out timestamp without time zone as holding UTC, not as zoned", () => {
    const date = (columnType: string): MoveColumn => ({
      table: "dc_posts",
      dialect: "postgresql",
      kind: "timestamp",
      columnType,
    });
    const into = { from: column("published"), to: key("meta", "published") };
    const out = { from: key("meta", "published"), to: column("published") };
    for (const plain of ["timestamp", "timestamp without time zone"]) {
      expect(moveDataStatements(into, date(plain)).copy.at(-1)).toContain(
        `to_jsonb(to_char("published", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`
      );
      expect(moveDataStatements(out, date(plain)).copy[0]).toContain(
        `::timestamptz AT TIME ZONE 'UTC')`
      );
    }
    for (const zoned of ["timestamptz", "timestamp with time zone"]) {
      expect(moveDataStatements(into, date(zoned)).copy.at(-1)).toContain(
        `"published" AT TIME ZONE 'UTC'`
      );
      expect(moveDataStatements(out, date(zoned)).copy[0]).not.toContain(
        "AT TIME ZONE"
      );
    }
  });

  it("refuses a key a JSON path cannot spell safely", () => {
    expect(() =>
      moveDataStatements(
        { from: column("title"), to: key("meta", `ti"tle`) },
        {
          table: "dc_posts",
          dialect: "sqlite",
          kind: "text",
          columnType: "text",
        }
      )
    ).toThrow();
  });
});

describe("movesAsTheSameDate", () => {
  it("takes an ISO date, alone or with a time and its offset", () => {
    for (const value of [
      "2026-07-17",
      "2026-07-17T10:00Z",
      "2026-07-17T10:00:05Z",
      "2026-07-17T10:00:05.123Z",
      "2026-07-17T10:00:05.1+05:30",
      "2024-02-29T23:59:59-13:59",
      "2026-07-17T00:00:00+14:00",
    ]) {
      expect(movesAsTheSameDate(value, "postgresql"), value).toBe(true);
    }
  });

  it("refuses on SQLite and MySQL a date with milliseconds, which their columns keep as whole seconds", () => {
    for (const value of [
      "2026-07-17T10:00:05.123Z",
      "2026-07-17T10:00:05.1+05:30",
    ]) {
      for (const dialect of ["sqlite", "mysql"] as const) {
        expect(movesAsTheSameDate(value, dialect), `${value} ${dialect}`).toBe(
          false
        );
      }
    }
    // Whole seconds, written with milliseconds or without, are kept as they are.
    for (const value of [
      "2026-07-17",
      "2026-07-17T10:00Z",
      "2026-07-17T10:00:05Z",
      "2026-07-17T10:00:05.000Z",
      "2026-07-17T10:00:05.0+05:30",
    ]) {
      for (const dialect of ["sqlite", "mysql"] as const) {
        expect(movesAsTheSameDate(value, dialect), `${value} ${dialect}`).toBe(
          true
        );
      }
    }
  });

  it("refuses a form the copy would read as another date, or not at all", () => {
    for (const value of [
      // A form JavaScript reads that SQLite's strftime cannot.
      "July 17, 2026",
      // No offset: JavaScript reads it in the server's zone, the copy at UTC.
      "2026-07-17T10:00:00",
      "2026-07-17 10:00:00Z",
      // A day that does not exist, which JavaScript rolls into the next month.
      "2026-02-30",
      "2025-02-29T00:00:00Z",
      "2026-07-17T24:00:00Z",
      "2026-07-17T10:60:00Z",
      "2026-07-17T10:00:60Z",
      // Beyond the milliseconds JavaScript keeps, which MySQL would round instead.
      "2026-07-17T10:00:00.1234Z",
      "2026-07-17T10:00:00+14:01",
      "2026-07-17T10:00:00-14:00",
      "+002026-07-17",
      "2026-07",
      "",
    ]) {
      expect(movesAsTheSameDate(value, "sqlite"), value).toBe(false);
    }
  });

  it("refuses the year 0 on PostgreSQL, whose date input has no such year", () => {
    expect(movesAsTheSameDate("0000-01-01", "postgresql")).toBe(false);
    expect(movesAsTheSameDate("0000-01-01T00:00:00Z", "postgresql")).toBe(
      false
    );
    expect(movesAsTheSameDate("0001-01-01", "postgresql")).toBe(true);
    expect(movesAsTheSameDate("0000-01-01", "sqlite")).toBe(true);
  });

  it("refuses on MySQL only an instant outside what its TIMESTAMP column holds", () => {
    for (const value of [
      "1970-01-01T00:00:01Z",
      "2038-01-19T03:14:07Z",
      "2038-01-19T03:14:07.000Z",
      // Local times outside the range, at instants inside it.
      "1970-01-01T05:00:01+05:00",
      "2038-01-19T08:14:07+05:00",
    ]) {
      expect(movesAsTheSameDate(value, "mysql"), value).toBe(true);
    }
    for (const value of [
      "1970-01-01T00:00:00Z",
      "1970-01-01",
      "2038-01-19T03:14:08Z",
      // A local time inside the range, at an instant outside it.
      "1970-01-01T00:00:01+01:00",
      "1960-01-01T10:00:00+05:00",
      "3500-01-01",
      "0999-12-31",
    ]) {
      expect(movesAsTheSameDate(value, "mysql"), value).toBe(false);
      expect(movesAsTheSameDate(value, "postgresql"), value).toBe(true);
      expect(movesAsTheSameDate(value, "sqlite"), value).toBe(true);
    }
  });
});
