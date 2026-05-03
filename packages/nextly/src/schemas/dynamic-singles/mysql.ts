/**
 * MySQL Schema for Dynamic Singles
 *
 * Defines the `dynamic_singles` table schema for MySQL databases
 * using Drizzle ORM. This schema stores metadata for both UI-created and
 * code-first Singles (Globals) with unified model fields for source tracking,
 * migration status, and versioning.
 *
 * Singles are single-document entities for storing site-wide configuration
 * such as site settings, navigation menus, footers, and homepage configurations.
 *
 * Key differences from Dynamic Collections:
 * - `label` instead of `labels` (singular only, no plural form needed)
 * - No `timestamps` column (Singles always have updatedAt)
 * - No `hooks` column (Singles use code-only hooks via defineSingle())
 * - `accessRules` for read/update only (no create/delete)
 *
 * @module schemas/dynamic-singles/mysql
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   dynamicSinglesMysql,
 *   type DynamicSingleMysql,
 *   type DynamicSingleInsertMysql,
 * } from '@nextly/schemas/dynamic-singles/mysql';
 *
 * // Insert a new Single
 * const newSingle = await db.insert(dynamicSinglesMysql).values({
 *   slug: 'site-settings',
 *   label: 'Site Settings',
 *   tableName: 'single_site_settings',
 *   fields: [...],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * });
 * ```
 */

import {
  mysqlTable,
  varchar,
  text,
  boolean,
  int,
  datetime,
  json,
  index,
} from "drizzle-orm/mysql-core";

import type { FieldConfig } from "../../collections/fields/types";
import type { SingleAdminOptions } from "../../singles/config/types";

import type {
  SingleSource,
  SingleMigrationStatus,
  SingleAccessRules,
} from "./types";

// ============================================================
// Dynamic Singles Table (MySQL)
// ============================================================

/**
 * MySQL schema for the `dynamic_singles` table.
 *
 * Stores metadata for all Singles (UI-created, code-first, built-in)
 * with unified model fields for:
 * - Source tracking (code, ui, built-in)
 * - Migration status (synced, pending, generated, applied)
 * - Schema versioning and change detection
 *
 * @example
 * ```typescript
 * // Query all code-first Singles
 * const codeSingles = await db
 *   .select()
 *   .from(dynamicSinglesMysql)
 *   .where(eq(dynamicSinglesMysql.source, 'code'));
 *
 * // Find Singles needing migration
 * const pendingMigrations = await db
 *   .select()
 *   .from(dynamicSinglesMysql)
 *   .where(eq(dynamicSinglesMysql.migrationStatus, 'pending'));
 * ```
 */
export const dynamicSinglesMysql = mysqlTable(
  "dynamic_singles",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Single Identity
    // --------------------------------------------------------

    /**
     * Unique slug identifier for the Single.
     * Used in URLs and API endpoints (e.g., "site-settings", "header").
     * Must be unique across all Singles AND Collections.
     */
    slug: varchar("slug", { length: 255 }).unique().notNull(),

    /**
     * Display label for the Admin UI.
     * Unlike Collections, Singles only need a singular label.
     *
     * @example 'Site Settings', 'Header Navigation', 'Footer'
     */
    label: varchar("label", { length: 255 }).notNull(),

    /**
     * Database table name for this Single.
     * Must be unique across all tables.
     * Convention: prefix with `single_` (e.g., 'single_site_settings').
     */
    tableName: varchar("table_name", { length: 255 }).unique().notNull(),

    /** Optional description of the Single's purpose */
    description: text("description"),

    // --------------------------------------------------------
    // Schema Definition
    // --------------------------------------------------------

    /**
     * Field configurations defining the Single's document structure.
     * Supports all 26 field types from the Collections system.
     */
    fields: json("fields").$type<FieldConfig[]>().notNull(),

    /**
     * Admin UI configuration options.
     * Controls sidebar grouping, icon, visibility, etc.
     */
    admin: json("admin").$type<SingleAdminOptions>(),

    /**
     * Access control rules for read/update operations.
     * Used for UI-created Singles. Code-first Singles use
     * function-based access in defineSingle().
     *
     * Note: Singles only support read and update operations.
     * Documents are auto-created and cannot be deleted.
     */
    accessRules: json("access_rules").$type<SingleAccessRules>(),

    // --------------------------------------------------------
    // Unified Model Fields
    // --------------------------------------------------------

    /**
     * Where the Single was defined.
     * - 'code': defineSingle() in a config file
     * - 'ui': Visual Single Builder
     * - 'built-in': System Singles from Nextly core
     */
    source: varchar("source", { length: 20 })
      .$type<SingleSource>()
      .default("ui")
      .notNull(),

    /**
     * If true, the Single cannot be modified via the Admin UI.
     * Code-first Singles are locked by default.
     */
    locked: boolean("locked").default(false).notNull(),

    /**
     * Whether the Single carries a Draft/Published status column.
     * Default false; users opt in via the Schema Builder modal.
     */
    status: boolean("status").default(false).notNull(),

    /**
     * Path to the config file (code-first Singles only).
     * Used for syncing and displaying source location.
     * @example "src/singles/site-settings.ts"
     */
    configPath: varchar("config_path", { length: 500 }),

    // --------------------------------------------------------
    // Migration & Versioning
    // --------------------------------------------------------

    /**
     * SHA-256 hash of the fields definition.
     * Used for change detection during sync operations.
     */
    schemaHash: varchar("schema_hash", { length: 64 }).notNull(),

    /**
     * Schema version number, incremented on each change.
     * Starts at 1 for new Singles.
     */
    schemaVersion: int("schema_version").default(1).notNull(),

    /**
     * Current migration status.
     * - 'synced': Schema matches database
     * - 'pending': Changes detected, migration needed
     * - 'generated': Migration file created
     * - 'applied': Migration applied to database
     */
    migrationStatus: varchar("migration_status", { length: 20 })
      .$type<SingleMigrationStatus>()
      .default("pending")
      .notNull(),

    /**
     * Reference to the last applied migration ID.
     * Null for Singles that haven't been migrated yet.
     */
    lastMigrationId: varchar("last_migration_id", { length: 36 }),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** User ID who created the Single (optional) */
    createdBy: varchar("created_by", { length: 36 }),

    /** When the Single was created */
    createdAt: datetime("created_at")
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the Single was last updated */
    updatedAt: datetime("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    // --------------------------------------------------------
    // Indexes for Query Performance
    // --------------------------------------------------------

    /** Index for filtering Singles by source (code, ui, built-in) */
    index("dynamic_singles_source_idx").on(table.source),

    /** Index for finding Singles needing migration */
    index("dynamic_singles_migration_status_idx").on(table.migrationStatus),

    /** Index for filtering by creator */
    index("dynamic_singles_created_by_idx").on(table.createdBy),

    /** Index for sorting by creation date */
    index("dynamic_singles_created_at_idx").on(table.createdAt),

    /** Index for sorting by last modified date */
    index("dynamic_singles_updated_at_idx").on(table.updatedAt),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

/**
 * MySQL-specific select type for dynamic Singles.
 *
 * Inferred from the Drizzle schema, represents a full row
 * from the `dynamic_singles` table.
 *
 * @example
 * ```typescript
 * const single: DynamicSingleMysql = await db
 *   .select()
 *   .from(dynamicSinglesMysql)
 *   .where(eq(dynamicSinglesMysql.slug, 'site-settings'))
 *   .limit(1)
 *   .then(rows => rows[0]);
 * ```
 */
export type DynamicSingleMysql = typeof dynamicSinglesMysql.$inferSelect;

/**
 * MySQL-specific insert type for dynamic Singles.
 *
 * Inferred from the Drizzle schema, represents the shape
 * required for inserting a new row. Fields with defaults
 * (id, timestamps, schemaVersion, etc.) are optional.
 *
 * @example
 * ```typescript
 * const newSingle: DynamicSingleInsertMysql = {
 *   slug: 'site-settings',
 *   label: 'Site Settings',
 *   tableName: 'single_site_settings',
 *   fields: [{ type: 'text', name: 'siteName', required: true }],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * };
 *
 * await db.insert(dynamicSinglesMysql).values(newSingle);
 * ```
 */
export type DynamicSingleInsertMysql = typeof dynamicSinglesMysql.$inferInsert;
