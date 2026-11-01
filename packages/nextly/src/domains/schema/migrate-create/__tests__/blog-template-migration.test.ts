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
import { fileURLToPath } from "node:url";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { media } from "../../../../schemas/media/mysql";
import { users } from "../../../../schemas/users/mysql";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { registeredStatus } from "../../migrate/metadata-register";
import { loadSnapshots, newestApplied } from "../../migrate/snapshot-source";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "../generate";

// The template imports nextly by its published names, which vitest.config.ts
// resolves to this package's source for template files: `nextly/config` to the
// real config surface, so the template's collections are built by the real
// field helpers, and `nextly` to the package root, replaced here by the one
// name the template reads from it rather than every service. Each records that
// a template import reached it, so a template that stopped resolving to this
// source fails the check below by name.
const reached = vi.hoisted(() => new Set<string>());
vi.mock("../../../../config", async importOriginal => {
  reached.add("nextly/config");
  return importOriginal();
});
vi.mock("../../../../index", async () => {
  reached.add("nextly");
  return {
    NextlyError: (await import("../../../../errors/nextly-error")).NextlyError,
  };
});

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

/**
 * One export of a module in the blog template. Loaded by a path built at run
 * time, which TypeScript does not follow: the template is its own project,
 * and a static import would pull its files into this package's type check.
 */
async function templateExport(file: string, name: string): Promise<unknown> {
  const module: Record<string, unknown> = await import(
    fileURLToPath(new URL(file, TEMPLATE))
  );
  return module[name];
}

async function blogEntities() {
  const [Posts, Categories, Tags, SiteSettings, Navigation, Homepage] =
    await Promise.all([
      templateExport("src/collections/Posts/index.ts", "Posts"),
      templateExport("src/collections/Categories.ts", "Categories"),
      templateExport("src/collections/Tags.ts", "Tags"),
      templateExport("src/singles/SiteSettings/index.ts", "SiteSettings"),
      templateExport("src/singles/Navigation/index.ts", "Navigation"),
      templateExport("src/singles/Homepage/index.ts", "Homepage"),
    ]);
  return {
    collections: toMinimalEntities([Posts, Categories, Tags], e =>
      resolveCollectionTableName(e.slug, e.dbName)
    ),
    singles: toMinimalEntities([SiteSettings, Navigation, Homepage], e =>
      resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
    ),
  };
}

/**
 * Whether a visual blog reads each table as Draft/Published, by table name. A
 * visual blog registers its collections and Singles from the template's
 * migration snapshot, read and resolved here by the same functions
 * registration uses, with the same default for a snapshot that leaves `status`
 * out. A table no snapshot describes is not registered, so it has no entry.
 */
async function visualStatus(): Promise<Map<string, boolean>> {
  const loaded = await loadSnapshots({
    migrationsDir: fileURLToPath(new URL("migrations", TEMPLATE)),
  });
  return new Map(
    [
      ...newestApplied(loaded, s => s.collections),
      ...newestApplied(loaded, s => s.singles),
    ].map(entry => [entry.tableName, registeredStatus(entry)])
  );
}

describe("the blog template's code, as this test loads it", () => {
  it("imports nextly from this package's source", async () => {
    await blogEntities();
    expect([...reached].sort()).toEqual(["nextly", "nextly/config"]);
  });
});

describe("the blog template's migration", () => {
  // The check below counts what a visual blog registers only if the snapshot
  // was read: the reader answers an empty list for a missing or unreadable
  // `meta` folder, which would leave only the code-first config to check.
  it("reads what a visual blog registers from the template's snapshot", async () => {
    const visual = await visualStatus();
    const { collections, singles } = await blogEntities();
    const codeFirst = [...collections, ...singles];
    expect([...visual.keys()].sort()).toEqual(
      codeFirst.map(e => e.tableName).sort()
    );
    // At least one table is Draft/Published only through registration's
    // default, or the snapshot adds nothing the code-first config does not.
    expect(
      codeFirst
        .filter(e => e.status !== true && visual.get(e.tableName) === true)
        .map(e => e.tableName)
    ).not.toEqual([]);
  });

  for (const dialect of Object.keys(MIGRATION_FILES) as SupportedDialect[]) {
    it(`creates every table and column nextly expects (${dialect})`, async () => {
      const sql = readFileSync(
        new URL(MIGRATION_FILES[dialect], TEMPLATE),
        "utf8"
      );
      const created = createdTables(sql);
      // A table is Draft/Published when the code-first config says so, or when
      // a visual blog registers it so. Both approaches run this one migration,
      // so it must carry every column nextly adds with status for either, which
      // the builder below decides, not this test.
      const visual = await visualStatus();
      const withStatus = (e: MinimalConfigEntity): MinimalConfigEntity => ({
        ...e,
        status: e.status === true || visual.get(e.tableName) === true,
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

  // A foreign key's column holds its target's ids, so it has the target
  // column's exact type: narrower refuses a real id (a user id longer than 36
  // characters, error 1406, before users' references were widened), wider
  // holds values the target never can. The targets nextly owns are read from
  // nextly's own schema, the template's from this file.
  it("gives each foreign key its target column's exact type", () => {
    const created = createdTables(sql);
    const typeOf = (table: string, column: string) =>
      created.get(table)?.find(c => c.name === column)?.type;
    const nextlyIds: Record<string, string> = {
      users: users.id.getSQLType().toLowerCase(),
      media: media.id.getSQLType().toLowerCase(),
    };
    const keys: Array<[string, string, string, string]> = [];
    const reference =
      /FOREIGN KEY\s*\(`([^`]+)`\)\s*REFERENCES\s+`([^`]+)`\s*\(`([^`]+)`\)/;
    for (const [, table, body] of sql.matchAll(
      /CREATE TABLE IF NOT EXISTS\s+`([^`]+)`\s*\(([\s\S]*?)\n\)/g
    ))
      for (const [, column, target, targetColumn] of body.matchAll(
        new RegExp(reference.source, "g")
      ))
        keys.push([table, column, target, targetColumn]);
    for (const [, table, column, target, targetColumn] of sql.matchAll(
      new RegExp(
        /ALTER TABLE\s+`([^`]+)`\s+ADD CONSTRAINT\s+`[^`]+`\s+/.source +
          reference.source,
        "g"
      )
    ))
      keys.push([table, column, target, targetColumn]);
    // Every foreign key the file declares, so one dropped by an edit fails here
    // rather than leaving its column unchecked.
    expect(
      keys.map(([t, c, target, tc]) => `${t}.${c} -> ${target}.${tc}`).sort()
    ).toEqual([
      "dc_posts.author -> users.id",
      "dc_posts.featured_image -> media.id",
      "dc_posts_categories.category_id -> dc_categories.id",
      "dc_posts_categories.post_id -> dc_posts.id",
      "dc_posts_tags.post_id -> dc_posts.id",
      "dc_posts_tags.tag_id -> dc_tags.id",
      "single_site_settings.logo -> media.id",
      "user_ext.user_id -> users.id",
    ]);
    const expected = (target: string, targetColumn: string) =>
      targetColumn === "id" && target in nextlyIds
        ? nextlyIds[target]
        : typeOf(target, targetColumn);
    expect(keys.map(([t, c]) => `${t}.${c} ${typeOf(t, c)}`)).toEqual(
      keys.map(([t, c, target, tc]) => `${t}.${c} ${expected(target, tc)}`)
    );
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
