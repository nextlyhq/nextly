/**
 * Dialect-Agnostic Type Definitions for Dynamic Singles
 *
 * These types define the structure for the `dynamic_singles` metadata table
 * and are used by all dialect-specific schemas (PostgreSQL, MySQL, SQLite).
 *
 * Singles are single-document entities
 * for storing site-wide configuration such as site settings, navigation menus,
 * footers, and homepage configurations.
 *
 * Key differences from Dynamic Collections:
 * - Only one document per Single (no list view)
 * - No create/delete operations (auto-created on first access)
 * - Simplified access rules (read/update only)
 * - No stored hooks (hooks are code-only for Singles)
 * - No pagination or list column configuration
 *
 * @module schemas/dynamic-singles/types
 * @since 1.0.0
 */

import type { FieldConfig } from "../../collections/fields/types";
import type { StoredAccessRule } from "../../services/access/types";
import type { SingleAdminOptions } from "../../singles/config/types";

// ============================================================
// Single Source & Status Types
// ============================================================

/**
 * Source of the Single definition.
 *
 * - `code`: Defined in code via `defineSingle()` in a config file
 * - `ui`: Created through the Visual Single Builder in Admin UI
 * - `built-in`: System Singles provided by Nextly core (future use)
 *
 * @example
 * ```typescript
 * const source: SingleSource = 'code';
 * ```
 */
export type SingleSource = "code" | "ui" | "built-in";

/**
 * Migration status for a Single's schema.
 *
 * - `synced`: Schema is in sync with the database (no pending changes)
 * - `pending`: Schema has changed but migration not yet created
 * - `generated`: Migration file has been created but not applied
 * - `applied`: Migration has been applied to the database (table verified to exist)
 * - `failed`: Migration was attempted but table creation failed
 *
 * @example
 * ```typescript
 * if (single.migrationStatus === 'pending') {
 *   console.log('Run `nextly migrate:create` to generate migration');
 * }
 * if (single.migrationStatus === 'failed') {
 *   console.log('Table creation failed - check logs and retry');
 * }
 * ```
 */
export type SingleMigrationStatus =
  | "synced"
  | "pending"
  | "generated"
  | "applied"
  | "failed";

// ============================================================
// Single Access Rules
// ============================================================

/**
 * Access control rules for a Single.
 *
 * Unlike Collections which have create/read/update/delete operations,
 * Singles only support read and update:
 * - **No create:** Document is auto-created on first access
 * - **No delete:** Singles always exist once accessed
 *
 * These rules are used for UI-created Singles. Code-first Singles
 * use the `access` property with functions instead.
 *
 * @example
 * ```typescript
 * // Public read, admin-only update
 * const accessRules: SingleAccessRules = {
 *   read: { type: 'public' },
 *   update: { type: 'role-based', allowedRoles: ['admin'] },
 * };
 *
 * // Authenticated users can read and update
 * const authAccessRules: SingleAccessRules = {
 *   read: { type: 'authenticated' },
 *   update: { type: 'authenticated' },
 * };
 * ```
 */
export interface SingleAccessRules {
  /**
   * Access rule for reading the Single document.
   * If not specified, defaults to public access.
   */
  read?: StoredAccessRule;

  /**
   * Access rule for updating the Single document.
   * If not specified, defaults to public access.
   */
  update?: StoredAccessRule;
}

// ============================================================
// Dynamic Single Types
// ============================================================

/**
 * Insert type for creating a new dynamic Single.
 *
 * Contains all required and optional fields for inserting a Single
 * into the `dynamic_singles` table. Fields with defaults (like
 * `schemaVersion`, `migrationStatus`) are optional on insert.
 *
 * @example
 * ```typescript
 * const newSingle: DynamicSingleInsert = {
 *   slug: 'site-settings',
 *   label: 'Site Settings',
 *   tableName: 'single_site_settings',
 *   fields: [
 *     { type: 'text', name: 'siteName', required: true },
 *     { type: 'text', name: 'tagline' },
 *   ],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * };
 * ```
 */
export interface DynamicSingleInsert {
  /**
   * Unique slug identifier for the Single.
   * Used in URLs and API endpoints (e.g., "site-settings", "header").
   * Must be unique across all Singles AND Collections.
   */
  slug: string;

  /**
   * Display label for the Admin UI.
   * Unlike Collections, Singles only need a singular label.
   *
   * @example 'Site Settings', 'Header Navigation', 'Footer'
   */
  label: string;

  /**
   * Database table name for this Single.
   * Must be unique across all tables.
   * Convention: prefix with `single_` (e.g., 'single_site_settings').
   */
  tableName: string;

  /**
   * Optional description of the Single's purpose.
   * Displayed in the Admin UI.
   */
  description?: string;

  /**
   * Field configurations defining the Single's document structure.
   * Supports all 26 field types from the Collections system.
   */
  fields: FieldConfig[];

  /**
   * Admin UI configuration options.
   * Controls sidebar grouping, icon, visibility, etc.
   */
  admin?: SingleAdminOptions;

  /**
   * Where the Single was defined.
   * - 'code': defineSingle() in a config file
   * - 'ui': Visual Single Builder
   * - 'built-in': System Singles from Nextly core
   */
  source: SingleSource;

  /**
   * If true, the Single cannot be modified via the Admin UI.
   * Code-first Singles are locked by default.
   */
  locked?: boolean;

  /**
   * Whether the Single carries a Draft/Published status column.
   * When true, a `status` column ('draft' | 'published', default 'draft') is
   * synthesized into the Single's table. Public callers see the published
   * version by default; admin callers see drafts. See the query-layer
   * `resolveStatusFilter` for enforcement. Default: false.
   */
  status?: boolean;

  /**
   * Path to the config file (code-first Singles only).
   * Used for syncing and displaying source location.
   *
   * @example "src/singles/site-settings.ts"
   */
  configPath?: string;

  /**
   * SHA-256 hash of the fields definition.
   * Used for change detection during sync operations.
   */
  schemaHash: string;

  /**
   * Schema version number, incremented on each change.
   * Defaults to 1 for new Singles.
   */
  schemaVersion?: number;

  /**
   * Current migration status.
   * Defaults to 'pending' for new Singles.
   */
  migrationStatus?: SingleMigrationStatus;

  /**
   * Reference to the last applied migration ID.
   * Null for Singles that haven't been migrated yet.
   */
  lastMigrationId?: string;

  /**
   * User ID who created the Single (optional).
   * Only set for UI-created Singles.
   */
  createdBy?: string;

  /**
   * Access control rules for read/update operations.
   *
   * Defines who can read and update this Single.
   * If not specified, all operations default to public access.
   *
   * Note: Singles don't have create/delete access rules since
   * documents are auto-created and cannot be deleted.
   *
   * @example
   * ```typescript
   * accessRules: {
   *   read: { type: 'public' },
   *   update: { type: 'role-based', allowedRoles: ['admin'] },
   * }
   * ```
   */
  accessRules?: SingleAccessRules;
}

/**
 * Full record type for a dynamic Single.
 *
 * Extends `DynamicSingleInsert` with all required fields that are
 * set by the database (id, timestamps) or have default values.
 *
 * @example
 * ```typescript
 * const single: DynamicSingleRecord = {
 *   id: 'uuid-123',
 *   slug: 'site-settings',
 *   label: 'Site Settings',
 *   tableName: 'single_site_settings',
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
export interface DynamicSingleRecord extends DynamicSingleInsert {
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
  migrationStatus: SingleMigrationStatus;

  /**
   * Whether Single is locked from UI edits (required).
   * Code-first Singles are always locked.
   */
  locked: boolean;

  /**
   * Whether Draft/Published status is enabled (required, defaults to false).
   */
  status: boolean;

  /**
   * When the Single was created.
   * Auto-set by the database.
   */
  createdAt: Date;

  /**
   * When the Single was last updated.
   * Auto-updated on each modification.
   */
  updatedAt: Date;
}

// ============================================================
// Constants
// ============================================================

/**
 * All supported Single source types.
 *
 * Useful for validation and iteration.
 *
 * @example
 * ```typescript
 * if (SINGLE_SOURCE_TYPES.includes(source)) {
 *   // Valid source type
 * }
 * ```
 */
export const SINGLE_SOURCE_TYPES: readonly SingleSource[] = [
  "code",
  "ui",
  "built-in",
] as const;

/**
 * All supported Single migration statuses.
 *
 * Useful for validation and iteration.
 *
 * @example
 * ```typescript
 * if (SINGLE_MIGRATION_STATUSES.includes(status)) {
 *   // Valid migration status
 * }
 * ```
 */
export const SINGLE_MIGRATION_STATUSES: readonly SingleMigrationStatus[] = [
  "synced",
  "pending",
  "generated",
  "applied",
  "failed",
] as const;

/**
 * All supported Single access operations.
 *
 * Unlike Collections which have create/read/update/delete,
 * Singles only support read and update operations.
 *
 * @example
 * ```typescript
 * for (const op of SINGLE_ACCESS_OPERATIONS) {
 *   const rule = accessRules[op];
 *   // ...
 * }
 * ```
 */
export const SINGLE_ACCESS_OPERATIONS: readonly (keyof SingleAccessRules)[] = [
  "read",
  "update",
] as const;
