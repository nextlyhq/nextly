/**
 * SQLite Schema for Dynamic Singles
 *
 * Defines the `dynamic_singles` table schema for SQLite databases
 * using Drizzle ORM. This schema stores metadata for both UI-created and
 * code-first Singles with unified model fields for source tracking,
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
 * @module schemas/dynamic-singles/sqlite
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   dynamicSinglesSqlite,
 *   type DynamicSingleSqlite,
 *   type DynamicSingleInsertSqlite,
 * } from '@nextly/schemas/dynamic-singles/sqlite';
 *
 * // Insert a new Single
 * const newSingle = await db.insert(dynamicSinglesSqlite).values({
 *   slug: 'site-settings',
 *   label: 'Site Settings',
 *   tableName: 'single_site_settings',
 *   fields: [...],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * });
 * ```
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import type { FieldConfig } from "../../collections/fields/types";
import type { SingleAdminOptions } from "../../singles/config/types";

import type {
  SingleSource,
  SingleMigrationStatus,
  SingleAccessRules,
} from "./types";

// ============================================================
// Dynamic Singles Table (SQLite)
// ============================================================

/**
 * SQLite schema for the `dynamic_singles` table.
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
 *   .from(dynamicSinglesSqlite)
 *   .where(eq(dynamicSinglesSqlite.source, 'code'));
 *
 * // Find Singles needing migration
 * const pendingMigrations = await db
 *   .select()
 *   .from(dynamicSinglesSqlite)
 *   .where(eq(dynamicSinglesSqlite.migrationStatus, 'pending'));
 * ```
 */
export const dynamicSinglesSqlite = sqliteTable(
  "dynamic_singles",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: text("id")
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
    slug: text("slug").unique().notNull(),

    /**
     * Display label for the Admin UI.
     * Unlike Collections, Singles only need a singular label.
     *
     * @example 'Site Settings', 'Header Navigation', 'Footer'
     */
    label: text("label").notNull(),

    /**
     * Database table name for this Single.
     * Must be unique across all tables.
     * Convention: prefix with `single_` (e.g., 'single_site_settings').
     */
    tableName: text("table_name").unique().notNull(),

    /** Optional description of the Single's purpose */
    description: text("description"),

    // --------------------------------------------------------
    // Schema Definition
    // --------------------------------------------------------

    /**
     * Field configurations defining the Single's document structure.
     * Supports all 26 field types from the Collections system.
     */
    fields: text("fields", { mode: "json" }).$type<FieldConfig[]>().notNull(),

    /**
     * Admin UI configuration options.
     * Controls sidebar grouping, icon, visibility, etc.
     */
    admin: text("admin", { mode: "json" }).$type<SingleAdminOptions>(),

    /**
     * Access control rules for read/update operations.
     * Used for UI-created Singles. Code-first Singles use
     * function-based access in defineSingle().
     *
     * Note: Singles only support read and update operations.
     * Documents are auto-created and cannot be deleted.
     */
    accessRules: text("access_rules", {
      mode: "json",
    }).$type<SingleAccessRules>(),

    // --------------------------------------------------------
    // Unified Model Fields
    // --------------------------------------------------------

    /**
     * Where the Single was defined.
     * - 'code': defineSingle() in a config file
     * - 'ui': Visual Single Builder
     * - 'built-in': System Singles from Nextly core
     */
    source: text("source").$type<SingleSource>().default("ui").notNull(),

    /**
     * If true, the Single cannot be modified via the Admin UI.
     * Code-first Singles are locked by default.
     */
    locked: integer("locked", { mode: "boolean" }).default(false).notNull(),

    /**
     * Whether the Single carries a Draft/Published status column.
     * Default false; users opt in via the Schema Builder modal.
     */
    status: integer("status", { mode: "boolean" }).default(false).notNull(),

    /**
     * Path to the config file (code-first Singles only).
     * Used for syncing and displaying source location.
     * @example "src/singles/site-settings.ts"
     */
    configPath: text("config_path"),

    // --------------------------------------------------------
    // Migration & Versioning
    // --------------------------------------------------------

    /**
     * SHA-256 hash of the fields definition.
     * Used for change detection during sync operations.
     */
    schemaHash: text("schema_hash").notNull(),

    /**
     * Schema version number, incremented on each change.
     * Starts at 1 for new Singles.
     */
    schemaVersion: integer("schema_version").default(1).notNull(),

    /**
     * Current migration status.
     * - 'synced': Schema matches database
     * - 'pending': Changes detected, migration needed
     * - 'generated': Migration file created
     * - 'applied': Migration applied to database
     */
    migrationStatus: text("migration_status")
      .$type<SingleMigrationStatus>()
      .default("pending")
      .notNull(),

    /**
     * Reference to the last applied migration ID.
     * Null for Singles that haven't been migrated yet.
     */
    lastMigrationId: text("last_migration_id"),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** User ID who created the Single (optional) */
    createdBy: text("created_by"),

    /** When the Single was created */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the Single was last updated */
    updatedAt: integer("updated_at", { mode: "timestamp" })
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
 * SQLite-specific select type for dynamic Singles.
 *
 * Inferred from the Drizzle schema, represents a full row
 * from the `dynamic_singles` table.
 *
 * @example
 * ```typescript
 * const single: DynamicSingleSqlite = await db
 *   .select()
 *   .from(dynamicSinglesSqlite)
 *   .where(eq(dynamicSinglesSqlite.slug, 'site-settings'))
 *   .limit(1)
 *   .then(rows => rows[0]);
 * ```
 */
export type DynamicSingleSqlite = typeof dynamicSinglesSqlite.$inferSelect;

/**
 * SQLite-specific insert type for dynamic Singles.
 *
 * Inferred from the Drizzle schema, represents the shape
 * required for inserting a new row. Fields with defaults
 * (id, timestamps, schemaVersion, etc.) are optional.
 *
 * @example
 * ```typescript
 * const newSingle: DynamicSingleInsertSqlite = {
 *   slug: 'site-settings',
 *   label: 'Site Settings',
 *   tableName: 'single_site_settings',
 *   fields: [{ type: 'text', name: 'siteName', required: true }],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * };
 *
 * await db.insert(dynamicSinglesSqlite).values(newSingle);
 * ```
 */
export type DynamicSingleInsertSqlite =
  typeof dynamicSinglesSqlite.$inferInsert;
