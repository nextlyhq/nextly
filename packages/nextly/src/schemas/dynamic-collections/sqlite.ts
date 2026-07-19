/**
 * SQLite Schema for Dynamic Collections
 *
 * Defines the `dynamic_collections` table schema for SQLite databases
 * using Drizzle ORM. This schema stores metadata for both UI-created and
 * code-first collections with unified model fields for source tracking,
 * migration status, and versioning.
 *
 * @module schemas/dynamic-collections/sqlite
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   dynamicCollectionsSqlite,
 *   type DynamicCollectionSqlite,
 *   type DynamicCollectionInsertSqlite,
 * } from '@nextly/schemas/dynamic-collections/sqlite';
 *
 * // Insert a new collection
 * const newCollection = await db.insert(dynamicCollectionsSqlite).values({
 *   slug: 'posts',
 *   labels: { singular: 'Post', plural: 'Posts' },
 *   tableName: 'posts',
 *   fields: [...],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * });
 * ```
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import type { FieldConfig } from "@nextly/collections";

import { users } from "../users/sqlite";
import type { ResolvedVersionsConfig } from "../versions/types";

import type {
  CollectionLabels,
  CollectionAdminConfig,
  CollectionSource,
  MigrationStatus,
  StoredHookConfig,
} from "./types";

// ============================================================
// Dynamic Collections Table (SQLite)
// ============================================================

/**
 * SQLite schema for the `dynamic_collections` table.
 *
 * Stores metadata for all collections (UI-created, code-first, built-in)
 * with unified model fields for:
 * - Source tracking (code, ui, built-in)
 * - Migration status (synced, pending, generated, applied)
 * - Schema versioning and change detection
 *
 * @example
 * ```typescript
 * // Query all code-first collections
 * const codeCollections = await db
 *   .select()
 *   .from(dynamicCollectionsSqlite)
 *   .where(eq(dynamicCollectionsSqlite.source, 'code'));
 *
 * // Find collections needing migration
 * const pendingMigrations = await db
 *   .select()
 *   .from(dynamicCollectionsSqlite)
 *   .where(eq(dynamicCollectionsSqlite.migrationStatus, 'pending'));
 * ```
 */
export const dynamicCollectionsSqlite = sqliteTable(
  "dynamic_collections",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // --------------------------------------------------------
    // Collection Identity
    // --------------------------------------------------------

    /**
     * Unique slug identifier for the collection.
     * Used in URLs and API endpoints (e.g., "posts", "products").
     */
    slug: text("slug").unique().notNull(),

    /**
     * Display labels for the Admin UI.
     * Contains singular and plural forms (e.g., "Post" / "Posts").
     */
    labels: text("labels", { mode: "json" })
      .$type<CollectionLabels>()
      .notNull(),

    /**
     * Database table name for this collection.
     * Must be unique across all collections.
     */
    tableName: text("table_name").unique().notNull(),

    /** Optional description of the collection's purpose */
    description: text("description"),

    // --------------------------------------------------------
    // Schema Definition
    // --------------------------------------------------------

    /**
     * Field configurations defining the collection schema.
     * Array of FieldConfig objects (text, number, select, etc.).
     */
    fields: text("fields", { mode: "json" }).$type<FieldConfig[]>().notNull(),

    /**
     * Whether to auto-generate createdAt/updatedAt fields.
     * Defaults to true for new collections.
     */
    timestamps: integer("timestamps", { mode: "boolean" })
      .default(true)
      .notNull(),

    /**
     * Whether the collection's records carry a Draft/Published status column.
     * Default false; users opt in via the Schema Builder modal. See the
     * postgres schema for full semantics.
     */
    status: integer("status", { mode: "boolean" }).default(false).notNull(),
    /** Collection-level i18n master switch (mirrors `status`). */
    localized: integer("localized", { mode: "boolean" })
      .default(false)
      .notNull(),

    /**
     * Resolved content-versioning config, or null when unversioned. Stores the
     * normalized `ResolvedVersionsConfig` so every consumer reads one shape and
     * later stages read more fields without a re-migration. See postgres schema.
     */
    versions: text("versions", {
      mode: "json",
    }).$type<ResolvedVersionsConfig>(),

    /**
     * Admin UI configuration options.
     * Controls sidebar grouping, icon, columns, pagination, etc.
     */
    admin: text("admin", { mode: "json" }).$type<CollectionAdminConfig>(),

    /**
     * Pre-built hooks configured via the Admin UI.
     * Array of hook configurations with order for execution sequence.
     */
    hooks: text("hooks", { mode: "json" }).$type<StoredHookConfig[]>(),

    // --------------------------------------------------------
    // Unified Model Fields
    // --------------------------------------------------------

    /**
     * Where the collection was defined.
     * - 'code': defineCollection() in a config file
     * - 'ui': Visual Collection Builder
     * - 'built-in': System collections from Nextly core
     */
    source: text("source").$type<CollectionSource>().default("ui").notNull(),

    /**
     * If true, the collection cannot be modified via the Admin UI.
     * Code-first collections are locked by default.
     */
    locked: integer("locked", { mode: "boolean" }).default(false).notNull(),

    /**
     * Path to the config file (code-first collections only).
     * Used for syncing and displaying source location.
     * @example "src/collections/posts.ts"
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
     * Starts at 1 for new collections.
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
      .$type<MigrationStatus>()
      .default("pending")
      .notNull(),

    /**
     * Reference to the last applied migration ID.
     *
     * Holds the migration file slug (e.g.,
     * `0001_perpetual_captain_marvel`), not a UUID. Null for collections
     * that haven't been migrated yet.
     */
    lastMigrationId: text("last_migration_id"),

    // --------------------------------------------------------
    // Access Control
    // --------------------------------------------------------

    /**
     * Optional per-operation access rules. Consumed by
     * `CollectionAccessService`; stored as JSON because the rule shape
     * evolves independently of the migration cycle.
     */
    accessRules: text("access_rules", { mode: "json" }).$type<{
      create?: { type: string; allowedRoles?: string[] };
      read?: { type: string; allowedRoles?: string[] };
      update?: { type: string; allowedRoles?: string[] };
      delete?: { type: string; allowedRoles?: string[] };
    }>(),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /**
     * User ID of the creator (optional).
     *
     * FK to `users.id`; `text` to match the user identifier column.
     */
    createdBy: text("created_by").references(() => users.id),

    /** When the collection was created */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the collection was last updated */
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    // --------------------------------------------------------
    // Indexes for Query Performance
    // --------------------------------------------------------

    /** Index for filtering collections by source (code, ui, built-in) */
    index("dynamic_collections_source_idx").on(table.source),

    /** Index for finding collections needing migration */
    index("dynamic_collections_migration_status_idx").on(table.migrationStatus),

    /** Index for filtering by creator */
    index("dynamic_collections_created_by_idx").on(table.createdBy),

    /** Index for sorting by creation date */
    index("dynamic_collections_created_at_idx").on(table.createdAt),

    /** Index for sorting by last modified date */
    index("dynamic_collections_updated_at_idx").on(table.updatedAt),
  ]
);

// ============================================================
// Type Exports (Drizzle Inference)
// ============================================================

/**
 * SQLite-specific select type for dynamic collections.
 *
 * Inferred from the Drizzle schema, represents a full row
 * from the `dynamic_collections` table.
 *
 * @example
 * ```typescript
 * const collection: DynamicCollectionSqlite = await db
 *   .select()
 *   .from(dynamicCollectionsSqlite)
 *   .where(eq(dynamicCollectionsSqlite.slug, 'posts'))
 *   .limit(1)
 *   .then(rows => rows[0]);
 * ```
 */
export type DynamicCollectionSqlite =
  typeof dynamicCollectionsSqlite.$inferSelect;

/**
 * SQLite-specific insert type for dynamic collections.
 *
 * Inferred from the Drizzle schema, represents the shape
 * required for inserting a new row. Fields with defaults
 * (id, timestamps, schemaVersion, etc.) are optional.
 *
 * @example
 * ```typescript
 * const newCollection: DynamicCollectionInsertSqlite = {
 *   slug: 'posts',
 *   labels: { singular: 'Post', plural: 'Posts' },
 *   tableName: 'posts',
 *   fields: [{ type: 'text', name: 'title', required: true }],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * };
 *
 * await db.insert(dynamicCollectionsSqlite).values(newCollection);
 * ```
 */
export type DynamicCollectionInsertSqlite =
  typeof dynamicCollectionsSqlite.$inferInsert;
