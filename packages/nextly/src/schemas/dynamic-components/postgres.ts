/**
 * PostgreSQL Schema for Dynamic Components
 *
 * Defines the `dynamic_components` table schema for PostgreSQL databases
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
 * @module schemas/dynamic-components/postgres
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   dynamicComponentsPg,
 *   type DynamicComponentPg,
 *   type DynamicComponentInsertPg,
 * } from '@nextly/schemas/dynamic-components/postgres';
 *
 * // Insert a new Component
 * const newComponent = await db.insert(dynamicComponentsPg).values({
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
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

import type { FieldConfig } from "../../collections/fields/types";
import type { ComponentAdminOptions } from "../../components/config/types";

import type { ComponentSource, ComponentMigrationStatus } from "./types";

// ============================================================
// Dynamic Components Table (PostgreSQL)
// ============================================================

/**
 * PostgreSQL schema for the `dynamic_components` table.
 *
 * Stores metadata for all Components (UI-created and code-first)
 * with unified model fields for:
 * - Source tracking (code, ui)
 * - Migration status (synced, pending, generated, applied)
 * - Schema versioning and change detection
 *
 * @example
 * ```typescript
 * // Query all code-first Components
 * const codeComponents = await db
 *   .select()
 *   .from(dynamicComponentsPg)
 *   .where(eq(dynamicComponentsPg.source, 'code'));
 *
 * // Find Components needing migration
 * const pendingMigrations = await db
 *   .select()
 *   .from(dynamicComponentsPg)
 *   .where(eq(dynamicComponentsPg.migrationStatus, 'pending'));
 * ```
 */
export const dynamicComponentsPg = pgTable(
  "dynamic_components",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: uuid("id").primaryKey().defaultRandom(),

    // --------------------------------------------------------
    // Component Identity
    // --------------------------------------------------------

    /**
     * Unique slug identifier for the Component.
     * Used in component field references and API operations.
     * Must be unique across all Components, Collections, AND Singles.
     */
    slug: varchar("slug", { length: 255 }).unique().notNull(),

    /**
     * Display label for the Admin UI.
     * Components only need a singular label.
     *
     * @example 'SEO Metadata', 'Hero Section', 'Call To Action'
     */
    label: varchar("label", { length: 255 }).notNull(),

    /**
     * Database table name for this Component's data.
     * Must be unique across all tables.
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
    fields: jsonb("fields").$type<FieldConfig[]>().notNull(),

    /**
     * Admin UI configuration options.
     * Controls category grouping, icon, visibility, etc.
     */
    admin: jsonb("admin").$type<ComponentAdminOptions>(),

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
     * Used for syncing and displaying source location.
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
    schemaVersion: integer("schema_version").default(1).notNull(),

    /**
     * Current migration status.
     * - 'synced': Schema matches database
     * - 'pending': Changes detected, migration needed
     * - 'generated': Migration file created
     * - 'applied': Migration applied to database
     */
    migrationStatus: varchar("migration_status", { length: 20 })
      .$type<ComponentMigrationStatus>()
      .default("pending")
      .notNull(),

    /**
     * Reference to the last applied migration ID.
     * Null for Components that haven't been migrated yet.
     */
    lastMigrationId: uuid("last_migration_id"),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** User ID who created the Component (optional) */
    createdBy: uuid("created_by"),

    /** When the Component was created */
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),

    /** When the Component was last updated */
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
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
 * PostgreSQL-specific select type for dynamic Components.
 *
 * Inferred from the Drizzle schema, represents a full row
 * from the `dynamic_components` table.
 */
export type DynamicComponentPg = typeof dynamicComponentsPg.$inferSelect;

/**
 * PostgreSQL-specific insert type for dynamic Components.
 *
 * Inferred from the Drizzle schema, represents the shape
 * required for inserting a new row. Fields with defaults
 * (id, timestamps, schemaVersion, etc.) are optional.
 */
export type DynamicComponentInsertPg = typeof dynamicComponentsPg.$inferInsert;
