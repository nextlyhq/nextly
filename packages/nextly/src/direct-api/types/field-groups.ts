/**
 * Direct API Field Groups Type Definitions
 *
 * Type-safe field group slug resolution and argument types for the
 * `nextly.fieldGroups.*` namespace.
 *
 * @packageDocumentation
 */

import type { DirectAPIConfig, GeneratedTypes } from "./shared";

/**
 * Field group slug type.
 *
 * When generated types exist, this resolves to a union of valid field group
 * slug literals (e.g., `'seo' | 'hero'`). Without generated types,
 * falls back to `string`.
 *
 * The key here MUST match the one `TypeGenerator` emits into `Config`. If the
 * two drift, this conditional silently takes the fallback branch and every slug
 * widens to `string` — no compile error anywhere, just lost type safety.
 *
 * The conditional is factored into `FieldGroupSlugFrom` so a test can apply it
 * to a stand-in for the generated types. Asserting against a locally re-declared
 * copy of the same conditional would pass even if THIS alias read the wrong key,
 * which is the failure being guarded. Pinned by
 * `__tests__/generated-config-contract.test.ts`.
 */
export type FieldGroupSlugFrom<TGenerated> = TGenerated extends {
  fieldGroups: infer C;
}
  ? keyof C & string
  : string;

export type FieldGroupSlug = FieldGroupSlugFrom<GeneratedTypes>;

/**
 * Resolves the field group type for a given field group slug.
 *
 * @typeParam TSlug - The field group slug string literal
 */
export type DataFromFieldGroupSlugFrom<
  TGenerated,
  TSlug extends string,
> = TGenerated extends { fieldGroups: infer C }
  ? TSlug extends keyof C
    ? C[TSlug]
    : Record<string, unknown>
  : Record<string, unknown>;

export type DataFromFieldGroupSlug<TSlug extends string> =
  DataFromFieldGroupSlugFrom<GeneratedTypes, TSlug>;

/**
 * Field group definition data returned by the Direct API.
 *
 * This is the metadata about a field group definition, not the instance data.
 * Instance data is automatically populated when reading collection/single entries
 * that have field group fields.
 */
export interface FieldGroupDefinition {
  /** Unique identifier */
  id: string;

  /** Field group slug */
  slug: string;

  /** Display label */
  label: string;

  /** Database table name (e.g., 'comp_seo') */
  tableName: string;

  /** Optional description */
  description?: string;

  /** Field configurations */
  fields: Record<string, unknown>[];

  /** Admin UI configuration */
  admin?: {
    /** Category for organizing field groups */
    category?: string;
    /** Icon identifier */
    icon?: string;
    /** Whether hidden from UI navigation */
    hidden?: boolean;
    /** Description text */
    description?: string;
    /** Preview image URL */
    imageURL?: string;
  };

  /**
   * Whether this field group stores translatable values per locale.
   *
   * `true` means its translatable columns live in `comp_<slug>_locales` rather than on the main
   * table. Always present: the setting is a fact about the stored field group, and reporting
   * `undefined` for a non-localized one would make "not localized" indistinguishable from "this
   * client is too old to know", which is the distinction a caller comparing before and after a
   * toggle depends on.
   */
  localized: boolean;

  /** Source of the field group definition */
  source: "code" | "ui";

  /** Whether the field group is locked (code-first field groups are locked) */
  locked: boolean;

  /** Path to config file (code-first only) */
  configPath?: string;

  /** Schema hash for change detection */
  schemaHash: string;

  /** Schema version number */
  schemaVersion: number;

  /** Migration status */
  migrationStatus:
    | "synced"
    | "pending"
    | "generated"
    | "applied"
    | "failed"
    | "diverged";

  /** Last applied migration ID */
  lastMigrationId?: string;

  /** ID of user who created this field group */
  createdBy?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Arguments for finding field group definitions.
 *
 * @example
 * ```typescript
 * // List all field groups
 * const fieldGroups = await nextly.fieldGroups.find();
 *
 * // List with filters
 * const uiFieldGroups = await nextly.fieldGroups.find({
 *   source: 'ui',
 *   search: 'hero',
 *   limit: 10,
 * });
 * ```
 */
export interface FindFieldGroupsArgs extends DirectAPIConfig {
  /** Filter by source type */
  source?: "code" | "ui";

  /** Filter by migration status */
  migrationStatus?:
    | "synced"
    | "pending"
    | "generated"
    | "applied"
    | "failed"
    | "diverged";

  /** Include only locked or unlocked field groups */
  locked?: boolean;

  /** Search query for filtering by slug or label */
  search?: string;

  /** Maximum number of results */
  limit?: number;

  /** Number of results to skip (for pagination) */
  offset?: number;
}

/**
 * Arguments for finding a field group definition by slug.
 *
 * @example
 * ```typescript
 * const fieldGroup = await nextly.fieldGroups.findBySlug({ slug: 'seo' });
 * if (fieldGroup) {
 *   console.log('Fields:', fieldGroup.fields);
 * }
 * ```
 */
export interface FindFieldGroupBySlugArgs extends DirectAPIConfig {
  /** Field group slug (required) */
  slug: string;
}

/**
 * Arguments for creating a field group definition.
 *
 * Only UI-created field groups can be created via the Direct API.
 * Code-first field groups are synced automatically (HMR listener or
 * `nextly db:sync`).
 *
 * @example
 * ```typescript
 * const fieldGroup = await nextly.fieldGroups.create({
 *   slug: 'testimonial',
 *   label: 'Testimonial',
 *   fields: [
 *     { type: 'text', name: 'quote', required: true },
 *     { type: 'text', name: 'author' },
 *     { type: 'upload', name: 'avatar', relationTo: 'media' },
 *   ],
 *   admin: {
 *     category: 'Blocks',
 *     icon: 'Quote',
 *   },
 * });
 * ```
 */
export interface CreateFieldGroupArgs extends DirectAPIConfig {
  /** Field group slug (required) */
  slug: string;

  /** Display label (required) */
  label: string;

  /** Field configurations (required) */
  fields: Record<string, unknown>[];

  /** Optional description */
  description?: string;

  /** Admin UI configuration */
  admin?: {
    /** Category for organizing field groups */
    category?: string;
    /** Icon identifier */
    icon?: string;
    /** Whether hidden from UI navigation */
    hidden?: boolean;
    /** Description text */
    description?: string;
    /** Preview image URL */
    imageURL?: string;
  };
}

/**
 * Arguments for updating a field group definition.
 *
 * Code-first (locked) field groups cannot be updated via the Direct API.
 *
 * @example
 * ```typescript
 * const updated = await nextly.fieldGroups.update({
 *   slug: 'testimonial',
 *   data: {
 *     label: 'Customer Testimonial',
 *     admin: { category: 'Social Proof' },
 *   },
 * });
 * ```
 */
export interface UpdateFieldGroupArgs extends DirectAPIConfig {
  /** Field group slug (required) */
  slug: string;

  /** Update data */
  data: {
    /** Updated display label */
    label?: string;

    /** Updated description */
    description?: string;

    /** Updated field configurations */
    fields?: Record<string, unknown>[];

    /**
     * Whether this field group stores translatable values per locale.
     *
     * Omitted leaves the persisted setting alone. Changing it MOVES DATA: enabling seeds the
     * companion table from the main one and drops those columns, disabling restores and archives
     * them. Enabling requires the app's `localization` config, without which the tables would take
     * a shape the runtime cannot write to.
     */
    localized?: boolean;

    /** Updated admin configuration */
    admin?: {
      category?: string;
      icon?: string;
      hidden?: boolean;
      description?: string;
      imageURL?: string;
    };
  };
}

/**
 * Arguments for deleting a field group definition.
 *
 * Deletion will fail if:
 * - The field group is locked (code-first)
 * - Any collection, single, or other field group references this field group
 *
 * @example
 * ```typescript
 * const result = await nextly.fieldGroups.delete({ slug: 'testimonial' });
 * console.log(result.message);    // e.g. "Field group deleted."
 * console.log(result.item.slug);  // "testimonial"
 * ```
 */
export interface DeleteFieldGroupArgs extends DirectAPIConfig {
  /** Field group slug (required) */
  slug: string;
}
