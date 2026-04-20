/**
 * Direct API Singles/Globals Type Definitions
 *
 * Argument and result types for single (global) CRUD, metadata listing,
 * and related operations.
 *
 * @packageDocumentation
 */

import type { DirectAPIConfig, PopulateOptions, SingleSlug } from "./shared";

/**
 * Arguments for retrieving a single/global document.
 *
 * @example
 * ```typescript
 * const settings = await nextly.findGlobal({
 *   slug: 'site-settings',
 *   depth: 1,
 * });
 * ```
 */
export interface FindGlobalArgs<TSlug extends SingleSlug = SingleSlug>
  extends DirectAPIConfig {
  /** Single/global slug (required) */
  slug: TSlug;

  /**
   * Specific fields to include/exclude.
   */
  select?: Record<string, boolean>;

  /**
   * Control relationship population per field.
   */
  populate?: Record<string, boolean | PopulateOptions>;
}

/**
 * Arguments for updating a single/global document.
 *
 * @typeParam TSlug - The single slug literal type (auto-inferred from `slug`)
 *
 * @example
 * ```typescript
 * await nextly.updateGlobal({
 *   slug: 'site-settings',
 *   data: {
 *     siteName: 'My Site',
 *     maintenanceMode: false,
 *   },
 * });
 * ```
 */
export interface UpdateGlobalArgs<TSlug extends SingleSlug = SingleSlug>
  extends DirectAPIConfig {
  /** Single/global slug (required) */
  slug: TSlug;

  /** Update data (required) */
  data: Record<string, unknown>;

  /**
   * Autosave draft instead of publishing.
   *
   * @default false
   */
  draft?: boolean;
}

/**
 * Single/Global definition metadata returned by the Direct API.
 *
 * This is the schema-level metadata about a registered Single type,
 * not the actual content. Use `findGlobal({ slug })` to fetch content.
 */
export interface SingleDefinition {
  /** Unique identifier */
  id: string;

  /** Single slug (e.g., 'site-settings') */
  slug: string;

  /** Display label */
  label: string;

  /** Database table name (e.g., 'single_site_settings') */
  tableName: string;

  /** Field configurations */
  fields: Record<string, unknown>[];

  /** Source of the Single definition */
  source: "code" | "ui" | "built-in";

  /** Whether the Single is locked from UI edits (code-first Singles are always locked) */
  locked: boolean;

  /** Path to config file (code-first only) */
  configPath?: string;

  /** Schema hash for change detection */
  schemaHash: string;

  /** Schema version number */
  schemaVersion: number;

  /** Migration status */
  migrationStatus: "synced" | "pending" | "generated" | "applied" | "failed";

  /** Last applied migration ID */
  lastMigrationId?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Arguments for listing the actual content of all registered Single types.
 *
 * @example
 * ```typescript
 * // Fetch content for all registered Singles
 * const result = await nextly.findGlobals();
 * result.docs.forEach(({ slug, data }) => console.log(slug, data));
 *
 * // Filter by source
 * const codeSingles = await nextly.findGlobals({ source: 'code' });
 *
 * // Search by name
 * const settingsSingles = await nextly.findGlobals({ search: 'settings' });
 * ```
 */
export interface FindGlobalsArgs extends DirectAPIConfig {
  /** Filter by source type */
  source?: "code" | "ui" | "built-in";

  /** Filter by migration status */
  migrationStatus?: "synced" | "pending" | "generated" | "applied" | "failed";

  /** Include only locked or unlocked Singles */
  locked?: boolean;

  /** Search query for filtering by slug or label */
  search?: string;

  /** Maximum number of results */
  limit?: number;

  /** Number of results to skip (for pagination) */
  offset?: number;
}

/**
 * A single entry returned by `findGlobals`, pairing the slug with the
 * actual document content of that Single type.
 */
export interface GlobalEntry {
  /** The single slug (e.g., 'site-settings') */
  slug: string;

  /** The display label/title for this Single */
  label: string;

  /** The actual document content */
  data: Record<string, unknown>;
}

/**
 * Result of `findGlobals` — the actual content for each matching Single type.
 */
export interface SingleListResult {
  /** Single entries with actual document content */
  docs: GlobalEntry[];

  /** Total count of matching Singles (before pagination) */
  totalDocs: number;

  /** Number of results returned */
  limit: number;

  /** Number of results skipped */
  offset: number;
}
