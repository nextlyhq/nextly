/**
 * Direct API Singles Type Definitions
 *
 * Argument and result types for single (global) CRUD, metadata listing,
 * and related operations.
 *
 * @packageDocumentation
 */

import type {
  DirectAPIConfig,
  PopulateOptions,
  RowFromSingleSlug,
  RunAsPrincipal,
  SingleSlug,
} from "./shared";

/**
 * What `findSingle` resolves to, by what the call says about
 * `createIfMissing`.
 *
 * `null` is part of the answer only when the call may pass `false`: left out
 * or `true`, the read creates a missing document and always has one to return,
 * so every existing call keeps its non-null row type. `TCreate` is inferred
 * from the argument, and a `boolean` that may be either distributes to the
 * union of both answers.
 */
export type FoundSingle<
  TSlug extends SingleSlug,
  TCreate extends boolean | undefined,
> = TCreate extends false
  ? RowFromSingleSlug<TSlug> | null
  : RowFromSingleSlug<TSlug>;

/**
 * Arguments for retrieving a single document.
 *
 * @example
 * ```typescript
 * const settings = await nextly.findSingle({
 *   slug: 'site-settings',
 *   depth: 1,
 * });
 * ```
 */
export interface FindSingleArgs<TSlug extends SingleSlug = SingleSlug>
  extends DirectAPIConfig,
    RunAsPrincipal {
  /** Single slug (required) */
  slug: TSlug;

  /**
   * Return the pending working draft in place of the live document when one
   * exists (draft/published split). Mirrors `draft` on `findByID`, and forwards
   * to the same service option, so a Single and a collection entry are read the
   * same way rather than through two spellings of one idea.
   *
   * Gated by trust in the service: a caller who cannot edit the document still
   * gets the published values, so this never exposes a draft to a read-only
   * caller.
   *
   * @default false
   */
  draft?: boolean;

  /**
   * Which lifecycle states this read may return, for a Single carrying the
   * `status` column.
   *
   * `"all"` is what reaches a Single that has never been published — the state a
   * preview link is most often shared from — which the default published-only
   * filter reports as missing.
   */
  status?: "published" | "draft" | "all";

  /**
   * The fields to answer with, meaning what it means on a collection read: a
   * field named `true` is included, a `false` entry is ignored, and a
   * selection that includes nothing answers the whole document. The id and
   * the system timestamps are always answered.
   *
   * Where no read hook or field read rule needs the rest of the document, the
   * read takes only the selected fields' columns, so a field whose column the
   * database does not have yet fails only a read that selects it.
   */
  select?: Record<string, boolean>;

  /**
   * Control relationship population per field.
   */
  populate?: Record<string, boolean | PopulateOptions>;

  /**
   * Whether reading a Single that has no stored document yet creates its
   * default document first, which is what every read has always done.
   *
   * Pass `false` to read without writing: a Single with no document answers
   * `null`, and nothing is created — no row, no version, no event and no
   * creation hook. A Single whose document exists answers the same either way.
   * The return type includes `null` only when this may be `false`.
   *
   * @default true
   */
  createIfMissing?: boolean;

  /**
   * With `createIfMissing: false`, what a Single with no stored document
   * answers. `"default"` answers the default document a creating read would
   * store, through the same read (access rules, lifecycle filter, field rules
   * and read hooks), without storing anything: so a caller can see what the
   * Single will hold once it is first read. Refused unless `createIfMissing`
   * is `false`, since a creating read answers the created document anyway.
   *
   * A default computed by a function is computed again for each such read, so
   * a function that is not deterministic may answer differently from what is
   * later stored.
   *
   * @experimental
   */
  whenAbsent?: "default";
}

/**
 * Arguments for updating a single document.
 *
 * An update says which version it changes, the `_rev` from the read it was
 * made from, or that it replaces whatever is stored (`_overwrite: true`).
 * One that says neither is refused with `VERSION_REQUIRED`.
 *
 * @typeParam TSlug - The single slug literal type (auto-inferred from `slug`)
 *
 * @example
 * ```typescript
 * const settings = await nextly.findSingle({ slug: 'site-settings' });
 * await nextly.updateSingle({
 *   slug: 'site-settings',
 *   data: {
 *     siteName: 'My Site',
 *     maintenanceMode: false,
 *     _rev: settings?._rev,
 *   },
 * });
 * ```
 */
export interface UpdateSingleArgs<TSlug extends SingleSlug = SingleSlug>
  extends DirectAPIConfig,
    RunAsPrincipal {
  /** Single slug (required) */
  slug: TSlug;

  /** Update data (required) */
  data: Record<string, unknown>;

  /**
   * Autosave draft instead of publishing.
   *
   * @default false
   */
  draft?: boolean;

  /**
   * Skip cache revalidation for this write (the outbox drain still runs). Set by
   * a CLI, seed, or bulk-import caller that owns its own cache strategy.
   *
   * @default false
   */
  disableRevalidate?: boolean;
}

/**
 * Single definition metadata returned by the Direct API.
 *
 * This is the schema-level metadata about a registered Single type,
 * not the actual content. Use `findSingle({ slug })` to fetch content.
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
 * const result = await nextly.findSingles();
 * result.docs.forEach(({ slug, data }) => console.log(slug, data));
 *
 * // Filter by source
 * const codeSingles = await nextly.findSingles({ source: 'code' });
 *
 * // Search by name
 * const settingsSingles = await nextly.findSingles({ search: 'settings' });
 * ```
 */
export interface FindSinglesArgs extends DirectAPIConfig, RunAsPrincipal {
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
 * A single entry returned by `findSingles`, pairing the slug with the
 * actual document content of that Single type.
 */
export interface SingleEntry {
  /** The single slug (e.g., 'site-settings') */
  slug: string;

  /** The display label/title for this Single */
  label: string;

  /** The actual document content */
  data: Record<string, unknown>;
}

/**
 * Result of `findSingles` — the actual content for each matching Single type.
 */
export interface SingleListResult {
  /** Single entries with actual document content */
  docs: SingleEntry[];

  /** Total count of matching Singles (before pagination) */
  totalDocs: number;

  /** Number of results returned */
  limit: number;

  /** Number of results skipped */
  offset: number;
}
