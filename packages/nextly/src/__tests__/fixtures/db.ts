import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "@nextly/database/schema/sqlite";

/**
 * Create database tables using raw SQL.
 * This is faster than using migrations for tests.
 * Schema matches packages/nextly/src/database/schema/sqlite.ts
 */
function createTables(sqlite: Database.Database) {
  // Create all necessary tables for RBAC testing
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      level INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique ON roles(name);
    CREATE UNIQUE INDEX IF NOT EXISTS roles_slug_unique ON roles(slug);
    CREATE INDEX IF NOT EXISTS roles_level_idx ON roles(level);
    CREATE INDEX IF NOT EXISTS roles_is_system_idx ON roles(is_system);

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS permissions_name_unique ON permissions(name);
    CREATE UNIQUE INDEX IF NOT EXISTS permissions_slug_unique ON permissions(slug);
    CREATE UNIQUE INDEX IF NOT EXISTS permissions_action_resource_unique ON permissions(action, resource);
    CREATE INDEX IF NOT EXISTS permissions_action_idx ON permissions(action);
    CREATE INDEX IF NOT EXISTS permissions_resource_idx ON permissions(resource);

    CREATE TABLE IF NOT EXISTS role_permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_role_id_permission_id_unique ON role_permissions(role_id, permission_id);
    CREATE INDEX IF NOT EXISTS role_permissions_role_id_idx ON role_permissions(role_id);
    CREATE INDEX IF NOT EXISTS role_permissions_permission_id_idx ON role_permissions(permission_id);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER,
      password_updated_at INTEGER,
      image TEXT,
      password_hash TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
    CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prt_identifier_token_hash_unique ON password_reset_tokens(identifier, token_hash);
    CREATE INDEX IF NOT EXISTS prt_expires_idx ON password_reset_tokens(expires);
    CREATE INDEX IF NOT EXISTS prt_used_at_idx ON password_reset_tokens(used_at);

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS evt_identifier_token_hash_unique ON email_verification_tokens(identifier, token_hash);
    CREATE INDEX IF NOT EXISTS evt_expires_idx ON email_verification_tokens(expires);

    CREATE TABLE IF NOT EXISTS verification_tokens (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS verification_tokens_identifier_token_pk ON verification_tokens(identifier, token);
    CREATE INDEX IF NOT EXISTS verification_tokens_token_idx ON verification_tokens(token);

    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      expires_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_role_id_unique ON user_roles(user_id, role_id);
    CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON user_roles(user_id);
    CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles(role_id);
    CREATE INDEX IF NOT EXISTS user_roles_expires_at_idx ON user_roles(expires_at);

    CREATE TABLE IF NOT EXISTS role_inherits (
      id TEXT PRIMARY KEY,
      parent_role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      child_role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS role_inherits_parent_role_id_child_role_id_unique ON role_inherits(parent_role_id, child_role_id);
    CREATE INDEX IF NOT EXISTS role_inherits_parent_role_id_idx ON role_inherits(parent_role_id);
    CREATE INDEX IF NOT EXISTS role_inherits_child_role_id_idx ON role_inherits(child_role_id);

    CREATE TABLE IF NOT EXISTS dynamic_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      table_name TEXT NOT NULL UNIQUE,
      description TEXT,
      icon TEXT,
      schema_definition TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS dynamic_collections_name_unique ON dynamic_collections(name);
    CREATE UNIQUE INDEX IF NOT EXISTS dynamic_collections_table_name_unique ON dynamic_collections(table_name);
    CREATE INDEX IF NOT EXISTS dynamic_collections_created_by_idx ON dynamic_collections(created_by);
    CREATE INDEX IF NOT EXISTS dynamic_collections_created_at_idx ON dynamic_collections(created_at);
    CREATE INDEX IF NOT EXISTS dynamic_collections_updated_at_idx ON dynamic_collections(updated_at);

    CREATE TABLE IF NOT EXISTS media_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT REFERENCES media_folders(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS media_folders_parent_id_idx ON media_folders(parent_id);
    CREATE INDEX IF NOT EXISTS media_folders_created_by_idx ON media_folders(created_by);
    CREATE INDEX IF NOT EXISTS media_folders_created_at_idx ON media_folders(created_at);

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      duration INTEGER,
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      alt_text TEXT,
      caption TEXT,
      tags TEXT,
      folder_id TEXT REFERENCES media_folders(id) ON DELETE SET NULL,
      uploaded_by TEXT REFERENCES users(id) ON DELETE CASCADE,
      uploaded_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS media_uploaded_by_idx ON media(uploaded_by);
    CREATE INDEX IF NOT EXISTS media_mime_type_idx ON media(mime_type);
    CREATE INDEX IF NOT EXISTS media_uploaded_at_idx ON media(uploaded_at);
    CREATE INDEX IF NOT EXISTS media_folder_id_idx ON media(folder_id);
    CREATE INDEX IF NOT EXISTS media_tags_idx ON media(tags);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
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
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  schema: typeof schema;
  reset: () => Promise<void>;
  close: () => void;
}> {
  // Create in-memory SQLite database
  const sqlite = new Database(":memory:");

  // Enable foreign keys for referential integrity
  sqlite.pragma("foreign_keys = ON");

  // Create Drizzle instance with schema
  const db = drizzle(sqlite, { schema });

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
