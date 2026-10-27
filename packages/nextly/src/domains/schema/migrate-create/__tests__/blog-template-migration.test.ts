/**
 * The blog template's migration creates every column nextly reads.
 *
 * A blog scaffolded with the visual approach gets its tables from the SQL the
 * template ships (`templates/blog/migrations`), which is written by hand, one
 * file per dialect. Nothing tied it to the tables nextly builds, so when a
 * core change added a column to every collection with a status, the template
 * kept the old shape, and every read of a fresh visual blog's categories
 * failed on the missing column.
 *
 * This derives the tables nextly expects from the blog's own collections and
 * Singles, through the same builder `migrate:create` and `migrate:check` use,
 * and holds each dialect's SQL to them: a table or column nextly expects that
 * the SQL does not create fails. Columns the SQL adds beyond nextly's (the
 * hand-written extras) are allowed.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { SupportedDialect } from "../../../../database/index";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "../generate";

// The template imports nextly by its published names, which vitest.config.ts
// points at this package's source, so its collections are built by the real
// field helpers. The package root is replaced here by the one name the
// template reads from it, rather than loading every service.
vi.mock("nextly", async () => ({
  NextlyError: (await import("../../../../errors/nextly-error")).NextlyError,
}));

const TEMPLATE = new URL(
  "../../../../../../../templates/blog/",
  import.meta.url
);

/** The SQL file each dialect runs: the dialect's own variant, else the base file. */
const MIGRATION_FILES: Record<SupportedDialect, string> = {
  postgresql: "migrations/0001_000000_blog_schema.sql",
  mysql: "migrations/0001_000000_blog_schema.mysql.sql",
  sqlite: "migrations/0001_000000_blog_schema.sqlite.sql",
};

interface SqlColumn {
  name: string;
  type: string;
  nullable: boolean;
  /** The column's definition after its name, as written. */
  rest: string;
}

/** Each `CREATE TABLE`'s columns, by table name, read from a migration file. */
function createdTables(sql: string): Map<string, SqlColumn[]> {
  const tables = new Map<string, SqlColumn[]>();
  const statement =
    /CREATE TABLE IF NOT EXISTS\s+[`"]([^`"]+)[`"]\s*\(([\s\S]*?)\n\)/g;
  for (const [, table, body] of sql.matchAll(statement)) {
    const columns: SqlColumn[] = [];
    for (const line of body.split("\n")) {
      const column = /^\s*[`"]([^`"]+)[`"]\s+(.*)$/.exec(line);
      if (!column) continue;
      const rest = column[2].toUpperCase();
      columns.push({
        name: column[1],
        type: column[2].split(/\s+/)[0].replace(/,$/, "").toLowerCase(),
        nullable: !rest.includes("NOT NULL") && !rest.includes("PRIMARY KEY"),
        rest: column[2],
      });
    }
    tables.set(table, columns);
  }
  return tables;
}

/**
 * Each unique key a migration file creates, as `table(column, ...)`: a column
 * declared `UNIQUE`, a table's `UNIQUE KEY` line, and a `CREATE UNIQUE INDEX`.
 */
function uniqueKeys(sql: string): string[] {
  const keys: string[] = [];
  const names = (list: string) =>
    list
      .split(",")
      .map(c => c.trim().replace(/[`"]/g, "").split(/[\s(]/)[0])
      .join(", ");
  for (const [table, columns] of createdTables(sql))
    for (const c of columns)
      if (/\bUNIQUE\b/i.test(c.rest)) keys.push(`${table}(${c.name})`);
  const statement =
    /CREATE TABLE IF NOT EXISTS\s+[`"]([^`"]+)[`"]\s*\(([\s\S]*?)\n\)/g;
  for (const [, table, body] of sql.matchAll(statement))
    for (const line of body.split("\n")) {
      const key = /^\s*UNIQUE\b(?:\s+KEY)?[^(]*\(([^)]*)\)/i.exec(line);
      if (key) keys.push(`${table}(${names(key[1])})`);
    }
  for (const [, table, list] of sql.matchAll(
    /CREATE UNIQUE INDEX\s+(?:IF NOT EXISTS\s+)?[`"][^`"]+[`"]\s+ON\s+[`"]([^`"]+)[`"]\s*\(([^)]*)\)/gi
  ))
    keys.push(`${table}(${names(list)})`);
  return [...new Set(keys)].sort();
}

/**
 * The kind of value a column type holds, so a hand-written spelling of the
 * same kind (`timestamp with time zone` for `timestamp`, `varchar(255)` for
 * `text`) passes, and a column of the wrong kind does not.
 */
function typeFamily(type: string): string {
  const t = type.toLowerCase();
  if (/^(timestamp|timestamptz|datetime|date)/.test(t)) return "time";
  if (/^(json|jsonb)$/.test(t)) return "json";
  if (/^(boolean|bool|tinyint\(1\))$/.test(t)) return "boolean";
  if (/^(int|integer|bigint|smallint|tinyint|serial)/.test(t)) return "integer";
  if (/^(real|double|float|numeric|decimal)/.test(t)) return "number";
  if (/^(text|varchar|char|character|uuid|longtext|mediumtext)/.test(t))
    return "text";
  return t;
}

async function blogEntities() {
  const { Categories } = await import(
    "../../../../../../../templates/blog/src/collections/Categories"
  );
  const { Tags } = await import(
    "../../../../../../../templates/blog/src/collections/Tags"
  );
  const { Posts } = await import(
    "../../../../../../../templates/blog/src/collections/Posts/index"
  );
  const { Homepage } = await import(
    "../../../../../../../templates/blog/src/singles/Homepage/index"
  );
  const { Navigation } = await import(
    "../../../../../../../templates/blog/src/singles/Navigation/index"
  );
  const { SiteSettings } = await import(
    "../../../../../../../templates/blog/src/singles/SiteSettings/index"
  );
  return {
    collections: toMinimalEntities([Posts, Categories, Tags], e =>
      resolveCollectionTableName(e.slug, e.dbName)
    ),
    singles: toMinimalEntities([SiteSettings, Navigation, Homepage], e =>
      resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
    ),
  };
}

describe("the blog template's migration", () => {
  for (const dialect of Object.keys(MIGRATION_FILES) as SupportedDialect[]) {
    it(`creates every table and column nextly expects (${dialect})`, async () => {
      const sql = readFileSync(
        new URL(MIGRATION_FILES[dialect], TEMPLATE),
        "utf8"
      );
      const created = createdTables(sql);
      // A table the template gives a `status` column is read as a Draft/Published
      // one, whatever the code-first config says: the visual approach has no
      // config to say otherwise. So it must carry every column nextly adds with
      // status, which the builder below decides, not this test.
      const withStatus = (e: MinimalConfigEntity): MinimalConfigEntity => ({
        ...e,
        status:
          e.status === true ||
          (created.get(e.tableName) ?? []).some(c => c.name === "status"),
      });
      const { collections, singles } = await blogEntities();
      const expected = buildDesiredSnapshotFromConfig(
        collections.map(withStatus),
        singles.map(withStatus),
        [],
        dialect
      );

      const missing: string[] = [];
      const report: string[] = [];
      for (const table of expected.tables) {
        const columns = created.get(table.name);
        if (!columns) {
          missing.push(`${table.name} (the whole table)`);
          continue;
        }
        const byName = new Map(columns.map(c => [c.name, c]));
        for (const column of table.columns) {
          const found = byName.get(column.name);
          const wanted = `${column.type}${column.nullable ? "" : " NOT NULL"}`;
          if (!found) {
            missing.push(`${table.name}.${column.name} ${wanted}`);
            continue;
          }
          // Looser than nextly fails: a NULL nextly never writes breaks its reads.
          // Stricter is the template's own choice, and only reported.
          if (found.nullable && !column.nullable) {
            missing.push(`${table.name}.${column.name} must be NOT NULL`);
          } else if (found.nullable !== column.nullable) {
            report.push(
              `${table.name}.${column.name}: NOT NULL where nextly allows NULL`
            );
          }
          if (typeFamily(found.type) !== typeFamily(column.type)) {
            missing.push(
              `${table.name}.${column.name} is ${found.type}, nextly ${column.type}`
            );
          } else if (found.type !== column.type) {
            report.push(
              `${table.name}.${column.name}: ${found.type} for nextly's ${column.type}`
            );
          }
        }
        const known = new Set(table.columns.map(c => c.name));
        for (const c of columns)
          if (!known.has(c.name))
            report.push(`${table.name}.${c.name}: beyond nextly's`);
      }
      console.info(
        `[${dialect}] missing:\n  ${missing.join("\n  ")}\n[${dialect}] report:\n  ${report.join("\n  ")}`
      );
      expect(missing).toEqual([]);
    });
  }
});

/**
 * What MySQL refuses outright, which the column check above cannot see: an
 * index created `IF NOT EXISTS` or with a `WHERE` (MySQL has neither form), and a TEXT, BLOB or
 * JSON column in a key, which MySQL indexes only with a key length. Either
 * stops the migration on MySQL before the blog has any tables.
 */
describe("the blog template's MySQL migration", () => {
  const sql = readFileSync(new URL(MIGRATION_FILES.mysql, TEMPLATE), "utf8");
  const LONG =
    /^(tinytext|text|mediumtext|longtext|tinyblob|blob|mediumblob|longblob|json)$/;

  it("creates its indexes in a form MySQL runs", () => {
    const indexes = sql.match(/CREATE (?:UNIQUE )?INDEX[^;]*;/g) ?? [];
    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes.filter(i => /IF NOT EXISTS|\bWHERE\b/.test(i))).toEqual([]);
  });

  // A unique key MySQL alone leaves out lets it store rows the other dialects
  // refuse, such as two authors with one slug, which /authors/[slug] cannot
  // tell apart.
  it("creates every unique key the other dialects' files create", () => {
    const mysql = new Set(uniqueKeys(sql));
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const other = uniqueKeys(
        readFileSync(new URL(MIGRATION_FILES[dialect], TEMPLATE), "utf8")
      );
      expect(other.length).toBeGreaterThan(0);
      expect(
        other.filter(key => !mysql.has(key)),
        dialect
      ).toEqual([]);
    }
  });

  // nextly creates its own tables, `users` and `media` among them, in the
  // database's character set and collation. A foreign key needs both sides in
  // one collation, so a table naming another cannot reference them.
  it("leaves each table's character set and collation to the database", () => {
    const statements = sql.replace(/--.*$/gm, "");
    expect(
      statements.match(/\b(?:CHARSET|CHARACTER SET|COLLATE)\b[^;]*/gi)
    ).toBeNull();
  });

  it("keys no TEXT, BLOB or JSON column", () => {
    const created = createdTables(sql);
    const typeOf = (table: string, column: string) =>
      created.get(table)?.find(c => c.name === column)?.type ?? "";
    const keyed: Array<[string, string, string]> = [];
    const columnsOf = (list: string) =>
      list.split(",").map(c => c.trim().replace(/[`"]/g, "").split(/\s+/)[0]);
    const statement =
      /CREATE TABLE IF NOT EXISTS\s+`([^`]+)`\s*\(([\s\S]*?)\n\)/g;
    for (const [, table, body] of sql.matchAll(statement)) {
      for (const line of body.split("\n")) {
        const inline = /^\s*`([^`]+)`\s+.*\b(PRIMARY KEY|UNIQUE)\b/.exec(line);
        if (inline) keyed.push([table, inline[1], inline[2]]);
        const key =
          /^\s*(?:CONSTRAINT\s+`[^`]+`\s+)?(PRIMARY KEY|UNIQUE KEY|UNIQUE|KEY|INDEX|FOREIGN KEY)\b[^(]*\(([^)]*)\)/.exec(
            line
          );
        if (key)
          for (const c of columnsOf(key[2])) keyed.push([table, c, key[1]]);
      }
    }
    for (const [, table, list] of sql.matchAll(
      /CREATE (?:UNIQUE )?INDEX\s+(?:IF NOT EXISTS\s+)?`[^`]+`\s+ON\s+`([^`]+)`\s*\(([^)]*)\)/g
    )) {
      for (const c of columnsOf(list)) keyed.push([table, c, "index"]);
    }
    // MySQL indexes a foreign key's column for it, so that column is keyed too.
    for (const [, table, list] of sql.matchAll(
      /ALTER TABLE\s+`([^`]+)`\s+ADD CONSTRAINT\s+`[^`]+`\s+FOREIGN KEY\s*\(([^)]*)\)/g
    )) {
      for (const c of columnsOf(list)) keyed.push([table, c, "foreign key"]);
    }
    expect(
      keyed
        .filter(([table, column]) => LONG.test(typeOf(table, column)))
        .map(
          ([table, column, kind]) =>
            `${table}.${column} (${typeOf(table, column)}) in ${kind}`
        )
    ).toEqual([]);
  });
});
