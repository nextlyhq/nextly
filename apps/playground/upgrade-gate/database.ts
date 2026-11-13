/**
 * The databases the upgrade gate works on: a scratch database per dialect, the
 * dump that carries an install's whole state into the repository, the restore
 * that brings it back, and the catalog read that the gate compares.
 *
 * A dump holds everything the install's database held, schema and rows, as one
 * SQL text replayed whole: the planner reads the rows too (the ledger, the
 * registry, the migration records), so a schema alone would not be the install
 * an upgrade meets. SQLite and MySQL are dumped from their own catalogs here;
 * PostgreSQL by `pg_dump`, since it has no `SHOW CREATE TABLE`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import Sqlite from "better-sqlite3";
import mysql from "mysql2/promise";
import pg from "pg";

import { emptyTable, type Catalog, type Dialect } from "./catalog";

const run = promisify(execFile);

/** A database made for one run, dropped by `drop`. */
export interface ScratchDatabase {
  dialect: Dialect;
  /** The URL the `nextly` command and the reads below connect with. */
  url: string;
  drop(): Promise<void>;
}

/** The server URL with its database name replaced. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * A fresh, empty database on `server` (a PostgreSQL or MySQL URL) named after
 * the server's own with `suffix`, or a SQLite file at `file`. The name never
 * equals the server's own database, which is checked before anything is
 * dropped.
 */
export async function makeScratchDatabase(
  dialect: Dialect,
  target: { server?: string; file?: string },
  suffix: string
): Promise<ScratchDatabase> {
  if (dialect === "sqlite") {
    if (!target.file)
      throw new Error("A SQLite scratch database needs a file.");
    return { dialect, url: `file:${target.file}`, drop: async () => {} };
  }
  const server = target.server;
  if (!server) throw new Error(`A ${dialect} scratch database needs a server.`);
  const base = new URL(server).pathname.slice(1) || "nextly_test";
  // The base is cut, never the suffix (63 is PostgreSQL's limit, under MySQL's 64).
  const name = `${base.slice(0, 63 - suffix.length)}${suffix}`;
  if (name === base) {
    throw new Error(
      `The scratch database would be the server's own (${base}); refusing to drop it.`
    );
  }
  const admin =
    dialect === "postgresql"
      ? async (sql: string) => {
          const client = new pg.Client({ connectionString: server });
          await client.connect();
          try {
            await client.query(sql);
          } finally {
            await client.end();
          }
        }
      : async (sql: string) => {
          const connection = await mysql.createConnection(server);
          try {
            await connection.query(sql);
          } finally {
            await connection.end();
          }
        };
  const quoted = dialect === "postgresql" ? `"${name}"` : `\`${name}\``;
  const dropSql =
    dialect === "postgresql"
      ? `DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`
      : `DROP DATABASE IF EXISTS ${quoted}`;
  await admin(dropSql);
  await admin(`CREATE DATABASE ${quoted}`);
  return {
    dialect,
    url: withDatabase(server, name),
    drop: () => admin(dropSql),
  };
}

/** The path of a `file:` URL. */
function sqliteFile(url: string): string {
  return url.replace(/^file:/, "");
}

/** A MySQL connection whose rows read back exactly as stored, for dumping. */
function mysqlConnection(url: string, multipleStatements = false) {
  return mysql.createConnection({
    uri: url,
    multipleStatements,
    // Dates, JSON and big numbers as the server's text, so a dump writes back
    // what was stored rather than what JavaScript made of it.
    dateStrings: true,
    jsonStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

// ---------------------------------------------------------------------------
// Dump
// ---------------------------------------------------------------------------

/** A SQLite value as a literal. */
function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "bigint" || typeof value === "number") {
    return String(value);
  }
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  // SQLite stores only NULL, integers, reals, text and blobs, so what is left
  // is text.
  if (typeof value !== "string") {
    throw new Error(`A SQLite value of an unexpected kind: ${typeof value}`);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function dumpSqlite(url: string): string {
  const db = new Sqlite(sqliteFile(url), { readonly: true });
  db.defaultSafeIntegers(true);
  try {
    const objects = db
      .prepare(
        "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid"
      )
      .all() as {
      type: string;
      name: string;
      tableName: string;
      sql: string;
    }[];
    const lines = ["PRAGMA foreign_keys=OFF;", "BEGIN;"];
    const tables = objects.filter(
      object => object.type === "table" && !object.name.startsWith("sqlite_")
    );
    for (const table of tables) lines.push(`${table.sql};`);
    // sqlite_sequence is made by the first AUTOINCREMENT table; its rows
    // carry each table's next id.
    for (const table of [
      ...tables.map(t => t.name),
      ...(objects.some(o => o.name === "sqlite_sequence")
        ? ["sqlite_sequence"]
        : []),
    ]) {
      const rows = db.prepare(`SELECT * FROM "${table}"`).raw().all();
      for (const row of rows as unknown[][]) {
        lines.push(
          `INSERT INTO "${table}" VALUES(${row.map(sqliteLiteral).join(",")});`
        );
      }
    }
    for (const object of objects) {
      if (object.type !== "table" && !object.name.startsWith("sqlite_")) {
        lines.push(`${object.sql};`);
      }
    }
    lines.push("COMMIT;");
    return `${lines.join("\n")}\n`;
  } finally {
    db.close();
  }
}

async function dumpMysql(url: string): Promise<string> {
  const connection = await mysqlConnection(url);
  try {
    const lines = ["SET FOREIGN_KEY_CHECKS=0;"];
    const [tables] = await connection.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name"
    );
    for (const { name } of tables as { name: string }[]) {
      const [[created]] = (await connection.query(
        `SHOW CREATE TABLE \`${name}\``
      )) as unknown as [Record<string, string>[]];
      lines.push(`${created["Create Table"]};`);
      // Generated columns are computed again on insert, so they are left out.
      const [columns] = await connection.query(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND extra NOT LIKE '%GENERATED%' ORDER BY ordinal_position",
        [name]
      );
      const names = (columns as { name: string }[]).map(c => c.name);
      const [rows] = await connection.query({
        sql: `SELECT ${names.map(c => `\`${c}\``).join(", ")} FROM \`${name}\``,
        rowsAsArray: true,
      });
      for (const row of rows as unknown[][]) {
        lines.push(
          `INSERT INTO \`${name}\` (${names.map(c => `\`${c}\``).join(", ")}) VALUES (${row.map(value => connection.escape(value)).join(", ")});`
        );
      }
    }
    const [triggers] = await connection.query(
      "SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = DATABASE() ORDER BY trigger_name"
    );
    for (const { name } of triggers as { name: string }[]) {
      const [[created]] = (await connection.query(
        `SHOW CREATE TRIGGER \`${name}\``
      )) as unknown as [Record<string, string>[]];
      // The definer is the recording server's account, which the gate's
      // server may not have.
      lines.push(
        `${created["SQL Original Statement"].replace(/DEFINER=`[^`]*`@`[^`]*`\s*/, "")};`
      );
    }
    lines.push("SET FOREIGN_KEY_CHECKS=1;");
    return `${lines.join("\n")}\n`;
  } finally {
    await connection.end();
  }
}

/**
 * The command that dumps a PostgreSQL database: `pg_dump` on the PATH, or,
 * where the server runs in a container, `pg_dump` inside it, named by
 * `container`. Either must be the server's major version or newer.
 */
async function dumpPostgres(url: string, container?: string): Promise<string> {
  const parsed = new URL(url);
  const flags = [
    "--no-owner",
    "--no-privileges",
    "--no-comments",
    "--inserts",
    "--rows-per-insert=200",
  ];
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const user = decodeURIComponent(parsed.username);
  const { stdout } = container
    ? await run(
        "docker",
        [
          "exec",
          "-e",
          `PGPASSWORD=${decodeURIComponent(parsed.password)}`,
          container,
          "pg_dump",
          "-U",
          user,
          "-d",
          database,
          ...flags,
        ],
        { maxBuffer: 256 * 1024 * 1024 }
      )
    : await run("pg_dump", [...flags, url], {
        maxBuffer: 256 * 1024 * 1024,
      });
  return (
    stdout
      .split("\n")
      // psql's own commands (`\restrict`) and the comment lines are not SQL a
      // plain connection runs, and carry nothing the restore needs.
      .filter(line => !line.startsWith("\\") && !line.startsWith("--"))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
  );
}

/** Everything `url` holds, as SQL that `restore` replays into an empty database. */
export async function dump(
  dialect: Dialect,
  url: string,
  options: { pgDumpContainer?: string } = {}
): Promise<string> {
  if (dialect === "sqlite") return dumpSqlite(url);
  if (dialect === "mysql") return dumpMysql(url);
  return dumpPostgres(url, options.pgDumpContainer);
}

/** Replays a dump into the empty database at `url`. */
export async function restore(
  dialect: Dialect,
  url: string,
  sql: string
): Promise<void> {
  if (dialect === "sqlite") {
    const db = new Sqlite(sqliteFile(url));
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
    return;
  }
  if (dialect === "mysql") {
    const connection = await mysqlConnection(url, true);
    try {
      await connection.query(sql);
    } finally {
      await connection.end();
    }
    return;
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** A table's shape in `catalog`, made on first use. */
function tableIn(catalog: Catalog, table: string) {
  catalog[table] ??= emptyTable();
  return catalog[table];
}

function readSqliteCatalog(url: string): Catalog {
  const db = new Sqlite(sqliteFile(url), { readonly: true });
  try {
    const catalog: Catalog = {};
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];
    for (const { name } of tables) {
      const shape = tableIn(catalog, name);
      const columns = db.prepare(`PRAGMA table_xinfo("${name}")`).all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
        hidden: number;
      }[];
      for (const column of columns) {
        shape.columns[column.name] = [
          column.type.toLowerCase() || "(no type)",
          column.notnull ? "not null" : "null",
          column.dflt_value === null ? "" : `default ${column.dflt_value}`,
          column.pk ? `primary key ${column.pk}` : "",
          column.hidden ? "generated" : "",
        ]
          .filter(Boolean)
          .join(" ");
      }
      const indexes = db.prepare(`PRAGMA index_list("${name}")`).all() as {
        name: string;
        unique: number;
        origin: string;
        partial: number;
      }[];
      for (const index of indexes) {
        const keyColumns = (
          db.prepare(`PRAGMA index_info("${index.name}")`).all() as {
            name: string | null;
          }[]
        ).map(column => column.name ?? "(expression)");
        const definition = `${index.unique ? "unique " : ""}(${keyColumns.join(", ")})${index.partial ? " partial" : ""}`;
        if (index.origin === "c") {
          // Created by CREATE INDEX: its name is the one Nextly chose. The
          // statement says what it covers, the WHERE of a partial one included.
          const { sql } = db
            .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
            .get(index.name) as { sql: string };
          const where = /\bWHERE\b([\s\S]*)$/i.exec(sql);
          shape.indexes[index.name] = where
            ? `${definition} where ${where[1].trim()}`
            : definition;
        } else {
          // A UNIQUE or PRIMARY KEY constraint's own index: SQLite numbers
          // its name by position, so it is named by what it covers.
          const kind = index.origin === "pk" ? "primary key" : "unique";
          shape.constraints[`${kind} (${keyColumns.join(", ")})`] = kind;
        }
      }
      const keys = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as {
        id: number;
        table: string;
        from: string;
        to: string | null;
        on_update: string;
        on_delete: string;
      }[];
      const byId = new Map<number, typeof keys>();
      for (const key of keys)
        byId.set(key.id, [...(byId.get(key.id) ?? []), key]);
      for (const parts of byId.values()) {
        const from = parts.map(part => part.from).join(", ");
        const to = parts.map(part => part.to ?? "(primary key)").join(", ");
        shape.constraints[`foreign key (${from}) -> ${parts[0].table}`] =
          `references ${parts[0].table} (${to}) on update ${parts[0].on_update} on delete ${parts[0].on_delete}`;
      }
    }
    const triggers = db
      .prepare(
        "SELECT name, tbl_name AS tableName, sql FROM sqlite_master WHERE type = 'trigger'"
      )
      .all() as { name: string; tableName: string; sql: string }[];
    for (const trigger of triggers) {
      tableIn(catalog, trigger.tableName).triggers[trigger.name] = trigger.sql
        .replace(/\s+/g, " ")
        .trim();
    }
    return catalog;
  } finally {
    db.close();
  }
}

async function readPostgresCatalog(url: string): Promise<Catalog> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const catalog: Catalog = {};
    const query = async <Row>(sql: string) =>
      (await client.query(sql)).rows as Row[];
    for (const { name } of await query<{ name: string }>(
      "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')"
    )) {
      tableIn(catalog, name);
    }
    for (const column of await query<{
      tableName: string;
      name: string;
      type: string;
      notNull: boolean;
      defaultValue: string | null;
      identity: string;
      generated: string;
    }>(
      `SELECT c.relname AS "tableName", a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS "notNull",
              pg_get_expr(d.adbin, d.adrelid) AS "defaultValue",
              a.attidentity AS identity, a.attgenerated AS generated
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')
          AND a.attnum > 0 AND NOT a.attisdropped`
    )) {
      tableIn(catalog, column.tableName).columns[column.name] = [
        column.type,
        column.notNull ? "not null" : "null",
        column.defaultValue === null
          ? ""
          : `${column.generated ? "generated" : "default"} ${column.defaultValue}`,
        column.identity ? "identity" : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    for (const index of await query<{
      tableName: string;
      name: string;
      definition: string;
    }>(
      `SELECT tablename AS "tableName", indexname AS name, indexdef AS definition
         FROM pg_indexes WHERE schemaname = current_schema()`
    )) {
      // The statement without its name and table, which the operation names.
      tableIn(catalog, index.tableName).indexes[index.name] = index.definition
        .replace(/^CREATE (UNIQUE )?INDEX \S+ ON (ONLY )?\S+ /, (_, unique) =>
          unique ? "unique " : ""
        )
        .trim();
    }
    for (const constraint of await query<{
      tableName: string;
      name: string;
      definition: string;
    }>(
      `SELECT c.relname AS "tableName", k.conname AS name,
              pg_get_constraintdef(k.oid) AS definition
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()`
    )) {
      tableIn(catalog, constraint.tableName).constraints[constraint.name] =
        constraint.definition;
    }
    for (const trigger of await query<{
      tableName: string;
      name: string;
      definition: string;
    }>(
      `SELECT c.relname AS "tableName", t.tgname AS name,
              pg_get_triggerdef(t.oid) AS definition
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND NOT t.tgisinternal`
    )) {
      tableIn(catalog, trigger.tableName).triggers[trigger.name] =
        trigger.definition.replace(/^CREATE (OR REPLACE )?TRIGGER \S+ /, "");
    }
    return catalog;
  } finally {
    await client.end();
  }
}

async function readMysqlCatalog(url: string): Promise<Catalog> {
  const connection = await mysqlConnection(url);
  try {
    const catalog: Catalog = {};
    const query = async <Row>(sql: string) =>
      (await connection.query(sql))[0] as Row[];
    for (const { name } of await query<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
    )) {
      tableIn(catalog, name);
    }
    for (const column of await query<{
      tableName: string;
      name: string;
      type: string;
      nullable: string;
      defaultValue: string | null;
      extra: string;
      collation: string | null;
    }>(
      `SELECT table_name AS tableName, column_name AS name, column_type AS type,
              is_nullable AS nullable, column_default AS defaultValue,
              extra AS extra, collation_name AS collation
         FROM information_schema.columns WHERE table_schema = DATABASE()`
    )) {
      if (!(column.tableName in catalog)) continue;
      catalog[column.tableName].columns[column.name] = [
        column.type,
        column.nullable === "YES" ? "null" : "not null",
        column.defaultValue === null ? "" : `default ${column.defaultValue}`,
        column.extra.toLowerCase(),
        column.collation ? `collate ${column.collation}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    const indexColumns = new Map<string, string[]>();
    const indexHeads = new Map<
      string,
      { table: string; name: string; head: string }
    >();
    for (const part of await query<{
      tableName: string;
      name: string;
      nonUnique: number;
      column: string | null;
      expression: string | null;
      subPart: number | null;
      type: string;
    }>(
      `SELECT table_name AS tableName, index_name AS name, non_unique AS nonUnique,
              column_name AS \`column\`, expression AS expression, sub_part AS subPart,
              index_type AS type
         FROM information_schema.statistics WHERE table_schema = DATABASE()
        ORDER BY table_name, index_name, seq_in_index`
    )) {
      const key = `${part.tableName}\u0000${part.name}`;
      indexHeads.set(key, {
        table: part.tableName,
        name: part.name,
        head: `${Number(part.nonUnique) === 0 ? "unique " : ""}${part.type.toLowerCase()}`,
      });
      indexColumns.set(key, [
        ...(indexColumns.get(key) ?? []),
        `${part.column ?? part.expression ?? "?"}${part.subPart ? `(${part.subPart})` : ""}`,
      ]);
    }
    for (const [key, { table, name, head }] of indexHeads) {
      tableIn(catalog, table).indexes[name] =
        `${head} (${indexColumns.get(key)!.join(", ")})`;
    }
    const foreignKeys = new Map<
      string,
      {
        table: string;
        name: string;
        from: string[];
        to: string[];
        references: string;
        rules: string;
      }
    >();
    for (const part of await query<{
      tableName: string;
      name: string;
      column: string;
      referencedTable: string;
      referencedColumn: string;
      onUpdate: string;
      onDelete: string;
    }>(
      `SELECT k.table_name AS tableName, k.constraint_name AS name,
              k.column_name AS \`column\`, k.referenced_table_name AS referencedTable,
              k.referenced_column_name AS referencedColumn,
              r.update_rule AS onUpdate, r.delete_rule AS onDelete
         FROM information_schema.key_column_usage k
         JOIN information_schema.referential_constraints r
           ON r.constraint_schema = k.constraint_schema
          AND r.constraint_name = k.constraint_name
          AND r.table_name = k.table_name
        WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL
        ORDER BY k.table_name, k.constraint_name, k.ordinal_position`
    )) {
      const key = `${part.tableName}\u0000${part.name}`;
      const entry = foreignKeys.get(key) ?? {
        table: part.tableName,
        name: part.name,
        from: [],
        to: [],
        references: part.referencedTable,
        rules: `on update ${part.onUpdate.toLowerCase()} on delete ${part.onDelete.toLowerCase()}`,
      };
      entry.from.push(part.column);
      entry.to.push(part.referencedColumn);
      foreignKeys.set(key, entry);
    }
    for (const key of foreignKeys.values()) {
      tableIn(catalog, key.table).constraints[key.name] =
        `foreign key (${key.from.join(", ")}) references ${key.references} (${key.to.join(", ")}) ${key.rules}`;
    }
    for (const check of await query<{
      tableName: string;
      name: string;
      clause: string;
    }>(
      `SELECT t.table_name AS tableName, c.constraint_name AS name,
              c.check_clause AS clause
         FROM information_schema.check_constraints c
         JOIN information_schema.table_constraints t
           ON t.constraint_schema = c.constraint_schema
          AND t.constraint_name = c.constraint_name
        WHERE c.constraint_schema = DATABASE() AND t.constraint_type = 'CHECK'`
    )) {
      tableIn(catalog, check.tableName).constraints[check.name] =
        `check ${check.clause}`;
    }
    for (const trigger of await query<{
      tableName: string;
      name: string;
      timing: string;
      event: string;
      statement: string;
    }>(
      `SELECT event_object_table AS tableName, trigger_name AS name,
              action_timing AS timing, event_manipulation AS event,
              action_statement AS statement
         FROM information_schema.triggers WHERE trigger_schema = DATABASE()`
    )) {
      tableIn(catalog, trigger.tableName).triggers[trigger.name] =
        `${trigger.timing.toLowerCase()} ${trigger.event.toLowerCase()} ${trigger.statement.replace(/\s+/g, " ").trim()}`;
    }
    return catalog;
  } finally {
    await connection.end();
  }
}

/** The catalog of the database at `url`, read from its own system tables. */
export async function readCatalog(
  dialect: Dialect,
  url: string
): Promise<Catalog> {
  if (dialect === "sqlite") return readSqliteCatalog(url);
  if (dialect === "mysql") return readMysqlCatalog(url);
  return readPostgresCatalog(url);
}
