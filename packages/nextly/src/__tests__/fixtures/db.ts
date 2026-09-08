import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import { defineRelations, is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { getSchemaEventsDdl } from "../../domains/schema/events/schema-events-ddl";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";

import type { Logger } from "../../services/shared";

import * as schema from "./sqlite-schema";

// v1 relations config over the fixture tables. Deliberately edge-less:
// several legacy suites mock service internals in ways that break under
// the full bundle relations; RQB `with:` traversal is validated by the
// dedicated rqb-v2-conversions integration suite instead.
export const testRelations = defineRelations(schema);

/**
 * The logger every service in these fixtures is built with.
 *
 * Services take `(adapter, logger)`. A shared silent one keeps that second
 * argument from being invented per file — which is how the first argument
 * drifted — and keeps a passing suite quiet, since a test that logs at every
 * level buries the one line that matters when it fails.
 */
export const testLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
export type TestDrizzleDb = BetterSQLite3Database<typeof testRelations>;

/**
 * Build the fixture's tables.
 *
 * The core tables come from the SAME generators production uses, so the
 * fixture cannot describe a schema that no longer exists. It previously
 * hand-copied their DDL, and the copy drifted: `permissions` gained `owner`,
 * `orphaned_at`, `permission_group` and `danger` in the schema the fixture
 * already imports, the copy did not, and since Drizzle names every column in
 * an INSERT, every write to that table failed against a table it thought it
 * knew.
 *
 * Only tables with no generator to borrow are still written out here.
 */
/**
 * `CREATE TABLE` for a table the core generators do not cover, DERIVED from its
 * own Drizzle definition.
 *
 * Hand-written DDL in a fixture is a copy of a schema, and a copy drifts. It
 * already did here twice: `permissions` gained four columns the copy never
 * grew, and `dynamic_collections` was written with ten columns against a table
 * that has twenty-five — so every query naming one of the missing fifteen
 * failed against a table the fixture thought it knew. Reading the definition
 * instead means the fixture cannot describe a schema that does not exist,
 * which is the same rule the core tables already follow by borrowing the
 * production generators.
 *
 * Deliberately narrow: columns, primary key, NOT NULL, literal defaults and
 * unique indexes. That is what a test needs to insert rows and to trip a
 * uniqueness assertion. Foreign keys and non-unique indexes are left out —
 * nothing here asserts on them, and emitting a reference to a table this
 * fixture may not have created would fail at CREATE time rather than at the
 * point a test cares about.
 */
/**
 * Whether a bundle export is a SQLite table rather than a relation, enum or
 * helper. `getTableConfig` throws on anything else, so this decides by the
 * marker Drizzle stamps on tables rather than by shape — a duck-type would
 * admit the next export that happens to have a `_` field.
 */
function isSqliteTable(value: unknown): value is SQLiteTable {
  return typeof value === "object" && value !== null && is(value, SQLiteTable);
}

/**
 * The text of a parameter-free SQL default, or null when there is none to
 * inline safely.
 *
 * Drizzle stores `sql`(unixepoch())`` as an `SQL` instance whose `queryChunks`
 * hold the raw fragments. Only a default made ENTIRELY of static text can be
 * written into DDL — one carrying bound parameters would need those values,
 * which a CREATE TABLE has nowhere to put. Returning null for that case means
 * the column simply keeps no default, which is the honest outcome; silently
 * inlining a placeholder would produce a table that accepts writes and stores
 * the wrong thing.
 */
function literalSqlDefault(value: unknown): string | null {
  const chunks = (value as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return null;
  let text = "";
  for (const chunk of chunks) {
    const parts = (chunk as { value?: unknown })?.value;
    if (!Array.isArray(parts) || parts.some(p => typeof p !== "string")) {
      return null;
    }
    text += (parts as string[]).join("");
  }
  return text.length > 0 ? text : null;
}

function ddlFor(table: SQLiteTable): string[] {
  const cfg = getTableConfig(table);
  const columns = cfg.columns.map(column => {
    const parts = [`"${column.name}"`, column.getSQLType()];
    if (column.primary) parts.push("PRIMARY KEY");
    if (column.notNull) parts.push("NOT NULL");
    // A COLUMN-level `.unique()` — `slug: text("slug").unique()` — is not one
    // of `cfg.indexes`, so the loop below never sees it. Omitting it does not
    // make a test fail; it makes a collision test PASS while the fixture
    // accepts the duplicate that production rejects, which is the shape of
    // false green this fixture exists to avoid producing.
    if (column.isUnique) parts.push("UNIQUE");
    // Only a LITERAL default belongs in DDL. A `$defaultFn` column reports
    // `hasDefault` with no value because Drizzle supplies it client-side, and
    // writing `DEFAULT undefined` would be a syntax error.
    const value = column.default;
    if (typeof value === "string")
      parts.push(`DEFAULT '${value.replace(/'/g, "''")}'`);
    else if (typeof value === "number") parts.push(`DEFAULT ${value}`);
    else if (typeof value === "boolean") parts.push(`DEFAULT ${value ? 1 : 0}`);
    else {
      // A SQL default — `default(sql`(unixepoch())`)`. Dropping it is not
      // cosmetic: `nextly_i18n_archive.archived_at` is NOT NULL and the
      // production archive path inserts without naming it, relying on the
      // database to supply the value. Without the default that insert fails
      // the NOT NULL constraint, so the archive path cannot be exercised at
      // all — a whole code path untestable because of a fixture omission.
      const sqlText = literalSqlDefault(value);
      if (sqlText !== null) parts.push(`DEFAULT ${sqlText}`);
    }
    return parts.join(" ");
  });

  // Table-level `unique().on(a, b)` constraints, which are neither columns nor
  // indexes in Drizzle's config. Emitted inside CREATE TABLE so a composite
  // uniqueness rule is enforced from the first insert.
  const tableUniques = (cfg.uniqueConstraints ?? []).map(constraint => {
    const cols = constraint.columns
      .map(c => c.name)
      .filter((n): n is string => typeof n === "string");
    return cols.length > 0
      ? `UNIQUE (${cols.map(c => `"${c}"`).join(", ")})`
      : null;
  });

  // Foreign keys, with their referential ACTIONS. The fixture turns
  // `foreign_keys` ON, so omitting these does not merely skip a constraint —
  // it silently changes behaviour a test may be asserting: production deletes
  // an `api_keys` row when its user goes and nulls its `role_id` when the role
  // goes, and a fixture without them lets a deletion test pass while leaving
  // the orphan it was written to catch.
  const foreignKeys = cfg.foreignKeys.map(fk => {
    const ref = fk.reference();
    const local = ref.columns.map(c => `"${c.name}"`).join(", ");
    const target = getTableConfig(ref.foreignTable).name;
    const remote = ref.foreignColumns.map(c => `"${c.name}"`).join(", ");
    const onDelete = fk.onDelete
      ? ` ON DELETE ${fk.onDelete.toUpperCase()}`
      : "";
    const onUpdate = fk.onUpdate
      ? ` ON UPDATE ${fk.onUpdate.toUpperCase()}`
      : "";
    return `FOREIGN KEY (${local}) REFERENCES "${target}" (${remote})${onDelete}${onUpdate}`;
  });

  const body = [
    ...columns,
    ...tableUniques.filter(Boolean),
    ...foreignKeys,
  ].join(", ");
  const statements = [`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${body});`];
  for (const index of cfg.indexes) {
    const built = index.config;
    if (!built.unique) continue;
    const cols = (built.columns as { name?: string }[])
      .map(c => c.name)
      .filter((n): n is string => typeof n === "string");
    if (cols.length === 0) continue;
    statements.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${built.name}" ON "${cfg.name}" (${cols
        .map(c => `"${c}"`)
        .join(", ")});`
    );
  }
  return statements;
}

function createTables(sqlite: Database.Database) {
  for (const statement of generateSqliteCoreTableStatements()) {
    sqlite.exec(statement);
  }
  for (const statement of getSchemaEventsDdl("sqlite")) {
    sqlite.exec(statement);
  }

  // The three tables no core generator covers, DERIVED from their own Drizzle
  // definitions rather than transcribed. See `ddlFor`: the transcription of
  // `dynamic_collections` had ten of its twenty-five columns, so every query
  // naming one of the other fifteen failed against a table the fixture
  // believed in.
  // EVERY table in the dialect bundle, derived from its own definition.
  //
  // Listing the ones a suite happens to need is how this fixture kept failing:
  // it named three, and the services also read `dynamic_singles`, which no test
  // could have told you about until one queried it and got "no such table"
  // wrapped in a generic database error. The bundle already knows the full set,
  // so asking it removes the list — and with it the question of whether the
  // list is current.
  //
  // `IF NOT EXISTS` throughout, so a table the production generators above
  // already created keeps THEIR definition. The generators are the better
  // source where they exist; this covers only what they do not.
  for (const value of Object.values(schema)) {
    if (!isSqliteTable(value)) continue;
    for (const statement of ddlFor(value)) {
      sqlite.exec(statement);
    }
  }
}

/**
 * Create an in-memory SQLite database for testing.
 *
 * This provides a fast, isolated test environment with full SQL support.
 * Each test can create a fresh database or reset between tests.
 *
 * @returns Test database instance with utilities
 */
export async function createTestDb(): Promise<{
  /**
   * The adapter the services under test are constructed with.
   *
   * A REAL `SqliteAdapter`, not an adapter-shaped object. Every service here
   * extends `BaseService`, whose `dialect` getter reads
   * `this.adapter.getCapabilities()`, and the auth services between them call
   * nine different adapter methods. A hand-written stand-in has to keep pace
   * with all of that, and the previous fixture is what happens when it does
   * not: it handed services a Drizzle database where an adapter was expected,
   * and 240 tests died on one line the moment `dialect` was read.
   *
   * A real adapter cannot drift from the interface, because it IS the
   * implementation.
   */
  adapter: ReturnType<typeof createSqliteAdapter>;
  db: TestDrizzleDb;
  sqlite: Database.Database;
  schema: typeof schema;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}> {
  // The adapter owns the connection, and everything else is derived from it.
  //
  // The order matters and is the whole trick: `:memory:` opened twice is two
  // unrelated databases, so the fixture cannot create its own handle and hand
  // the adapter a URL — the tables would exist in one and the queries run
  // against the other, silently. Instead the adapter connects, and the raw
  // handle is taken back out of its own Drizzle instance via `$client`, which
  // is the same object. One connection, three views of it.
  const adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();

  // `getDrizzle` is generic and its DEFAULT type parameter is the plain Drizzle
  // database, which does not declare `$client` even though the instance carries
  // it. Asking for the shape we need is narrower than casting the default away.
  const sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;

  // Enable foreign keys for referential integrity
  sqlite.pragma("foreign_keys = ON");

  // Create tables on that same connection.
  createTables(sqlite);

  // Let the adapter resolve tables by NAME.
  //
  // `adapter.select("users", ...)` and the Drizzle query API go through a
  // resolver that production sets during boot-time schema loading. Without one
  // the adapter cannot map a name to a table object and refuses with "not found
  // in schema registry" — which reads as a missing table rather than a missing
  // wiring, and sends the reader looking at the DDL.
  //
  // Resolved from the same bundle the fixture creates its tables from, so a
  // name the adapter can resolve is a table that exists.
  const byName = new Map<string, unknown>();
  for (const value of Object.values(schema)) {
    if (isSqliteTable(value)) byName.set(getTableConfig(value).name, value);
  }
  adapter.setTableResolver({
    getTable: (tableName: string) => byName.get(tableName) ?? null,
  });

  // The typed view the tests read and write through. `db.query` is driven by
  // the relations config, not a schema map.
  const db = adapter.getDrizzle(testRelations) as TestDrizzleDb;

  // Helper function to reset database (clear all tables)
  const reset = async () => {
    // Disable foreign keys temporarily for cascade deletes
    sqlite.pragma("foreign_keys = OFF");

    // Get all table names
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as Array<{ name: string }>;

    // Truncate each table
    for (const { name } of tables) {
      sqlite.prepare(`DELETE FROM ${name}`).run();
    }

    // Re-enable foreign keys
    sqlite.pragma("foreign_keys = ON");
  };

  // Closed through the adapter, since the adapter opened it. Closing the raw
  // handle underneath would leave the adapter believing it is still connected.
  const close = async () => {
    await adapter.disconnect();
  };

  return {
    adapter,
    db,
    sqlite,
    schema,
    reset,
    close,
  };
}

/**
 * Type for test database instance
 */
export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
