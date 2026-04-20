// Raw CREATE TABLE IF NOT EXISTS DDL for all Nextly core SQLite tables.
//
// Kept here (not in cli/commands/dev.ts where it used to live) so that any
// caller that needs to bootstrap a SQLite database can reuse the exact same
// table definitions without reaching into the dev command internals. Today
// the callers are:
//
//   1. `ensureCoreTables` in `cli/commands/dev.ts` — used as a fallback when
//      drizzle-kit pushSchema fails (e.g., non-TTY environment).
//   2. The integration test in
//      `services/users/__tests__/user-mutation-service.transaction.integration.test.ts`
//      — bootstraps a fresh in-test SQLite DB so it can exercise the real
//      onboarding code path (createLocalUser → ensureSuperAdminRole →
//      assignRoleToUser) end-to-end against live tables.
//
// Keep the list and column definitions in sync with
// `packages/nextly/src/database/schema/sqlite.ts`. If you add a column
// there, add it here as well — there is no generator bridging the two
// (a future improvement would be to derive this from the Drizzle schema
// via drizzle-kit, but that path requires a TTY for push operations).

/**
 * Return SQLite CREATE TABLE IF NOT EXISTS statements for all core Nextly
 * tables in foreign-key-safe order.
 *
 * Run them sequentially against a better-sqlite3 connection (or any SQLite
 * adapter's executeQuery) to bootstrap a fresh database.
 */
export function generateSqliteCoreTableStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS "users" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT,
      "email" TEXT NOT NULL UNIQUE,
      "email_verified" INTEGER,
      "password_updated_at" INTEGER,
      "image" TEXT,
      "password_hash" TEXT,
      "is_active" INTEGER NOT NULL DEFAULT 0,
      "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
      "locked_until" INTEGER,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS "accounts" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "type" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "provider_account_id" TEXT NOT NULL,
      "refresh_token" TEXT,
      "access_token" TEXT,
      "expires_at" INTEGER,
      "token_type" TEXT,
      "scope" TEXT,
      "id_token" TEXT,
      "session_state" TEXT,
      UNIQUE("provider", "provider_account_id")
    )`,
    `CREATE TABLE IF NOT EXISTS "sessions" (
      "session_token" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "expires" INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "verification_tokens" (
      "identifier" TEXT NOT NULL,
      "token" TEXT NOT NULL,
      "expires" INTEGER NOT NULL,
      UNIQUE("identifier", "token")
    )`,
    `CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "identifier" TEXT NOT NULL,
      "token_hash" TEXT NOT NULL,
      "expires" INTEGER NOT NULL,
      "used_at" INTEGER,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE("identifier", "token_hash")
    )`,
    `CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "identifier" TEXT NOT NULL,
      "token_hash" TEXT NOT NULL,
      "expires" INTEGER NOT NULL,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE("identifier", "token_hash")
    )`,
    `CREATE TABLE IF NOT EXISTS "refresh_tokens" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "token_hash" TEXT NOT NULL,
      "user_agent" TEXT,
      "ip_address" TEXT,
      "expires_at" INTEGER NOT NULL,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS "roles" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL UNIQUE,
      "slug" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "level" INTEGER NOT NULL DEFAULT 0,
      "is_system" INTEGER NOT NULL DEFAULT 0,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS "permissions" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "action" TEXT NOT NULL,
      "resource" TEXT NOT NULL,
      "description" TEXT,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "updated_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE("action", "resource")
    )`,
    `CREATE TABLE IF NOT EXISTS "role_permissions" (
      "id" TEXT PRIMARY KEY,
      "role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "permission_id" TEXT NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE("role_id", "permission_id")
    )`,
    `CREATE TABLE IF NOT EXISTS "user_roles" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "expires_at" INTEGER,
      UNIQUE("user_id", "role_id")
    )`,
    `CREATE TABLE IF NOT EXISTS "role_inherits" (
      "id" TEXT PRIMARY KEY,
      "parent_role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "child_role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      UNIQUE("parent_role_id", "child_role_id")
    )`,
    `CREATE TABLE IF NOT EXISTS "field_permissions" (
      "id" TEXT PRIMARY KEY,
      "role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "collection_slug" TEXT NOT NULL,
      "field_path" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "condition" TEXT,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "updated_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE("role_id", "collection_slug", "field_path")
    )`,
    // row_level_security_policies table was removed in the RLS cleanup
    // (refactor(nextly): remove RLS, commits 8c61348f + 433927f9).
    `CREATE TABLE IF NOT EXISTS "media_folders" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "parent_id" TEXT REFERENCES "media_folders"("id") ON DELETE CASCADE,
      "created_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS "media" (
      "id" TEXT PRIMARY KEY,
      "filename" TEXT NOT NULL,
      "original_filename" TEXT NOT NULL,
      "mime_type" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "width" INTEGER,
      "height" INTEGER,
      "duration" INTEGER,
      "url" TEXT NOT NULL,
      "thumbnail_url" TEXT,
      "alt_text" TEXT,
      "caption" TEXT,
      "tags" TEXT,
      "folder_id" TEXT REFERENCES "media_folders"("id") ON DELETE SET NULL,
      "uploaded_by" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
      "uploaded_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS "user_permission_cache" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "action" TEXT NOT NULL,
      "resource" TEXT NOT NULL,
      "has_permission" INTEGER NOT NULL,
      "role_ids" TEXT NOT NULL,
      "expires_at" INTEGER NOT NULL,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS "content_schema_events" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "op" TEXT NOT NULL,
      "table_name" TEXT NOT NULL,
      "sql" TEXT NOT NULL,
      "meta" TEXT,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  ];
}
