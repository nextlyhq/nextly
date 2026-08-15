/**
 * Dialect-Agnostic Type Definitions for Dynamic Components
 *
 * These types define the structure for the `dynamic_components` metadata table
 * and are used by all dialect-specific schemas (PostgreSQL, MySQL, SQLite).
 *
 * Components are shared, reusable field group templates that can be created
 * independently and then selected from within Collections and Singles via
 * the `component` field type.
 *
 * Key differences from Dynamic Collections and Singles:
 * - `label` is singular only (like Singles, no plural form needed)
 * - No `accessRules` (Components are templates/schemas, not documents)
 * - No `hooks` (Components don't have lifecycle hooks)
 * - No `timestamps` configuration
 * - Table name convention: `comp_` prefix (e.g., 'comp_seo')
 * - `admin.category` for sidebar grouping (instead of `admin.group`)
 *
 * @module schemas/dynamic-field-groups/types
 * @since 1.0.0
 */

import type { FieldConfig } from "../../collections/fields/types";
import type { FieldGroupAdminOptions } from "../../field-groups/config/types";

// ============================================================
// Component Source & Status Types
// ============================================================

/**
 * Source of the Component definition.
 *
 * - `code`: Defined in code via `defineFieldGroup()` in a config file
 * - `ui`: Created through the Visual Component Builder in Admin UI
 *
 * @example
 * ```typescript
 * const source: FieldGroupSource = 'code';
 * ```
 */
export type FieldGroupSource = "code" | "ui";

/**
 * Migration status for a Component's schema.
 *
 * - `synced`: Schema is in sync with the database (no pending changes)
 * - `pending`: Schema has changed but migration not yet created
 * - `generated`: Migration file has been created but not applied
 * - `applied`: Migration has been applied to the database (table verified to exist)
 * - `failed`: Migration was attempted but table creation failed. RETRIABLE: the table is not
 *   there, so making it again is the repair.
 * - `diverged`: The tables were changed and the row recording it was NOT written. NOT RETRIABLE,
 *   and that is the whole reason it is its own state rather than a `failed`. The stored definition
 *   describes the PREVIOUS shape while the tables hold the new one, so repeating the edit derives
 *   its starting point from a row that is already wrong — a localization enable would seed the
 *   companion a second time from main-table columns the first attempt already dropped. Reconcile
 *   the definition against the tables before editing the field group again.
 *
 * @example
 * ```typescript
 * if (component.migrationStatus === 'pending') {
 *   console.log('Run `nextly migrate:create` to generate migration');
 * }
 * if (component.migrationStatus === 'failed') {
 *   console.log('Table creation failed - check logs and retry');
 * }
 * if (component.migrationStatus === 'diverged') {
 *   console.log('Tables moved but the record did not - reconcile, do NOT retry');
 * }
 * ```
 */
/**
 * 🔴 DERIVED from the runtime list below, which is the single declaration of this set.
 *
 * The two used to be written out separately, and that is not a stylistic point: the list was
 * annotated `readonly FieldGroupMigrationStatus[]`, and an array missing an element still satisfies
 * that annotation — so a status added to the type and forgotten in the list compiled cleanly and
 * silently stopped being accepted anywhere the list is used to validate.
 *
 * Deriving the type from the value makes the value the source. Add a status in one place and every
 * union, every validator and every exhaustive switch sees it at once; there is no second place that
 * can be forgotten, because there is no second place.
 */
export type FieldGroupMigrationStatus =
  (typeof FIELD_GROUP_MIGRATION_STATUSES)[number];

// ============================================================
// Dynamic Component Types
// ============================================================

/**
 * Insert type for creating a new dynamic Component.
 *
 * Contains all required and optional fields for inserting a Component
 * into the `dynamic_components` table. Fields with defaults (like
 * `schemaVersion`, `migrationStatus`) are optional on insert.
 *
 * @example
 * ```typescript
 * const newComponent: DynamicFieldGroupInsert = {
 *   slug: 'seo',
 *   label: 'SEO Metadata',
 *   tableName: 'comp_seo',
 *   fields: [
 *     { type: 'text', name: 'metaTitle', required: true },
 *     { type: 'text', name: 'metaDescription' },
 *   ],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * };
 * ```
 */
export interface DynamicFieldGroupInsert {
  /**
   * Unique slug identifier for the Component.
   * Used in API references and component field selections.
   * Must be unique across all Components, Collections, AND Singles.
   */
  slug: string;

  /**
   * Display label for the Admin UI.
   * Components only need a singular label (used in sidebar,
   * component selector, and builder).
   *
   * @example 'SEO Metadata', 'Hero Section', 'Call To Action'
   */
  label: string;

  /**
   * Database table name for this Component's data.
   * Must be unique across all tables.
   * Convention: prefix with `comp_` (e.g., 'comp_seo', 'comp_hero').
   */
  tableName: string;

  /**
   * Optional description of the Component's purpose.
   * Displayed in the Admin UI component selector and builder.
   */
  description?: string;

  /**
   * Field configurations defining the Component's structure.
   * Supports all field types including nested component fields.
   */
  fields: FieldConfig[];

  /**
   * Admin UI configuration options.
   * Controls category grouping, icon, visibility, etc.
   */
  admin?: FieldGroupAdminOptions;

  /**
   * Where the Component was defined.
   * - 'code': defineFieldGroup() in a config file
   * - 'ui': Visual Component Builder
   */
  source: FieldGroupSource;

  /**
   * If true, the Component cannot be modified via the Admin UI.
   * Code-first Components are locked by default.
   */
  locked?: boolean;

  /**
   * i18n: whether the component is localized. When true, translatable fields live in
   * the companion `comp_<slug>_locales` table and embedded instances resolve/write them
   * per language.
   */
  localized?: boolean;

  /**
   * Path to the config file (code-first Components only).
   * Used for syncing and displaying source location.
   *
   * @example "src/components/seo.ts"
   */
  configPath?: string;

  /**
   * SHA-256 hash of the fields definition.
   * Used for change detection during sync operations.
   */
  schemaHash: string;

  /**
   * Schema version number, incremented on each change.
   * Defaults to 1 for new Components.
   */
  schemaVersion?: number;

  /**
   * Current migration status.
   * Defaults to 'pending' for new Components.
   */
  migrationStatus?: FieldGroupMigrationStatus;

  /**
   * Reference to the last applied migration ID.
   * Null for Components that haven't been migrated yet.
   */
  lastMigrationId?: string;

  /**
   * User ID who created the Component (optional).
   * Only set for UI-created Components.
   */
  createdBy?: string;
}

/**
 * Full record type for a dynamic Component.
 *
 * Extends `DynamicFieldGroupInsert` with all required fields that are
 * set by the database (id, timestamps) or have default values.
 *
 * @example
 * ```typescript
 * const component: DynamicFieldGroupRecord = {
 *   id: 'uuid-123',
 *   slug: 'seo',
 *   label: 'SEO Metadata',
 *   tableName: 'comp_seo',
 *   fields: [...],
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
export interface DynamicFieldGroupRecord extends DynamicFieldGroupInsert {
  /**
   * Unique identifier (UUID or CUID).
   * Auto-generated by the database.
   */
  id: string;

  /**
   * Schema version number (required, starts at 1).
   */
  schemaVersion: number;

  /**
   * Current migration status (required).
   */
  migrationStatus: FieldGroupMigrationStatus;

  /**
   * Whether Component is locked from UI edits (required).
   * Code-first Components are always locked.
   */
  locked: boolean;

  /** i18n: whether the component is localized (translatable fields in `comp_<slug>_locales`). */
  localized: boolean;

  /**
   * When the Component was created.
   * Auto-set by the database.
   */
  createdAt: Date;

  /**
   * When the Component was last updated.
   * Auto-updated on each modification.
   */
  updatedAt: Date;
}

// ============================================================
// Constants
// ============================================================

/**
 * All supported Component source types.
 *
 * Useful for validation and iteration.
 *
 * @example
 * ```typescript
 * if (FIELD_GROUP_SOURCE_TYPES.includes(source)) {
 *   // Valid source type
 * }
 * ```
 */
export const FIELD_GROUP_SOURCE_TYPES: readonly FieldGroupSource[] = [
  "code",
  "ui",
] as const;

/**
 * All supported Component migration statuses.
 *
 * Useful for validation and iteration.
 *
 * @example
 * ```typescript
 * if (FIELD_GROUP_MIGRATION_STATUSES.includes(status)) {
 *   // Valid migration status
 * }
 * ```
 */
export const FIELD_GROUP_MIGRATION_STATUSES = [
  "synced",
  "pending",
  "generated",
  "applied",
  "failed",
  "diverged",
] as const;
