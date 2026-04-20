/**
 * MySQL Schema for Dynamic Components
 *
 * Defines the `dynamic_components` table schema for MySQL databases
 * using Drizzle ORM. This schema stores metadata for both UI-created and
 * code-first Components with unified model fields for source tracking,
 * migration status, and versioning.
 *
 * Components are shared, reusable field group templates that can be embedded
 * in Collections and Singles via the `component` field type.
 *
 * Key differences from Dynamic Singles:
 * - No `accessRules` column (Components are templates, not documents)
 * - Table name convention: `comp_` prefix (e.g., 'comp_seo')
 * - `admin.category` for sidebar grouping
 *
 * @module schemas/dynamic-components/mysql
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   dynamicComponentsMysql,
 *   type DynamicComponentMysql,
 *   type DynamicComponentInsertMysql,
 * } from '@nextly/schemas/dynamic-components/mysql';
 *
 * // Insert a new Component
 * const newComponent = await db.insert(dynamicComponentsMysql).values({
 *   slug: 'seo',
 *   label: 'SEO Metadata',
 *   tableName: 'comp_seo',
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
import type { ComponentAdminOptions } from "../../components/config/types";

import type { ComponentSource, ComponentMigrationStatus } from "./types";

// ============================================================
// Dynamic Components Table (MySQL)
// ============================================================

/**
 * MySQL schema for the `dynamic_components` table.
 *
 * Stores metadata for all Components (UI-created and code-first)
 * with unified model fields for:
 * - Source tracking (code, ui)
 * - Migration status (synced, pending, generated, applied)
 * - Schema versioning and change detection
 */
export const dynamicComponentsMysql = mysqlTable(
  "dynamic_components",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Component Identity
    // --------------------------------------------------------

    /**
     * Unique slug identifier for the Component.
     * Must be unique across all Components, Collections, AND Singles.
     */
    slug: varchar("slug", { length: 255 }).unique().notNull(),

    /**
     * Display label for the Admin UI.
     * Components only need a singular label.
     */
    label: varchar("label", { length: 255 }).notNull(),

    /**
     * Database table name for this Component's data.
     * Convention: prefix with `comp_` (e.g., 'comp_seo').
     */
    tableName: varchar("table_name", { length: 255 }).unique().notNull(),

    /** Optional description of the Component's purpose */
    description: text("description"),

    // --------------------------------------------------------
    // Schema Definition
    // --------------------------------------------------------

    /**
     * Field configurations defining the Component's structure.
     * Supports all field types including nested component fields.
     */
    fields: json("fields").$type<FieldConfig[]>().notNull(),

    /**
     * Admin UI configuration options.
     * Controls category grouping, icon, visibility, etc.
     */
    admin: json("admin").$type<ComponentAdminOptions>(),

    // --------------------------------------------------------
    // Unified Model Fields
    // --------------------------------------------------------

    /**
     * Where the Component was defined.
     * - 'code': defineComponent() in a config file
     * - 'ui': Visual Component Builder
     */
    source: varchar("source", { length: 20 })
      .$type<ComponentSource>()
      .default("ui")
      .notNull(),

    /**
     * If true, the Component cannot be modified via the Admin UI.
     * Code-first Components are locked by default.
     */
    locked: boolean("locked").default(false).notNull(),

    /**
     * Path to the config file (code-first Components only).
     * @example "src/components/seo.ts"
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
     * Starts at 1 for new Components.
     */
    schemaVersion: int("schema_version").default(1).notNull(),

    /**
     * Current migration status.
     */
    migrationStatus: varchar("migration_status", { length: 20 })
      .$type<ComponentMigrationStatus>()
      .default("pending")
      .notNull(),

    /**
     * Reference to the last applied migration ID.
     */
    lastMigrationId: varchar("last_migration_id", { length: 36 }),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** User ID who created the Component (optional) */
    createdBy: varchar("created_by", { length: 36 }),

    /** When the Component was created */
    createdAt: datetime("created_at")
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the Component was last updated */
    updatedAt: datetime("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    // --------------------------------------------------------
    // Indexes for Query Performance
    // --------------------------------------------------------

    /** Index for filtering Components by source (code, ui) */
    index("dynamic_components_source_idx").on(table.source),

    /** Index for finding Components needing migration */
    index("dynamic_components_migration_status_idx").on(table.migrationStatus),

    /** Index for filtering by creator */
    index("dynamic_components_created_by_idx").on(table.createdBy),

    /** Index for sorting by creation date */
    index("dynamic_components_created_at_idx").on(table.createdAt),

    /** Index for sorting by last modified date */
    index("dynamic_components_updated_at_idx").on(table.updatedAt),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

/**
 * MySQL-specific select type for dynamic Components.
 */
export type DynamicComponentMysql = typeof dynamicComponentsMysql.$inferSelect;

/**
 * MySQL-specific insert type for dynamic Components.
 */
export type DynamicComponentInsertMysql =
  typeof dynamicComponentsMysql.$inferInsert;
