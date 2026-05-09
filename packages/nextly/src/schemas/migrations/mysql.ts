/**
 * MySQL Schema for Migration Tracking (F11)
 *
 * Defines the `nextly_migrations` table for MySQL using Drizzle ORM.
 * One row per `.sql` migration file applied via `nextly migrate`.
 *
 * NOTE: distinct from `nextly_migration_journal` (F8 PR 5) which logs
 * runtime HMR/UI applies. See plans/specs/F11-migration-files-cli-design.md
 * §3 for the two-table separation.
 *
 * @module schemas/migrations/mysql
 * @since 1.0.0
 */

import { sql } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  char,
  int,
  datetime,
  text,
  json,
  index,
  check,
} from "drizzle-orm/mysql-core";

import type { MigrationRecordStatus } from "../dynamic-collections/types";

// ============================================================
// Nextly Migrations Table (MySQL) — F11 schema
// ============================================================

/**
 * MySQL `nextly_migrations` table.
 *
 * Mirrors the PG schema with dialect-appropriate types:
 * - `uuid` → `varchar(36)` with client-side `crypto.randomUUID()`.
 * - `timestamptz` → `datetime` (MySQL stores in DB session timezone;
 *   the app layer is responsible for UTC normalization).
 * - `jsonb` → `json` (MySQL 5.7+ native JSON column).
 *
 * MySQL 8.0.16+ supports CHECK constraints (per F17 minimum 8.0+).
 */
export const nextlyMigrationsMysql = mysqlTable(
  "nextly_migrations",
  {
    /** UUID v4, generated client-side for cross-dialect parity. */
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    /**
     * Migration filename (without directory). Unique.
     *
     * @example "20260429_154500_123_add_excerpt.sql"
     */
    filename: varchar("filename", { length: 512 }).notNull().unique(),

    /** SHA-256 of the .sql file content. 64 hex chars. */
    sha256: char("sha256", { length: 64 }).notNull(),

    /**
     * When the migration was applied. Stored as DATETIME (UTC by app
     * convention; MySQL has no native timestamptz).
     */
    appliedAt: datetime("applied_at")
      .notNull()
      .$defaultFn(() => new Date()),

    /** Resolved CLI actor (NEXTLY_APPLIED_BY / GITHUB_ACTOR / USER / host). */
    appliedBy: varchar("applied_by", { length: 255 }),

    /** Wall-clock apply duration in milliseconds. */
    durationMs: int("duration_ms"),

    /**
     * Apply outcome. CHECK constraint enforces two-state lifecycle
     * on MySQL 8.0.16+.
     */
    status: varchar("status", { length: 20 })
      .notNull()
      .$type<MigrationRecordStatus>(),

    /**
     * Structured error JSON on failure. Shape:
     * `{ sqlState?: string; statement?: string; message: string }`.
     */
    errorJson: json("error_json"),

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

export type NextlyMigrationMysql = typeof nextlyMigrationsMysql.$inferSelect;
export type NextlyMigrationInsertMysql =
  typeof nextlyMigrationsMysql.$inferInsert;
