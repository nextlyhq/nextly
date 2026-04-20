/**
 * MySQL Schema for Migration Tracking
 *
 * Defines the `nextly_migrations` table schema for MySQL databases
 * using Drizzle ORM. This table tracks all applied migrations for
 * collection schema changes, enabling rollback support and migration
 * status monitoring.
 *
 * @module schemas/migrations/mysql
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   nextlyMigrationsMysql,
 *   type NextlyMigrationMysql,
 *   type NextlyMigrationInsertMysql,
 * } from '@nextly/schemas/migrations/mysql';
 *
 * // Record a new migration
 * await db.insert(nextlyMigrationsMysql).values({
 *   name: '20250119_120000_create_posts',
 *   batch: 1,
 *   checksum: 'sha256-abc123...',
 * });
 *
 * // Query applied migrations
 * const applied = await db
 *   .select()
 *   .from(nextlyMigrationsMysql)
 *   .where(eq(nextlyMigrationsMysql.status, 'applied'));
 * ```
 */

import {
  mysqlTable,
  varchar,
  int,
  datetime,
  text,
  index,
} from "drizzle-orm/mysql-core";

import type { MigrationRecordStatus } from "../dynamic-collections/types";

// ============================================================
// Nextly Migrations Table (MySQL)
// ============================================================

/**
 * MySQL schema for the `nextly_migrations` table.
 *
 * Tracks all database migrations for collection schemas, including:
 * - Migration identification (name, batch)
 * - Integrity verification (checksum)
 * - Execution status (pending, applied, failed)
 * - Error handling (errorMessage for failed migrations)
 *
 * @example
 * ```typescript
 * // Get all migrations in a batch
 * const batch1 = await db
 *   .select()
 *   .from(nextlyMigrationsMysql)
 *   .where(eq(nextlyMigrationsMysql.batch, 1));
 *
 * // Find failed migrations
 * const failed = await db
 *   .select()
 *   .from(nextlyMigrationsMysql)
 *   .where(eq(nextlyMigrationsMysql.status, 'failed'));
 *
 * // Get latest migration
 * const latest = await db
 *   .select()
 *   .from(nextlyMigrationsMysql)
 *   .orderBy(desc(nextlyMigrationsMysql.executedAt))
 *   .limit(1);
 * ```
 */
export const nextlyMigrationsMysql = mysqlTable(
  "nextly_migrations",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Migration Identity
    // --------------------------------------------------------

    /**
     * Unique migration name following the pattern:
     * `YYYYMMDD_HHMMSS_description`
     * @example "20250119_120000_create_posts"
     */
    name: varchar("name", { length: 255 }).unique().notNull(),

    /**
     * Batch number for grouping migrations.
     * Migrations in the same batch were applied together in a single run.
     * Used for rollback operations (rollback by batch).
     */
    batch: int("batch").notNull(),

    // --------------------------------------------------------
    // Integrity & Status
    // --------------------------------------------------------

    /**
     * SHA-256 checksum of the migration file content.
     * Used to detect if a migration file was modified after creation.
     * Should be 64 characters (hex-encoded SHA-256).
     */
    checksum: varchar("checksum", { length: 64 }).notNull(),

    /**
     * Current status of the migration.
     * - 'pending': Migration queued but not yet executed
     * - 'applied': Migration successfully applied
     * - 'failed': Migration failed during execution
     */
    status: varchar("status", { length: 20 })
      .$type<MigrationRecordStatus>()
      .default("pending")
      .notNull(),

    /**
     * Error message if the migration failed.
     * Only populated when status is 'failed'.
     * Contains the error message or stack trace for debugging.
     */
    errorMessage: text("error_message"),

    // --------------------------------------------------------
    // Timestamps
    // --------------------------------------------------------

    /**
     * When the migration was executed.
     * Set to current timestamp when the migration record is created.
     */
    executedAt: datetime("executed_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    // --------------------------------------------------------
    // Indexes for Query Performance
    // --------------------------------------------------------

    /** Index for filtering migrations by batch number */
    index("nextly_migrations_batch_idx").on(table.batch),

    /** Index for filtering migrations by status */
    index("nextly_migrations_status_idx").on(table.status),

    /** Index for sorting by execution time */
    index("nextly_migrations_executed_at_idx").on(table.executedAt),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

/**
 * MySQL-specific select type for migration records.
 *
 * Inferred from the Drizzle schema, represents a full row
 * from the `nextly_migrations` table.
 *
 * @example
 * ```typescript
 * const migration: NextlyMigrationMysql = await db
 *   .select()
 *   .from(nextlyMigrationsMysql)
 *   .where(eq(nextlyMigrationsMysql.name, '20250119_120000_create_posts'))
 *   .limit(1)
 *   .then(rows => rows[0]);
 * ```
 */
export type NextlyMigrationMysql = typeof nextlyMigrationsMysql.$inferSelect;

/**
 * MySQL-specific insert type for migration records.
 *
 * Inferred from the Drizzle schema, represents the shape
 * required for inserting a new row. Fields with defaults
 * (id, status, executedAt) are optional.
 *
 * @example
 * ```typescript
 * const newMigration: NextlyMigrationInsertMysql = {
 *   name: '20250119_120000_create_posts',
 *   batch: 1,
 *   checksum: 'sha256-abc123...',
 * };
 *
 * await db.insert(nextlyMigrationsMysql).values(newMigration);
 * ```
 */
export type NextlyMigrationInsertMysql =
  typeof nextlyMigrationsMysql.$inferInsert;
