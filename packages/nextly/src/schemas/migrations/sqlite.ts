/**
 * SQLite Schema for Migration Tracking (F11)
 *
 * Defines the `nextly_migrations` table for SQLite using Drizzle ORM.
 * One row per `.sql` migration file applied via `nextly migrate`.
 *
 * NOTE: distinct from `nextly_migration_journal` (F8 PR 5) which logs
 * runtime HMR/UI applies. See plans/specs/F11-migration-files-cli-design.md
 * §3 for the two-table separation.
 *
 * @module schemas/migrations/sqlite
 * @since 1.0.0
 */

import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  check,
} from "drizzle-orm/sqlite-core";

import type { MigrationRecordStatus } from "../dynamic-collections/types";

// ============================================================
// Nextly Migrations Table (SQLite) — F11 schema
// ============================================================

/**
 * SQLite `nextly_migrations` table.
 *
 * Mirrors the PG schema with dialect-appropriate types:
 * - `uuid` → `text` with client-side `crypto.randomUUID()`.
 * - `timestamptz` → `integer` (Unix epoch ms; SQLite has no native
 *   timestamp; we store ms-since-epoch for sub-second precision).
 * - `jsonb` → `text` (JSON-encoded; readers JSON.parse on access).
 *
 * SQLite supports CHECK constraints on every supported version
 * (3.38+ per F17), so the two-state lifecycle is enforced at the DB.
 */
export const nextlyMigrationsSqlite = sqliteTable(
  "nextly_migrations",
  {
    /** UUID v4, generated client-side. */
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * Migration filename (without directory). Unique.
     *
     * @example "20260429_154500_123_add_excerpt.sql"
     */
    filename: text("filename").notNull().unique(),

    /** SHA-256 of the .sql file content. 64 hex chars. */
    sha256: text("sha256").notNull(),

    /**
     * When the migration was applied. Stored as INTEGER (ms-since-epoch)
     * for sub-second precision and easy ordering.
     */
    appliedAt: integer("applied_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** Resolved CLI actor. */
    appliedBy: text("applied_by"),

    /** Wall-clock apply duration in milliseconds. */
    durationMs: integer("duration_ms"),

    /**
     * Apply outcome. CHECK constraint enforces two-state lifecycle.
     */
    status: text("status").notNull().$type<MigrationRecordStatus>(),

    /**
     * Structured error JSON on failure (stored as TEXT; JSON.parse
     * on read). Shape:
     * `{ sqlState?: string; statement?: string; message: string }`.
     */
    errorJson: text("error_json"),

    /** Reserved for v2 corrective-rollback feature. Always NULL in v1. */
    rollbackSql: text("rollback_sql"),
  },
  table => [
    index("nextly_migrations_applied_at_idx").on(table.appliedAt),
    check(
      "nextly_migrations_status_check",
      sql`${table.status} IN ('applied', 'failed')`
    ),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

export type NextlyMigrationSqlite = typeof nextlyMigrationsSqlite.$inferSelect;
export type NextlyMigrationInsertSqlite =
  typeof nextlyMigrationsSqlite.$inferInsert;
