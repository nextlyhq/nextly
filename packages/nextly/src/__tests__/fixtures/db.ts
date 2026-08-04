import Database from "better-sqlite3";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { getSchemaEventsDdl } from "../../domains/schema/events/schema-events-ddl";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";

import * as schema from "./sqlite-schema";

// v1 relations config over the fixture tables. Deliberately edge-less:
// several legacy suites mock service internals in ways that break under
// the full bundle relations; RQB `with:` traversal is validated by the
// dedicated rqb-v2-conversions integration suite instead.
export const testRelations = defineRelations(schema);
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
function createTables(sqlite: Database.Database) {
  for (const statement of generateSqliteCoreTableStatements()) {
    sqlite.exec(statement);
  }
  for (const statement of getSchemaEventsDdl("sqlite")) {
    sqlite.exec(statement);
  }

  // No core-table generator covers these: they are created by the schema
  // pipeline at runtime rather than at first-run, so there is nothing to
  // reuse. Kept minimal, and to be repointed if a generator ever owns them.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      token_type TEXT NOT NULL,
      role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER,
      last_used_at INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_unique ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS api_keys_role_id_idx ON api_keys(role_id);
    CREATE INDEX IF NOT EXISTS api_keys_is_active_expires_at_idx ON api_keys(is_active, expires_at);

    CREATE TABLE IF NOT EXISTS dynamic_collections (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      fields TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS nextly_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS nextly_meta_updated_at_idx ON nextly_meta(updated_at);
  `);
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
  db: TestDrizzleDb;
  sqlite: Database.Database;
  schema: typeof schema;
  reset: () => Promise<void>;
  close: () => void;
}> {
  // Create in-memory SQLite database
  const sqlite = new Database(":memory:");

  // Enable foreign keys for referential integrity
  sqlite.pragma("foreign_keys = ON");

  // Create Drizzle instance. v1: the object form is required (positional
  // silently opens a NEW :memory: db), and db.query is driven by the
  // relations config, not a schema map.
  const db = drizzle({ client: sqlite, relations: testRelations });

  // Create tables
  createTables(sqlite);

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

  // Helper function to close database
  const close = () => {
    sqlite.close();
  };

  return {
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
