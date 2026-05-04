/**
 * Dialect-Agnostic Type Definitions for Dynamic Collections
 *
 * These types define the structure for the `dynamic_collections` metadata table
 * and migration tracking. All dialect-specific schemas (PostgreSQL, MySQL, SQLite)
 * will implement these interfaces.
 *
 * @module schemas/dynamic-collections/types
 * @since 1.0.0
 */

import type { FieldConfig, IndexConfig } from "@nextly/collections";

import type { CollectionAccessRules } from "../../services/access/types";

/**
 * Source of the collection definition.
 *
 * - `code`: Defined in code via `defineCollection()` in a config file
 * - `ui`: Created through the Visual Collection Builder in Admin UI
 * - `built-in`: System collections provided by Nextly core
 *
 * @example
 * ```typescript
 * const source: CollectionSource = 'code';
 * ```
 */
export type CollectionSource = "code" | "ui" | "built-in";

/**
 * Migration status for a collection's schema.
 *
 * - `synced`: Schema is in sync with the database (no pending changes)
 * - `pending`: Schema has changed but migration not yet created
 * - `generated`: Migration file has been created but not applied
 * - `applied`: Migration has been applied to the database (table verified to exist)
 * - `failed`: Migration was attempted but table creation failed
 *
 * @example
 * ```typescript
 * if (collection.migrationStatus === 'pending') {
 *   console.log('Run `nextly migrate:create` to generate migration');
 * }
 * if (collection.migrationStatus === 'failed') {
 *   console.log('Table creation failed - check logs and retry');
 * }
 * ```
 */
export type MigrationStatus =
  | "synced"
  | "pending"
  | "generated"
  | "applied"
  | "failed";

// ============================================================
// Collection Configuration Types
// ============================================================

/**
 * Labels for displaying the collection in the Admin UI.
 *
 * @example
 * ```typescript
 * const labels: CollectionLabels = {
 *   singular: 'Post',
 *   plural: 'Posts',
 * };
 * ```
 */
export interface CollectionLabels {
  /** Singular form of the collection name (e.g., "Post") */
  singular: string;

  /** Plural form of the collection name (e.g., "Posts") */
  plural: string;
}

/**
 * Admin UI configuration options for a collection.
 *
 * Controls how the collection appears and behaves in the Admin Panel.
 *
 * @example
 * ```typescript
 * const adminConfig: CollectionAdminConfig = {
 *   group: 'Content',
 *   icon: 'file-text',
 *   useAsTitle: 'title',
 *   pagination: {
 *     defaultLimit: 25,
 *     limits: [10, 25, 50, 100],
 *   },
 * };
 * ```
 */
export interface CollectionAdminConfig {
  /**
   * Sidebar group name for organizing collections.
   * Collections with the same group are displayed together.
   */
  group?: string;

  /**
   * Lucide icon name to display in the sidebar.
   * @see https://lucide.dev/icons
   */
  icon?: string;

  /**
   * If true, hides the collection from the Admin sidebar.
   * The collection is still accessible via direct URL.
   */
  hidden?: boolean;

  /**
   * Field name to use as the document title in the Admin UI.
   * This field's value is shown in breadcrumbs and relationship pickers.
   */
  useAsTitle?: string;

  /**
   * Pagination configuration for the list view.
   */
  pagination?: {
    /** Default number of items per page */
    defaultLimit?: number;

    /** Available page size options */
    limits?: number[];
  };

  /**
   * Sort order within sidebar group (lower = higher position, default: 100).
   */
  order?: number;

  /**
   * Custom sidebar group slug. When set, item moves from its default section to this custom group.
   */
  sidebarGroup?: string;

  /**
   * Whether this collection is provided by a plugin.
   */
  isPlugin?: boolean;

  /**
   * Preview URL configuration for content preview workflows.
   *
   * For UI-created collections, use `urlTemplate` with placeholders.
   * For code-first collections, use `url` function.
   *
   * @example URL template (UI collections)
   * ```typescript
   * preview: {
   *   urlTemplate: "/preview/posts/{slug}",
   *   label: "Preview Post",
   * }
   * ```
   */
  preview?: {
    /**
     * URL template with field placeholders in {fieldName} format.
     * Used for UI-created collections where functions can't be stored.
     *
     * @example "/preview/{slug}", "/api/preview?id={id}"
     */
    urlTemplate?: string;

    /**
     * Whether to open preview in a new browser tab.
     * @default true
     */
    openInNewTab?: boolean;

    /**
     * Custom label for the preview button.
     * @default "Preview"
     */
    label?: string;
  };

  /**
   * Custom components configuration for the admin UI.
   *
   * Allows plugins to replace default admin views (Edit, List) and
   * inject components at specific locations (BeforeListTable, etc.).
   *
   * Component paths use the format: `"package-name/path#ExportName"`
   *
   * @example
   * ```typescript
   * components: {
   *   views: {
   *     Edit: {
   *       Component: "@revnixhq/plugin-form-builder/admin#FormBuilderView",
   *     },
   *   },
   *   BeforeListTable: "@revnixhq/plugin-form-builder/admin#CreateFormButton",
   * }
   * ```
   */
  components?: {
    /** Custom views to replace default admin views */
    views?: {
      /** Custom Edit view component */
      Edit?: { Component: string };
      /** Custom List view component */
      List?: { Component: string };
    };
    /** Component to render before the list table */
    BeforeListTable?: string;
    /** Component to render after the list table */
    AfterListTable?: string;
    /** Component to render before the edit form */
    BeforeEdit?: string;
    /** Component to render after the edit form */
    AfterEdit?: string;
  };
}

// ============================================================
// Stored Hook Configuration Types
// ============================================================

/**
 * Hook type for stored hook configurations.
 *
 * Includes all standard hook types plus virtual types that map to multiple hooks:
 * - `beforeChange`: Runs on both create and update operations
 * - `afterChange`: Runs after both create and update operations
 *
 * @example
 * ```typescript
 * const hookType: StoredHookType = 'beforeChange';
 * // At runtime, this maps to both 'beforeCreate' and 'beforeUpdate'
 * ```
 */
export type StoredHookType =
  | "beforeOperation"
  | "beforeCreate"
  | "afterCreate"
  | "beforeUpdate"
  | "afterUpdate"
  | "beforeDelete"
  | "afterDelete"
  | "beforeRead"
  | "afterRead"
  | "beforeChange" // Virtual: runs on both create and update
  | "afterChange"; // Virtual: runs on both create and update

/**
 * Stored configuration for a pre-built hook.
 *
 * This interface defines how hooks configured via the Admin UI are
 * persisted in the `dynamic_collections` table. Each hook instance
 * references a pre-built hook by ID and stores its configuration.
 *
 * @example
 * ```typescript
 * const storedHook: StoredHookConfig = {
 *   hookId: 'auto-slug',
 *   hookType: 'beforeChange',
 *   enabled: true,
 *   config: {
 *     sourceField: 'title',
 *     targetField: 'slug',
 *   },
 *   order: 0,
 * };
 * ```
 */
export interface StoredHookConfig {
  /**
   * Reference to the pre-built hook ID.
   * Must match an ID in the prebuilt hooks registry.
   *
   * @example 'auto-slug', 'audit-fields', 'webhook-notification'
   */
  hookId: string;

  /**
   * When this hook runs in the document lifecycle.
   * Virtual types like 'beforeChange' are mapped to actual hook types at runtime.
   */
  hookType: StoredHookType;

  /**
   * Whether this hook is currently enabled.
   * Disabled hooks are stored but not executed.
   */
  enabled: boolean;

  /**
   * Hook-specific configuration values.
   * The shape depends on the pre-built hook's configSchema.
   *
   * @example
   * ```typescript
   * // For auto-slug hook:
   * config: { sourceField: 'title', targetField: 'slug' }
   *
   * // For webhook-notification hook:
   * config: { url: 'https://example.com/webhook', events: ['create', 'update'] }
   * ```
   */
  config: Record<string, unknown>;

  /**
   * Execution order (0-based).
   * Hooks are executed in ascending order.
   * Lower numbers run first.
   */
  order: number;
}

// ============================================================
// Dynamic Collection Types
// ============================================================

/**
 * Insert type for creating a new dynamic collection.
 *
 * Contains all required and optional fields for inserting a collection
 * into the `dynamic_collections` table. Fields with defaults (like
 * `schemaVersion`, `migrationStatus`) are optional on insert.
 *
 * @example
 * ```typescript
 * const newCollection: DynamicCollectionInsert = {
 *   slug: 'posts',
 *   labels: { singular: 'Post', plural: 'Posts' },
 *   tableName: 'posts',
 *   fields: [
 *     { type: 'text', name: 'title', required: true },
 *     { type: 'richText', name: 'content' },
 *   ],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * };
 * ```
 */
export interface DynamicCollectionInsert {
  /** Unique slug identifier (e.g., "posts", "products") */
  slug: string;

  /** Display labels for Admin UI */
  labels: CollectionLabels;

  /** Database table name for this collection */
  tableName: string;

  /** Optional description of the collection */
  description?: string;

  /** Field configurations defining the collection schema */
  fields: FieldConfig[];

  /** Whether to auto-generate createdAt/updatedAt fields (default: true) */
  timestamps?: boolean;

  /**
   * Whether records carry a Draft/Published status column.
   * When true, a `status` column ('draft' | 'published', default 'draft') is
   * synthesized into the collection's table. Public callers see only published
   * records by default; admin callers see everything. See the query-layer
   * `resolveStatusFilter` for how the filter is enforced. Default: false.
   */
  status?: boolean;

  /** Admin UI configuration options */
  admin?: CollectionAdminConfig;

  /** Where the collection was defined */
  source: CollectionSource;

  /**
   * If true, the collection cannot be modified via the Admin UI.
   * Code-first collections are locked by default.
   */
  locked?: boolean;

  /**
   * Path to the config file (code-first collections only).
   * Used for syncing and displaying source location.
   * @example "src/collections/posts.ts"
   */
  configPath?: string;

  /**
   * SHA-256 hash of the fields definition.
   * Used for change detection during sync operations.
   */
  schemaHash: string;

  /**
   * Schema version number, incremented on each change.
   * Defaults to 1 for new collections.
   */
  schemaVersion?: number;

  /**
   * Current migration status.
   * Defaults to 'pending' for new collections.
   */
  migrationStatus?: MigrationStatus;

  /**
   * Reference to the last applied migration ID.
   * Null for collections that haven't been migrated yet.
   */
  lastMigrationId?: string;

  /** User ID who created the collection (optional) */
  createdBy?: string;

  /**
   * Access control rules for CRUD operations.
   *
   * Defines who can create, read, update, and delete documents in this collection.
   * If not specified, all operations default to public access.
   *
   * @example
   * ```typescript
   * accessRules: {
   *   create: { type: 'authenticated' },
   *   read: { type: 'public' },
   *   update: { type: 'owner-only' },
   *   delete: { type: 'role-based', allowedRoles: ['admin'] },
   * }
   * ```
   */
  accessRules?: CollectionAccessRules;

  /**
   * Pre-built hooks configured via the Admin UI.
   *
   * Each hook references a pre-built hook by ID and stores its configuration.
   * Hooks are executed in order during document lifecycle events.
   *
   * @example
   * ```typescript
   * hooks: [
   *   {
   *     hookId: 'auto-slug',
   *     hookType: 'beforeChange',
   *     enabled: true,
   *     config: { sourceField: 'title', targetField: 'slug' },
   *     order: 0,
   *   },
   *   {
   *     hookId: 'audit-fields',
   *     hookType: 'beforeChange',
   *     enabled: true,
   *     config: { createdByField: 'createdBy', updatedByField: 'updatedBy' },
   *     order: 1,
   *   },
   * ]
   * ```
   */
  hooks?: StoredHookConfig[];

  /**
   * Database indexes for query performance optimization.
   *
   * Use this to define compound indexes (indexes on multiple fields).
   * For single-field indexes, use `index: true` on the field itself.
   *
   * @example
   * ```typescript
   * indexes: [
   *   { fields: ['authorId', 'createdAt'] },
   *   { fields: ['slug', 'locale'], unique: true },
   * ]
   * ```
   */
  indexes?: IndexConfig[];
}

/**
 * Full record type for a dynamic collection.
 *
 * Extends `DynamicCollectionInsert` with all required fields that are
 * set by the database (id, timestamps) or have default values.
 *
 * @example
 * ```typescript
 * const collection: DynamicCollectionRecord = {
 *   id: 'uuid-123',
 *   slug: 'posts',
 *   labels: { singular: 'Post', plural: 'Posts' },
 *   tableName: 'posts',
 *   fields: [...],
 *   timestamps: true,
 *   source: 'code',
 *   locked: true,
 *   schemaHash: 'abc123...',
 *   schemaVersion: 1,
 *   migrationStatus: 'applied',
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * };
 * ```
 */
export interface DynamicCollectionRecord extends DynamicCollectionInsert {
  /** Unique identifier (UUID or CUID) */
  id: string;

  /** Schema version number (required, starts at 1) */
  schemaVersion: number;

  /** Current migration status (required) */
  migrationStatus: MigrationStatus;

  /** Whether timestamps are enabled (required, defaults to true) */
  timestamps: boolean;

  /** Whether Draft/Published status is enabled (required, defaults to false) */
  status: boolean;

  /** Whether collection is locked from UI edits (required) */
  locked: boolean;

  /** When the collection was created */
  createdAt: Date;

  /** When the collection was last updated */
  updatedAt: Date;
}

// ============================================================
// Migration Record Types
// ============================================================

/**
 * Status of a migration record (F11).
 *
 * Two-state lifecycle: rows are inserted ONLY after the apply attempt
 * completes, so there's no transient `pending` value on disk. Applies
 * to the `nextly_migrations` file-based ledger written by `nextly migrate`.
 *
 * - `applied`: Migration was successfully applied
 * - `failed`: Migration failed during execution
 */
export type MigrationRecordStatus = "applied" | "failed";

/**
 * Structured error payload stored in `nextly_migrations.error_json` on
 * failed applies (F11).
 *
 * Lets operators jump straight to the failing statement instead of
 * grepping through a single `error_message` text blob.
 */
export interface MigrationErrorJson {
  /** Database-specific error code (e.g. PG SQLSTATE `42703`). */
  sqlState?: string;
  /**
   * The SQL statement that triggered the error.
   *
   * **Always undefined in F11.** PG/SQLite run all migration statements
   * inside a single transaction so the driver only reports the bubbled-up
   * error, not the specific failing statement. F15 will introduce
   * per-statement journaling on MySQL (which has non-transactional DDL)
   * and populate this field for that path. Until then, treat this as
   * reserved.
   */
  statement?: string;
  /** Human-readable error message from the driver. */
  message: string;
}

/**
 * Insert type for creating a new migration record (F11).
 *
 * Mirrors the F11 spec column shape. `id` and `appliedAt` have
 * defaults at the schema level so they're optional here.
 *
 * @example
 * ```typescript
 * const migration: MigrationRecordInsert = {
 *   filename: '20260429_154500_123_add_excerpt.sql',
 *   sha256: 'abc123…',
 *   status: 'applied',
 *   appliedBy: 'github-actions-12345',
 *   durationMs: 42,
 * };
 * ```
 */
export interface MigrationRecordInsert {
  /**
   * Migration filename without directory. Unique across the table.
   *
   * @example "20260429_154500_123_add_excerpt.sql"
   */
  filename: string;

  /** SHA-256 of the .sql file content. 64 hex chars. */
  sha256: string;

  /** Apply outcome. */
  status: MigrationRecordStatus;

  /** Resolved CLI actor (env-var precedence). */
  appliedBy?: string | null;

  /** Wall-clock apply duration in milliseconds. */
  durationMs?: number | null;

  /** Structured error payload on failure. */
  errorJson?: MigrationErrorJson | null;

  /** Reserved for v2 corrective rollback. Always null in v1. */
  rollbackSql?: string | null;
}

/**
 * Full record type for a migration (F11).
 *
 * Extends `MigrationRecordInsert` with database-generated fields.
 *
 * @example
 * ```typescript
 * const record: MigrationRecord = {
 *   id: 'uuid-123',
 *   filename: '20260429_154500_123_add_excerpt.sql',
 *   sha256: 'abc123…',
 *   status: 'applied',
 *   appliedBy: 'sarah@laptop',
 *   durationMs: 42,
 *   appliedAt: new Date(),
 *   errorJson: null,
 *   rollbackSql: null,
 * };
 * ```
 */
export interface MigrationRecord extends MigrationRecordInsert {
  /** Unique identifier (UUID v4) */
  id: string;

  /** When the migration was applied (UTC). */
  appliedAt: Date;
}
