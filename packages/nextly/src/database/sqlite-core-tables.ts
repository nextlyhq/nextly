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
// These definitions must agree with the canonical Drizzle schemas under
// `schemas/*/sqlite.ts`. Nothing derives one from the other — drizzle-kit's
// push path needs a TTY, which the fallback above exists to survive — so the
// agreement is asserted instead: `sqlite-core-tables.test.ts` compares every
// column of every table here against the schema that defines it. A column
// added to a schema and not here is a column the ORM writes and the table does
// not have, and every insert naming it fails.

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
      "must_change_password" INTEGER,
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
      "owner" TEXT,
      "orphaned_at" INTEGER,
      "permission_group" TEXT,
      "danger" INTEGER,
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
      "focal_x" INTEGER,
      "focal_y" INTEGER,
      "sizes" TEXT,
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
    // Content-version store. Columns match schemas/versions/sqlite.ts. The
    // durable-sequence unique index is created here too, not just the table:
    // once a fallback-created DB exists, later boots skip ensureCoreTables and
    // getCoreSchema's TableSpec does not track indexes, so a normal reconcile
    // would consider the table in sync and never add the index - leaving
    // duplicate durable version_no possible.
    `CREATE TABLE IF NOT EXISTS "nextly_versions" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "scope_kind" TEXT NOT NULL,
      "scope_slug" TEXT NOT NULL,
      "entry_id" TEXT NOT NULL,
      "version_no" INTEGER,
      "status" TEXT NOT NULL,
      "is_autosave" INTEGER NOT NULL DEFAULT 0,
      "snapshot" TEXT NOT NULL,
      "label" TEXT,
      "locale" TEXT,
      "source_version_no" INTEGER,
      "draft_key" TEXT,
      "created_by" TEXT,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL,
      "revision" INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_versions_seq_uidx"
      ON "nextly_versions" ("scope_kind", "scope_slug", "entry_id", "version_no")`,
    // Its own statement, guarded with IF NOT EXISTS, so re-running this
    // bootstrap restores the index if it is ever missing. The CREATE TABLE
    // above cannot do the same for the column: SQLite skips that statement
    // wholesale once the table exists.
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_versions_working_draft_uidx"
      ON "nextly_versions" ("draft_key")`,
    `CREATE INDEX IF NOT EXISTS "nextly_versions_doc_recent_idx"
      ON "nextly_versions" ("scope_kind", "scope_slug", "entry_id", "created_at")`,
    // No REFERENCES to "email_providers": that table is not bootstrapped here,
    // and SQLite resolves a foreign key at insert time rather than at CREATE,
    // so declaring one would turn every recorded delivery into a failure on a
    // database built from this fallback. The column is nullable and the
    // service already tolerates a provider it cannot point at.
    `CREATE TABLE IF NOT EXISTS "email_deliveries" (
      "id" TEXT PRIMARY KEY,
      "provider_id" TEXT,
      "provider_type" TEXT NOT NULL,
      "template_slug" TEXT,
      "recipient_hash" TEXT NOT NULL,
      "recipient_kind" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "attempt_count" INTEGER NOT NULL DEFAULT 1,
      "next_attempt_at" INTEGER,
      "error" TEXT,
      "message_id" TEXT,
      "retention_class" TEXT NOT NULL,
      "created_at" INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "email_deliveries_created_idx"
      ON "email_deliveries" ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "email_deliveries_recipient_idx"
      ON "email_deliveries" ("recipient_hash", "created_at")`,
    `CREATE INDEX IF NOT EXISTS "email_deliveries_status_created_idx"
      ON "email_deliveries" ("status", "created_at")`,
    `CREATE INDEX IF NOT EXISTS "email_deliveries_provider_idx"
      ON "email_deliveries" ("provider_id", "created_at")`,
    `CREATE INDEX IF NOT EXISTS "email_deliveries_retention_idx"
      ON "email_deliveries" ("retention_class", "created_at")`,
  ];
}
