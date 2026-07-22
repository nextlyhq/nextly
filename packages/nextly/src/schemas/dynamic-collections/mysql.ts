/**
 * MySQL Schema for Dynamic Collections
 *
 * Defines the `dynamic_collections` table schema for MySQL databases
 * using Drizzle ORM. This schema stores metadata for both UI-created and
 * code-first collections with unified model fields for source tracking,
 * migration status, and versioning.
 *
 * @module schemas/dynamic-collections/mysql
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   dynamicCollectionsMysql,
 *   type DynamicCollectionMysql,
 *   type DynamicCollectionInsertMysql,
 * } from '@nextly/schemas/dynamic-collections/mysql';
 *
 * // Insert a new collection
 * const newCollection = await db.insert(dynamicCollectionsMysql).values({
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
  mysqlTable,
  varchar,
  text,
  boolean,
  int,
  datetime,
  json,
  index,
} from "drizzle-orm/mysql-core";

import type { FieldConfig } from "@nextly/collections";

import { users } from "../users/mysql";
// Normalized versioning config persisted on the registry `versions` column.
import type { ResolvedVersionsConfig } from "../versions/types";

import type {
  CollectionLabels,
  CollectionAdminConfig,
  CollectionSource,
  MigrationStatus,
  StoredHookConfig,
} from "./types";

// ============================================================
// Dynamic Collections Table (MySQL)
// ============================================================

/**
 * MySQL schema for the `dynamic_collections` table.
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
 *   .from(dynamicCollectionsMysql)
 *   .where(eq(dynamicCollectionsMysql.source, 'code'));
 *
 * // Find collections needing migration
 * const pendingMigrations = await db
 *   .select()
 *   .from(dynamicCollectionsMysql)
 *   .where(eq(dynamicCollectionsMysql.migrationStatus, 'pending'));
 * ```
 */
export const dynamicCollectionsMysql = mysqlTable(
  "dynamic_collections",
  {
    // --------------------------------------------------------
    // Primary Key
    // --------------------------------------------------------

    /**
     * Unique identifier.
     *
     * `varchar(191)` matches `users.id` to satisfy MySQL's strict FK type
     * matching (utf8mb4 index limit at 191 chars). Callers pass an explicit
     * string id (e.g., `randomUUID()`); no auto-default is set because
     * production code always supplies an id.
     */
    id: varchar("id", { length: 191 }).primaryKey(),

    // --------------------------------------------------------
    // Collection Identity
    // --------------------------------------------------------

    /**
     * Unique slug identifier for the collection.
     * Used in URLs and API endpoints (e.g., "posts", "products").
     */
    slug: varchar("slug", { length: 100 }).unique().notNull(),

    /**
     * Display labels for the Admin UI.
     * Contains singular and plural forms (e.g., "Post" / "Posts").
     */
    labels: json("labels").$type<CollectionLabels>().notNull(),

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
    fields: json("fields").$type<FieldConfig[]>().notNull(),

    /**
     * Whether to auto-generate createdAt/updatedAt fields.
     * Defaults to true for new collections.
     */
    timestamps: boolean("timestamps").default(true).notNull(),

    /**
     * Whether the collection's records carry a Draft/Published status column.
     * Default false; users opt in via the Schema Builder modal. See the
     * postgres schema for full semantics.
     */
    status: boolean("status").default(false).notNull(),
    /** Collection-level i18n master switch (mirrors `status`). */
    localized: boolean("localized").default(false).notNull(),

    /**
     * Resolved content-versioning config, or null when unversioned. Stores the
     * normalized `ResolvedVersionsConfig` so every consumer reads one shape and
     * later stages read more fields without a re-migration. See postgres schema.
     */
    versions: json("versions").$type<ResolvedVersionsConfig>(),

    /**
     * Admin UI configuration options.
     * Controls sidebar grouping, icon, columns, pagination, etc.
     */
    admin: json("admin").$type<CollectionAdminConfig>(),

    /**
     * Pre-built hooks configured via the Admin UI.
     * Array of hook configurations with order for execution sequence.
     */
    hooks: json("hooks").$type<StoredHookConfig[]>(),

    // --------------------------------------------------------
    // Unified Model Fields
    // --------------------------------------------------------

    /**
     * Where the collection was defined.
     * - 'code': defineCollection() in a config file
     * - 'ui': Visual Collection Builder
     * - 'built-in': System collections from Nextly core
     */
    source: varchar("source", { length: 255 })
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
    schemaVersion: int("schema_version").default(1).notNull(),

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
     *
     * `varchar(100)` holds migration file slugs (e.g.,
     * `0001_perpetual_captain_marvel`), not UUIDs. Null for collections
     * that haven't been migrated yet.
     */
    lastMigrationId: varchar("last_migration_id", { length: 100 }),

    // --------------------------------------------------------
    // Access Control
    // --------------------------------------------------------

    /**
     * Optional per-operation access rules. Consumed by
     * `CollectionAccessService`; opaque JSON because the rule shape evolves
     * independently of the migration cycle.
     */
    accessRules: json("access_rules").$type<{
      create?: { type: string; allowedRoles?: string[] };
      read?: { type: string; allowedRoles?: string[] };
      update?: { type: string; allowedRoles?: string[] };
      delete?: { type: string; allowedRoles?: string[] };
      publish?: { type: string; allowedRoles?: string[] };
      unpublish?: { type: string; allowedRoles?: string[] };
    }>(),

    // --------------------------------------------------------
    // Metadata
    // --------------------------------------------------------

    /**
     * User ID of the creator (optional).
     *
     * `varchar(191)` matches `users.id` for FK compatibility under the
     * MySQL utf8mb4 191-char key prefix limit.
     */
    createdBy: varchar("created_by", { length: 191 }).references(
      () => users.id
    ),

    /** When the collection was created */
    createdAt: datetime("created_at")
      .notNull()
      .$defaultFn(() => new Date()),

    /** When the collection was last updated */
    updatedAt: datetime("updated_at")
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
 * MySQL-specific select type for dynamic collections.
 *
 * Inferred from the Drizzle schema, represents a full row
 * from the `dynamic_collections` table.
 *
 * @example
 * ```typescript
 * const collection: DynamicCollectionMysql = await db
 *   .select()
 *   .from(dynamicCollectionsMysql)
 *   .where(eq(dynamicCollectionsMysql.slug, 'posts'))
 *   .limit(1)
 *   .then(rows => rows[0]);
 * ```
 */
export type DynamicCollectionMysql =
  typeof dynamicCollectionsMysql.$inferSelect;

/**
 * MySQL-specific insert type for dynamic collections.
 *
 * Inferred from the Drizzle schema, represents the shape
 * required for inserting a new row. Fields with defaults
 * (id, timestamps, schemaVersion, etc.) are optional.
 *
 * @example
 * ```typescript
 * const newCollection: DynamicCollectionInsertMysql = {
 *   slug: 'posts',
 *   labels: { singular: 'Post', plural: 'Posts' },
 *   tableName: 'posts',
 *   fields: [{ type: 'text', name: 'title', required: true }],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * };
 *
 * await db.insert(dynamicCollectionsMysql).values(newCollection);
 * ```
 */
export type DynamicCollectionInsertMysql =
  typeof dynamicCollectionsMysql.$inferInsert;
