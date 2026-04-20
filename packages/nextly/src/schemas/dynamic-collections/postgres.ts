/**
 * PostgreSQL Schema for Dynamic Collections
 *
 * Defines the `dynamic_collections` table schema for PostgreSQL databases
 * using Drizzle ORM. This schema stores metadata for both UI-created and
 * code-first collections with unified model fields for source tracking,
 * migration status, and versioning.
 *
 * @module schemas/dynamic-collections/postgres
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   dynamicCollectionsPg,
 *   type DynamicCollectionPg,
 *   type DynamicCollectionInsertPg,
 * } from '@nextly/schemas/dynamic-collections/postgres';
 *
 * // Insert a new collection
 * const newCollection = await db.insert(dynamicCollectionsPg).values({
 *   slug: 'posts',
 *   labels: { singular: 'Post', plural: 'Posts' },
 *   tableName: 'posts',
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
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { FieldConfig } from "@nextly/collections";

import type {
  CollectionLabels,
  CollectionAdminConfig,
  CollectionSource,
  MigrationStatus,
  StoredHookConfig,
} from "./types";

// ============================================================
// Dynamic Collections Table (PostgreSQL)
// ============================================================

/**
 * PostgreSQL schema for the `dynamic_collections` table.
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
 *   .from(dynamicCollectionsPg)
 *   .where(eq(dynamicCollectionsPg.source, 'code'));
 *
 * // Find collections needing migration
 * const pendingMigrations = await db
 *   .select()
 *   .from(dynamicCollectionsPg)
 *   .where(eq(dynamicCollectionsPg.migrationStatus, 'pending'));
 * ```
 */
export const dynamicCollectionsPg = pgTable(
  "dynamic_collections",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /** Unique identifier (UUID v4, auto-generated) */
    id: uuid("id").primaryKey().defaultRandom(),

    // --------------------------------------------------------
    // Collection Identity
    // --------------------------------------------------------

    /**
     * Unique slug identifier for the collection.
     * Used in URLs and API endpoints (e.g., "posts", "products").
     */
    slug: varchar("slug", { length: 255 }).unique().notNull(),

    /**
     * Display labels for the Admin UI.
     * Contains singular and plural forms (e.g., "Post" / "Posts").
     */
    labels: jsonb("labels").$type<CollectionLabels>().notNull(),

    /**
     * Database table name for this collection.
     * Must be unique across all collections.
     */
    tableName: varchar("table_name", { length: 255 }).unique().notNull(),

    /** Optional description of the collection's purpose */
    description: text("description"),

    // --------------------------------------------------------
    // Schema Definition
    // --------------------------------------------------------

    /**
     * Field configurations defining the collection schema.
     * Array of FieldConfig objects (text, number, select, etc.).
     */
    fields: jsonb("fields").$type<FieldConfig[]>().notNull(),

    /**
     * Whether to auto-generate createdAt/updatedAt fields.
     * Defaults to true for new collections.
     */
    timestamps: boolean("timestamps").default(true).notNull(),

    /**
     * Admin UI configuration options.
     * Controls sidebar grouping, icon, columns, pagination, etc.
     */
    admin: jsonb("admin").$type<CollectionAdminConfig>(),

    /**
     * Pre-built hooks configured via the Admin UI.
     * Array of hook configurations with order for execution sequence.
     */
    hooks: jsonb("hooks").$type<StoredHookConfig[]>(),

    // --------------------------------------------------------
    // Unified Model Fields
    // --------------------------------------------------------

    /**
     * Where the collection was defined.
     * - 'code': defineCollection() in a config file
     * - 'ui': Visual Collection Builder
     * - 'built-in': System collections from Nextly core
     */
    source: varchar("source", { length: 20 })
      .$type<CollectionSource>()
      .default("ui")
      .notNull(),

    /**
     * If true, the collection cannot be modified via the Admin UI.
     * Code-first collections are locked by default.
     */
    locked: boolean("locked").default(false).notNull(),

    /**
     * Path to the config file (code-first collections only).
     * Used for syncing and displaying source location.
     * @example "src/collections/posts.ts"
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
    migrationStatus: varchar("migration_status", { length: 20 })
      .$type<MigrationStatus>()
      .default("pending")
      .notNull(),

    /**
     * Reference to the last applied migration ID.
     * Null for collections that haven't been migrated yet.
     */
    lastMigrationId: uuid("last_migration_id"),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /** User ID who created the collection (optional) */
    createdBy: uuid("created_by"),

    /** When the collection was created */
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),

    /** When the collection was last updated */
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
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
 * PostgreSQL-specific select type for dynamic collections.
 *
 * Inferred from the Drizzle schema, represents a full row
 * from the `dynamic_collections` table.
 *
 * @example
 * ```typescript
 * const collection: DynamicCollectionPg = await db
 *   .select()
 *   .from(dynamicCollectionsPg)
 *   .where(eq(dynamicCollectionsPg.slug, 'posts'))
 *   .limit(1)
 *   .then(rows => rows[0]);
 * ```
 */
export type DynamicCollectionPg = typeof dynamicCollectionsPg.$inferSelect;

/**
 * PostgreSQL-specific insert type for dynamic collections.
 *
 * Inferred from the Drizzle schema, represents the shape
 * required for inserting a new row. Fields with defaults
 * (id, timestamps, schemaVersion, etc.) are optional.
 *
 * @example
 * ```typescript
 * const newCollection: DynamicCollectionInsertPg = {
 *   slug: 'posts',
 *   labels: { singular: 'Post', plural: 'Posts' },
 *   tableName: 'posts',
 *   fields: [{ type: 'text', name: 'title', required: true }],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * };
 *
 * await db.insert(dynamicCollectionsPg).values(newCollection);
 * ```
 */
export type DynamicCollectionInsertPg =
  typeof dynamicCollectionsPg.$inferInsert;
