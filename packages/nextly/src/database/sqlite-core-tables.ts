import { LIMIT_STORE_TABLE } from "../schemas/limit-store/table-name";
import { NOTICES_TABLE } from "../schemas/notices/table-name";
import { RBAC_EPOCH_TABLE } from "../schemas/rbac-epoch/table-name";
import { SCHEMA_OWNERS_TABLE } from "../schemas/schema-owners/table-name";
import { SPENT_CHALLENGES_TABLE } from "../schemas/spent-challenges/table-name";
import { STORAGE_FORMAT } from "../schemas/storage-format";

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
      "email_verified_via" TEXT,
      "password_updated_at" INTEGER,
      "image" TEXT,
      "password_hash" TEXT,
      "is_active" INTEGER NOT NULL DEFAULT 0,
      "deactivated_at" INTEGER,
      "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
      "locked_until" INTEGER,
      "must_change_password" INTEGER,
      "session_epoch" INTEGER,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE INDEX IF NOT EXISTS "users_created_at_idx"
      ON "users" ("created_at")`,
    `CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "identifier" TEXT NOT NULL,
      "token_hash" TEXT NOT NULL,
      "expires" INTEGER NOT NULL,
      "used_at" INTEGER,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE("identifier", "token_hash")
    )`,
    `CREATE INDEX IF NOT EXISTS "prt_expires_idx"
      ON "password_reset_tokens" ("expires")`,
    `CREATE INDEX IF NOT EXISTS "prt_used_at_idx"
      ON "password_reset_tokens" ("used_at")`,
    `CREATE INDEX IF NOT EXISTS "prt_token_hash_idx"
      ON "password_reset_tokens" ("token_hash")`,
    `CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "identifier" TEXT NOT NULL,
      "token_hash" TEXT NOT NULL,
      "expires" INTEGER NOT NULL,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE("identifier", "token_hash")
    )`,
    `CREATE INDEX IF NOT EXISTS "evt_expires_idx"
      ON "email_verification_tokens" ("expires")`,
    `CREATE INDEX IF NOT EXISTS "evt_token_hash_idx"
      ON "email_verification_tokens" ("token_hash")`,
    `CREATE TABLE IF NOT EXISTS "refresh_tokens" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "token_hash" TEXT NOT NULL,
      "user_agent" TEXT,
      "ip_address" TEXT,
      "expires_at" INTEGER NOT NULL,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE INDEX IF NOT EXISTS "refresh_tokens_token_hash_idx"
      ON "refresh_tokens" ("token_hash")`,
    `CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx"
      ON "refresh_tokens" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx"
      ON "refresh_tokens" ("expires_at")`,
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
    `CREATE INDEX IF NOT EXISTS "roles_level_idx"
      ON "roles" ("level")`,
    `CREATE INDEX IF NOT EXISTS "roles_is_system_idx"
      ON "roles" ("is_system")`,
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
    `CREATE INDEX IF NOT EXISTS "permissions_resource_idx"
      ON "permissions" ("resource")`,
    `CREATE INDEX IF NOT EXISTS "permissions_action_idx"
      ON "permissions" ("action")`,
    `CREATE TABLE IF NOT EXISTS "role_permissions" (
      "id" TEXT PRIMARY KEY,
      "role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "permission_id" TEXT NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE("role_id", "permission_id")
    )`,
    `CREATE INDEX IF NOT EXISTS "role_permissions_role_id_idx"
      ON "role_permissions" ("role_id")`,
    `CREATE TABLE IF NOT EXISTS "user_roles" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
      "expires_at" INTEGER,
      UNIQUE("user_id", "role_id")
    )`,
    `CREATE INDEX IF NOT EXISTS "user_roles_user_id_idx"
      ON "user_roles" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "user_roles_expires_at_idx"
      ON "user_roles" ("expires_at")`,
    `CREATE TABLE IF NOT EXISTS "role_inherits" (
      "id" TEXT PRIMARY KEY,
      "parent_role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "child_role_id" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      UNIQUE("parent_role_id", "child_role_id")
    )`,
    `CREATE INDEX IF NOT EXISTS "role_inherits_child_idx"
      ON "role_inherits" ("child_role_id")`,
    `CREATE INDEX IF NOT EXISTS "role_inherits_parent_idx"
      ON "role_inherits" ("parent_role_id")`,
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
    `CREATE INDEX IF NOT EXISTS "media_folders_parent_id_idx"
      ON "media_folders" ("parent_id")`,
    `CREATE INDEX IF NOT EXISTS "media_folders_created_by_idx"
      ON "media_folders" ("created_by")`,
    `CREATE INDEX IF NOT EXISTS "media_folders_created_at_idx"
      ON "media_folders" ("created_at")`,
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
    `CREATE INDEX IF NOT EXISTS "media_uploaded_by_idx"
      ON "media" ("uploaded_by")`,
    `CREATE INDEX IF NOT EXISTS "media_mime_type_idx"
      ON "media" ("mime_type")`,
    `CREATE INDEX IF NOT EXISTS "media_uploaded_at_idx"
      ON "media" ("uploaded_at")`,
    `CREATE INDEX IF NOT EXISTS "media_folder_id_idx"
      ON "media" ("folder_id")`,
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
    `CREATE INDEX IF NOT EXISTS "upc_user_id_idx"
      ON "user_permission_cache" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "upc_expires_at_idx"
      ON "user_permission_cache" ("expires_at")`,
    `CREATE INDEX IF NOT EXISTS "upc_user_action_resource_idx"
      ON "user_permission_cache" ("user_id", "action", "resource")`,
    // The counter every instance reads to decide whether a cached
    // authorization answer is still current. One row, keyed `global`: the
    // primary key is what makes a second counter unrepresentable, so nothing
    // has to keep "there is exactly one" true.
    //
    // Reached by an existing installation because this whole bootstrap is
    // re-run as a reconciliation, and `IF NOT EXISTS` adds only what is absent.
    // That is why the epoch is a TABLE rather than a column on the rows above:
    // SQLite skips a `CREATE TABLE` wholesale once the table exists, so a new
    // column there would never arrive.
    `CREATE TABLE IF NOT EXISTS "${RBAC_EPOCH_TABLE}" (
      "id" TEXT PRIMARY KEY,
      "revision" INTEGER NOT NULL,
      "generation" TEXT NOT NULL,
      "updated_at" INTEGER NOT NULL
    )`,
    // Bootstrapped rather than exempted. A database built from this fallback
    // without it has no ownership record at all, and the rule that keeps
    // data — "a table with no owner row is never dropped" — would then be
    // true of EVERY table, which quietly disables the protection rather than
    // failing.
    // The primary key is COMPOSITE, matching the canonical schema: ownership
    // is element-granular, so one table can carry a row for itself and a row
    // per column or index somebody else contributed. A lone
    // `table_name PRIMARY KEY` would reject the second row for any table with
    // a contributed element.
    `CREATE TABLE IF NOT EXISTS "${SCHEMA_OWNERS_TABLE}" (
      "table_name" TEXT NOT NULL,
      "element_kind" TEXT NOT NULL DEFAULT 'table',
      "element_name" TEXT NOT NULL DEFAULT '',
      "owner_kind" TEXT NOT NULL,
      "owner_id" TEXT NOT NULL,
      "migrated_by" TEXT NOT NULL,
      "owner_version" TEXT,
      "schema_version" INTEGER,
      "state" TEXT NOT NULL,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL,
      PRIMARY KEY ("table_name", "element_kind", "element_name")
    )`,
    `CREATE TABLE IF NOT EXISTS "content_schema_events" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "op" TEXT NOT NULL,
      "table_name" TEXT NOT NULL,
      "sql" TEXT NOT NULL,
      "meta" TEXT,
      "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // The three schema-registry tables. Every collection, single and component
    // Nextly knows about is a row in one of these, so a database built from
    // this fallback without them cannot describe its own content: boot reads
    // the registry before it can load a dynamic table. They were listed as
    // known gaps rather than written, and their fifteen indexes were declared
    // on all three dialects and created on none. Their own statements, for the
    // reason the versions indexes above give: SQLite skips a CREATE TABLE
    // wholesale once the table exists, so an index folded into one is never
    // added to a database that predates it.
    `CREATE TABLE IF NOT EXISTS "dynamic_collections" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "labels" TEXT NOT NULL,
      "table_name" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "fields" TEXT NOT NULL,
      "timestamps" INTEGER NOT NULL DEFAULT 1,
      "status" INTEGER NOT NULL DEFAULT 0,
      "localized" INTEGER NOT NULL DEFAULT 0,
      "versions" TEXT,
      "revalidate" TEXT,
      "webhooks" TEXT,
      "admin" TEXT,
      "hooks" TEXT,
      "source" TEXT NOT NULL DEFAULT 'ui',
      "locked" INTEGER NOT NULL DEFAULT 0,
      "config_path" TEXT,
      "schema_hash" TEXT NOT NULL,
      "schema_version" INTEGER NOT NULL DEFAULT 1,
      "migration_status" TEXT NOT NULL DEFAULT 'pending',
      "last_migration_id" TEXT,
      "created_by" TEXT REFERENCES "users"("id"),
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "dynamic_collections_source_idx"
      ON "dynamic_collections" ("source")`,
    `CREATE INDEX IF NOT EXISTS "dynamic_collections_migration_status_idx"
      ON "dynamic_collections" ("migration_status")`,
    `CREATE INDEX IF NOT EXISTS "dynamic_collections_created_by_idx"
      ON "dynamic_collections" ("created_by")`,
    `CREATE INDEX IF NOT EXISTS "dynamic_collections_created_at_idx"
      ON "dynamic_collections" ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "dynamic_collections_updated_at_idx"
      ON "dynamic_collections" ("updated_at")`,
    `CREATE TABLE IF NOT EXISTS "dynamic_singles" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "label" TEXT NOT NULL,
      "table_name" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "fields" TEXT NOT NULL,
      "admin" TEXT,
      "source" TEXT NOT NULL DEFAULT 'ui',
      "locked" INTEGER NOT NULL DEFAULT 0,
      "status" INTEGER NOT NULL DEFAULT 0,
      "localized" INTEGER NOT NULL DEFAULT 0,
      "versions" TEXT,
      "revalidate" TEXT,
      "webhooks" TEXT,
      "config_path" TEXT,
      "schema_hash" TEXT NOT NULL,
      "schema_version" INTEGER NOT NULL DEFAULT 1,
      "migration_status" TEXT NOT NULL DEFAULT 'pending',
      "last_migration_id" TEXT,
      "created_by" TEXT,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "dynamic_singles_source_idx"
      ON "dynamic_singles" ("source")`,
    `CREATE INDEX IF NOT EXISTS "dynamic_singles_migration_status_idx"
      ON "dynamic_singles" ("migration_status")`,
    `CREATE INDEX IF NOT EXISTS "dynamic_singles_created_by_idx"
      ON "dynamic_singles" ("created_by")`,
    `CREATE INDEX IF NOT EXISTS "dynamic_singles_created_at_idx"
      ON "dynamic_singles" ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "dynamic_singles_updated_at_idx"
      ON "dynamic_singles" ("updated_at")`,
    `CREATE TABLE IF NOT EXISTS "${STORAGE_FORMAT.registryTable}" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "label" TEXT NOT NULL,
      "table_name" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "fields" TEXT NOT NULL,
      "admin" TEXT,
      "source" TEXT NOT NULL DEFAULT 'ui',
      "locked" INTEGER NOT NULL DEFAULT 0,
      "localized" INTEGER NOT NULL DEFAULT 0,
      "config_path" TEXT,
      "schema_hash" TEXT NOT NULL,
      "schema_version" INTEGER NOT NULL DEFAULT 1,
      "migration_status" TEXT NOT NULL DEFAULT 'pending',
      "last_migration_id" TEXT,
      "created_by" TEXT,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "${STORAGE_FORMAT.registryTable}_source_idx"
      ON "${STORAGE_FORMAT.registryTable}" ("source")`,
    `CREATE INDEX IF NOT EXISTS "${STORAGE_FORMAT.registryTable}_migration_status_idx"
      ON "${STORAGE_FORMAT.registryTable}" ("migration_status")`,
    `CREATE INDEX IF NOT EXISTS "${STORAGE_FORMAT.registryTable}_created_by_idx"
      ON "${STORAGE_FORMAT.registryTable}" ("created_by")`,
    `CREATE INDEX IF NOT EXISTS "${STORAGE_FORMAT.registryTable}_created_at_idx"
      ON "${STORAGE_FORMAT.registryTable}" ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "${STORAGE_FORMAT.registryTable}_updated_at_idx"
      ON "${STORAGE_FORMAT.registryTable}" ("updated_at")`,
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
    // The dashboard's pending-edit cards. Its columns are the WHERE clause of
    // `findPendingEditRows` followed by that read's own ordering; every index
    // above leads with "scope_kind", which that query never constrains, so
    // without this one both cards scan the whole version history.
    `CREATE INDEX IF NOT EXISTS "nextly_versions_pending_edits_idx"
      ON "nextly_versions" ("is_autosave", "status", "version_no", "scope_slug", "updated_at", "id")`,
    // "Last looked at" markers. Columns match schemas/version-views/sqlite.ts.
    `CREATE TABLE IF NOT EXISTS "nextly_version_views" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "user_id" TEXT NOT NULL,
      "scope_kind" TEXT NOT NULL,
      "scope_slug" TEXT NOT NULL,
      "entry_id" TEXT NOT NULL,
      "part" TEXT,
      "view_key" TEXT NOT NULL,
      "version_no" INTEGER NOT NULL,
      "previous_version_no" INTEGER,
      "viewed_at" INTEGER NOT NULL,
      "visit_started_at" INTEGER NOT NULL,
      "created_at" INTEGER NOT NULL
    )`,
    // Over "view_key" alone: the digest is what one marker per person,
    // document and part is enforced on.
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_version_views_key_uidx"
      ON "nextly_version_views" ("view_key")`,
    `CREATE INDEX IF NOT EXISTS "nextly_version_views_doc_idx"
      ON "nextly_version_views" ("scope_kind", "scope_slug", "entry_id")`,
    `CREATE INDEX IF NOT EXISTS "nextly_version_views_user_idx"
      ON "nextly_version_views" ("user_id")`,
    // The record of content events. Columns match
    // schemas/content-events/sqlite.ts.
    `CREATE TABLE IF NOT EXISTS "nextly_content_events" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "subject_kind" TEXT NOT NULL,
      "subject_slug" TEXT,
      "subject_id" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "ends_subject" INTEGER NOT NULL DEFAULT 0,
      "ended_by" TEXT,
      "actor_kind" TEXT NOT NULL,
      "actor_id" TEXT,
      "actor_principal_kind" TEXT,
      "actor_name" TEXT,
      "occurred_at" INTEGER NOT NULL,
      "from_state" TEXT,
      "to_state" TEXT,
      "note" TEXT,
      "version_no" INTEGER,
      "payload" TEXT,
      "definition_hash" TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS "nextly_content_events_subject_idx"
      ON "nextly_content_events" ("subject_kind", "subject_slug", "subject_id", "id")`,
    `CREATE INDEX IF NOT EXISTS "nextly_content_events_ends_idx"
      ON "nextly_content_events" ("ends_subject", "occurred_at")`,
    `CREATE INDEX IF NOT EXISTS "nextly_content_events_ended_by_idx"
      ON "nextly_content_events" ("ended_by")`,
    `CREATE TABLE IF NOT EXISTS "nextly_content_event_parts" (
      "event_id" TEXT NOT NULL,
      "part" TEXT NOT NULL,
      PRIMARY KEY ("event_id", "part")
    )`,
    // Recorded preview links. Columns match schemas/preview-links/sqlite.ts.
    `CREATE TABLE IF NOT EXISTS "nextly_preview_links" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "document_kind" TEXT NOT NULL,
      "document_slug" TEXT NOT NULL,
      "entry_id" TEXT,
      "locale" TEXT,
      "created_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "created_at" INTEGER NOT NULL,
      "expires_at" INTEGER NOT NULL,
      "generation" INTEGER NOT NULL,
      "revoked_at" INTEGER,
      "revoked_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
      "open_count" INTEGER NOT NULL DEFAULT 0,
      "last_opened_at" INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS "nextly_preview_links_document_idx"
      ON "nextly_preview_links" ("document_kind", "document_slug", "entry_id")`,
    `CREATE INDEX IF NOT EXISTS "nextly_preview_links_expires_idx"
      ON "nextly_preview_links" ("expires_at")`,
    `CREATE INDEX IF NOT EXISTS "nextly_preview_links_created_by_idx"
      ON "nextly_preview_links" ("created_by")`,
    // Content releases. Columns match schemas/releases/sqlite.ts.
    `CREATE TABLE IF NOT EXISTS "nextly_releases" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "scheduled_at" INTEGER,
      "timezone" TEXT,
      "state" TEXT NOT NULL,
      "published_at" INTEGER,
      "created_by" TEXT,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL,
      "revision" INTEGER NOT NULL DEFAULT 0,
      "kind" TEXT NOT NULL DEFAULT 'release'
    )`,
    `CREATE TABLE IF NOT EXISTS "nextly_release_members" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "release_id" TEXT NOT NULL,
      "scope_kind" TEXT NOT NULL,
      "scope_slug" TEXT NOT NULL,
      "entry_id" TEXT NOT NULL,
      "locale" TEXT,
      "action" TEXT NOT NULL,
      "member_key" TEXT NOT NULL,
      "single_slot" INTEGER,
      "applied_revision" INTEGER,
      "created_by" TEXT,
      "created_at" INTEGER NOT NULL
    )`,
    // Each index is its OWN statement, guarded with IF NOT EXISTS, for the
    // reason the versions indexes above are: SQLite skips a CREATE TABLE
    // wholesale once the table exists, so an index folded into it would never
    // appear on a database built by an earlier boot.
    `CREATE INDEX IF NOT EXISTS "nextly_releases_due_idx"
      ON "nextly_releases" ("state", "scheduled_at")`,
    // A release is placed in time by its scheduled instant, or by the instant
    // it went out once published; the calendar reads ranges of both.
    `CREATE INDEX IF NOT EXISTS "nextly_releases_scheduled_idx"
      ON "nextly_releases" ("scheduled_at")`,
    `CREATE INDEX IF NOT EXISTS "nextly_releases_published_idx"
      ON "nextly_releases" ("published_at")`,
    // Over "member_key" alone: "locale" is nullable and SQLite treats NULL as
    // distinct from NULL, so a composite index over the source columns would
    // permit any number of unlocalized members for one document in one release.
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_release_members_key_uidx"
      ON "nextly_release_members" ("member_key")`,
    // The one-member rule of a single release: a slot that is 1 for its
    // member and NULL for every other, unique per release.
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_release_members_single_uidx"
      ON "nextly_release_members" ("release_id", "single_slot")`,
    `CREATE INDEX IF NOT EXISTS "nextly_release_members_doc_idx"
      ON "nextly_release_members" ("scope_kind", "scope_slug", "entry_id", "locale")`,
    `CREATE INDEX IF NOT EXISTS "nextly_release_members_release_idx"
      ON "nextly_release_members" ("release_id")`,
    // Version pins. Columns match schemas/version-pins/sqlite.ts.
    `CREATE TABLE IF NOT EXISTS "nextly_version_pins" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "scope_kind" TEXT NOT NULL,
      "scope_slug" TEXT NOT NULL,
      "entry_id" TEXT NOT NULL,
      "holder" TEXT NOT NULL,
      "slot" TEXT NOT NULL,
      "version_no" INTEGER NOT NULL,
      "pin_key" TEXT NOT NULL,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL
    )`,
    // Over "pin_key" alone, for the reason "member_key" above is: the digest
    // is what one slot per document per holder is enforced on.
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_version_pins_key_uidx"
      ON "nextly_version_pins" ("pin_key")`,
    `CREATE INDEX IF NOT EXISTS "nextly_version_pins_doc_idx"
      ON "nextly_version_pins" ("scope_kind", "scope_slug", "entry_id")`,
    // Background jobs. Columns match schemas/jobs/sqlite.ts.
    `CREATE TABLE IF NOT EXISTS "nextly_jobs" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "slug" TEXT NOT NULL,
      "input" TEXT,
      "state" TEXT NOT NULL,
      "run_at" INTEGER,
      "run_as_user_id" TEXT,
      "dedupe_key" TEXT,
      "attempt_count" INTEGER NOT NULL DEFAULT 0,
      "next_attempt_at" INTEGER,
      "locked_by" TEXT,
      "locked_until" INTEGER,
      "last_error" TEXT,
      "created_at" INTEGER NOT NULL,
      "updated_at" INTEGER NOT NULL
    )`,
    // Separate statements for the reason the release indexes above are: SQLite
    // skips a CREATE TABLE wholesale once the table exists, so an index folded
    // into it would never appear on a database built by an earlier boot.
    `CREATE INDEX IF NOT EXISTS "nextly_jobs_due_idx"
      ON "nextly_jobs" ("state", "run_at")`,
    // The recent-jobs read sorts the whole table by `updated_at` before its
    // small limit applies. The due index above cannot serve that sort — its
    // leading column is `state` — so without this every monitoring request is
    // a full scan and sort that degrades with queue volume.
    `CREATE INDEX IF NOT EXISTS "nextly_jobs_recent_idx"
      ON "nextly_jobs" ("updated_at")`,
    // Nullable and unique: SQLite treats NULL as distinct from NULL, so jobs
    // that name no dedupe key are never deduplicated, while a job that names
    // one can be enqueued exactly once. That is what makes duplicate
    // suppression a constraint rather than a read-then-write two writers can
    // interleave with.
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_jobs_dedupe_idx"
      ON "nextly_jobs" ("dedupe_key")`,
    `CREATE TABLE IF NOT EXISTS "nextly_document_lock" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "scope_kind" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "entry_id" TEXT NOT NULL,
      "owner_id" TEXT NOT NULL,
      "claim_token" TEXT NOT NULL,
      "owner_label" TEXT,
      "acquired_at" INTEGER NOT NULL,
      "expires_at" INTEGER NOT NULL,
      "waiting_until" INTEGER
    )`,
    // Separate statements for the reason the ones above are: SQLite skips a
    // CREATE TABLE wholesale once the table exists, so an index folded into it
    // would never appear on a database built by an earlier boot.
    `CREATE INDEX IF NOT EXISTS "ndl_expires_at_idx"
      ON "nextly_document_lock" ("expires_at")`,
    `CREATE INDEX IF NOT EXISTS "ndl_scope_idx"
      ON "nextly_document_lock" ("scope_kind", "slug")`,
    // One reader's dashboard arrangement. Declared here and not only in the
    // Drizzle bundle, because this fallback is what builds the database when
    // `freshPushSchema` cannot run -- the non-TTY path -- and a table missing
    // from it is a table every read and write fails against, on exactly the
    // installs where nobody is watching the boot.
    // Keyed by (owner, key) so a plugin cannot hold two values for one
    // setting, and one plugin's settings can never be written under another's
    // name.
    `CREATE TABLE IF NOT EXISTS "nextly_plugin_settings" (
      "owner" TEXT NOT NULL,
      "key" TEXT NOT NULL,
      "value" TEXT NOT NULL,
      "is_secret" INTEGER NOT NULL DEFAULT 0,
      "updated_at" INTEGER NOT NULL,
      "updated_by" TEXT,
      PRIMARY KEY ("owner", "key")
    )`,
    `CREATE TABLE IF NOT EXISTS "nextly_one_time_secrets" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "owner" TEXT NOT NULL,
      "purpose" TEXT NOT NULL,
      "subject" TEXT NOT NULL,
      "subject_key" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "secret_hash" TEXT NOT NULL,
      "live_key" TEXT,
      "issue_seq" INTEGER,
      "data" TEXT,
      "expires_at" INTEGER NOT NULL,
      "spent_at" INTEGER,
      "voided_at" INTEGER,
      "wrong_tries" INTEGER NOT NULL DEFAULT 0,
      "max_wrong_tries" INTEGER,
      "created_at" INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_one_time_secrets_live_key_unique"
      ON "nextly_one_time_secrets" ("live_key")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_one_time_secrets_issue_unique"
      ON "nextly_one_time_secrets" ("subject_key", "purpose", "kind", "issue_seq")`,
    `CREATE INDEX IF NOT EXISTS "nextly_one_time_secrets_hash_idx"
      ON "nextly_one_time_secrets" ("secret_hash")`,
    `CREATE INDEX IF NOT EXISTS "nextly_one_time_secrets_subject_key_idx"
      ON "nextly_one_time_secrets" ("subject_key")`,
    `CREATE INDEX IF NOT EXISTS "nextly_one_time_secrets_expires_idx"
      ON "nextly_one_time_secrets" ("expires_at")`,
    // The database limit store's counts, used when a site selects it. An
    // integer of milliseconds for the expiry, as the Drizzle bundle declares.
    `CREATE TABLE IF NOT EXISTS "${LIMIT_STORE_TABLE}" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "value" TEXT,
      "expires_at" INTEGER NOT NULL,
      "generation" TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "nls_expires_at_idx"
      ON "${LIMIT_STORE_TABLE}" ("expires_at")`,
    `CREATE INDEX IF NOT EXISTS "nls_generation_idx"
      ON "${LIMIT_STORE_TABLE}" ("generation")`,
    // The two-factor challenges already answered, so an answer is accepted
    // once on every instance. An integer of milliseconds for the expiry, as
    // the Drizzle bundle declares.
    `CREATE TABLE IF NOT EXISTS "${SPENT_CHALLENGES_TABLE}" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "expires_at" INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "nsc_expires_at_idx"
      ON "${SPENT_CHALLENGES_TABLE}" ("expires_at")`,
    // Each person's own notices. Columns match schemas/notices/sqlite.ts; each
    // index is its own statement so a database built by an earlier boot still
    // gains it.
    `CREATE TABLE IF NOT EXISTS "${NOTICES_TABLE}" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "kind" TEXT NOT NULL,
      "subject_type" TEXT NOT NULL,
      "subject_id" TEXT NOT NULL,
      "occurrence" TEXT NOT NULL,
      "dedupe_key" TEXT NOT NULL,
      "data" TEXT,
      "created_at" INTEGER NOT NULL,
      "read_at" INTEGER
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "nextly_notices_dedupe_uidx"
      ON "${NOTICES_TABLE}" ("dedupe_key")`,
    `CREATE INDEX IF NOT EXISTS "nextly_notices_user_idx"
      ON "${NOTICES_TABLE}" ("user_id", "read_at", "created_at", "id")`,
    `CREATE INDEX IF NOT EXISTS "nextly_notices_inbox_idx"
      ON "${NOTICES_TABLE}" ("user_id", "created_at", "id")`,
    `CREATE INDEX IF NOT EXISTS "nextly_notices_subject_idx"
      ON "${NOTICES_TABLE}" ("subject_type", "subject_id")`,
    `CREATE INDEX IF NOT EXISTS "nextly_notices_created_idx"
      ON "${NOTICES_TABLE}" ("created_at")`,
    `CREATE TABLE IF NOT EXISTS "nextly_widget_layout" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "scope_kind" TEXT NOT NULL,
      "scope_id" TEXT NOT NULL,
      "layout" TEXT NOT NULL,
      "version" INTEGER NOT NULL DEFAULT 1,
      "updated_at" INTEGER NOT NULL
    )`,
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
      "principal_kind" TEXT,
      "principal_id" TEXT,
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
    `CREATE INDEX IF NOT EXISTS "email_deliveries_principal_idx"
      ON "email_deliveries" ("principal_kind", "principal_id")`,
  ];
}

/**
 * The bootstrap statements for one database, given the registry it actually
 * uses.
 *
 * The field-group registry has two spellings, and `chooseRegistryTable`
 * prefers the LEGACY one whenever it is present — so creating
 * `dynamic_components` beside a populated `dynamic_field_groups` does not add
 * a table, it makes every reader switch to an empty one and every migrated
 * component unreachable. Two rules follow, and they are different.
 *
 * **The registry's CREATE TABLE.** Emitted only for a database that may still
 * need one AND is not already using the migrated spelling. A replay over an
 * established database never gets it: a point-in-time probe cannot make that
 * statement safe, because a migration renaming the table between the probe and
 * the replay puts the empty legacy table back, and the exclusion that would
 * prevent that cannot be held here — its own lock table is one of the core
 * tables this bootstrap creates. An established database gets its registry
 * from the fresh path or from `SystemTableService`.
 *
 * **The registry's INDEXES.** Always emitted, retargeted to the registry this
 * database really uses. Dropping them would mean a migrated installation never
 * has its indexes reconciled — one created by the older fallback has none of
 * the five, and the rename carries that gap across. An index statement naming
 * a table a concurrent rename has moved fails harmlessly rather than
 * resurrecting anything.
 */
export function sqliteCoreStatementsFor(options: {
  /**
   * The registry table this database uses, resolved through the canonical
   * resolver so this and the readers cannot disagree about case folding or
   * preference order.
   */
  registryTable: string;
  /**
   * Whether this database may still have its registry TABLE created — true on
   * the fresh path, false for a replay over a database that already exists.
   */
  mayCreateRegistryTable: boolean;
}): string[] {
  const legacy = STORAGE_FORMAT.registryTable;
  const createsRegistry =
    options.mayCreateRegistryTable && options.registryTable === legacy;

  const statements: string[] = [];
  for (const statement of generateSqliteCoreTableStatements()) {
    if (statement.includes(`CREATE TABLE IF NOT EXISTS "${legacy}"`)) {
      if (createsRegistry) statements.push(statement);
      continue;
    }
    statements.push(
      statement.includes(`ON "${legacy}"`)
        ? statement.replace(`ON "${legacy}"`, `ON "${options.registryTable}"`)
        : statement
    );
  }
  return statements;
}
