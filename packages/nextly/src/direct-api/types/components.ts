/**
 * Direct API Components Type Definitions
 *
 * Type-safe component slug resolution and argument types for the
 * `nextly.components.*` namespace.
 *
 * @packageDocumentation
 */

import type { DirectAPIConfig, GeneratedTypes } from "./shared";

/**
 * Component slug type.
 *
 * When generated types exist, this resolves to a union of valid component
 * slug literals (e.g., `'seo' | 'hero'`). Without generated types,
 * falls back to `string`.
 */
export type ComponentSlug = GeneratedTypes extends { components: infer C }
  ? keyof C & string
  : string;

/**
 * Resolves the component type for a given component slug.
 *
 * @typeParam TSlug - The component slug string literal
 */
export type DataFromComponentSlug<TSlug extends string> =
  GeneratedTypes extends { components: infer C }
    ? TSlug extends keyof C
      ? C[TSlug]
      : Record<string, unknown>
    : Record<string, unknown>;

/**
 * Component definition data returned by the Direct API.
 *
 * This is the metadata about a component definition, not the instance data.
 * Instance data is automatically populated when reading collection/single entries
 * that have component fields.
 */
export interface ComponentDefinition {
  /** Unique identifier */
  id: string;

  /** Component slug */
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
    /** Category for organizing components */
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

  /** Source of the component definition */
  source: "code" | "ui";

  /** Whether the component is locked (code-first components are locked) */
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

  /** ID of user who created this component */
  createdBy?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Arguments for finding component definitions.
 *
 * @example
 * ```typescript
 * // List all components
 * const components = await nextly.components.find();
 *
 * // List with filters
 * const uiComponents = await nextly.components.find({
 *   source: 'ui',
 *   search: 'hero',
 *   limit: 10,
 * });
 * ```
 */
export interface FindComponentsArgs extends DirectAPIConfig {
  /** Filter by source type */
  source?: "code" | "ui";

  /** Filter by migration status */
  migrationStatus?: "synced" | "pending" | "generated" | "applied" | "failed";

  /** Include only locked or unlocked components */
  locked?: boolean;

  /** Search query for filtering by slug or label */
  search?: string;

  /** Maximum number of results */
  limit?: number;

  /** Number of results to skip (for pagination) */
  offset?: number;
}

/**
 * Arguments for finding a component definition by slug.
 *
 * @example
 * ```typescript
 * const component = await nextly.components.findBySlug({ slug: 'seo' });
 * if (component) {
 *   console.log('Fields:', component.fields);
 * }
 * ```
 */
export interface FindComponentBySlugArgs extends DirectAPIConfig {
  /** Component slug (required) */
  slug: string;
}

/**
 * Arguments for creating a component definition.
 *
 * Only UI-created components can be created via the Direct API.
 * Code-first components are synced automatically via `nextly dev`.
 *
 * @example
 * ```typescript
 * const component = await nextly.components.create({
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
export interface CreateComponentArgs extends DirectAPIConfig {
  /** Component slug (required) */
  slug: string;

  /** Display label (required) */
  label: string;

  /** Field configurations (required) */
  fields: Record<string, unknown>[];

  /** Optional description */
  description?: string;

  /** Custom database table name (defaults to 'comp_{slug}') */
  tableName?: string;

  /** Admin UI configuration */
  admin?: {
    /** Category for organizing components */
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
 * Arguments for updating a component definition.
 *
 * Code-first (locked) components cannot be updated via the Direct API.
 *
 * @example
 * ```typescript
 * const updated = await nextly.components.update({
 *   slug: 'testimonial',
 *   data: {
 *     label: 'Customer Testimonial',
 *     admin: { category: 'Social Proof' },
 *   },
 * });
 * ```
 */
export interface UpdateComponentArgs extends DirectAPIConfig {
  /** Component slug (required) */
  slug: string;

  /** Update data */
  data: {
    /** Updated display label */
    label?: string;

    /** Updated description */
    description?: string;

    /** Updated field configurations */
    fields?: Record<string, unknown>[];

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
 * Arguments for deleting a component definition.
 *
 * Deletion will fail if:
 * - The component is locked (code-first)
 * - Any collection, single, or other component references this component
 *
 * @example
 * ```typescript
 * const result = await nextly.components.delete({ slug: 'testimonial' });
 * // Phase 4 (Task 13): delete returns MutationResult<{ slug }>.
 * console.log(result.message);    // e.g. "Component deleted successfully"
 * console.log(result.item.slug);  // "testimonial"
 * ```
 */
export interface DeleteComponentArgs extends DirectAPIConfig {
  /** Component slug (required) */
  slug: string;
}

/**
 * Result of listing component definitions.
 *
 * @deprecated Phase 4 (Task 13): `nextly.components.find()` now returns
 * `ListResult<ComponentDefinition>` (`{ items, meta }`). This legacy
 * shape is retained only for transitional consumer code and is removed
 * in Task 23 cleanup.
 */
export interface ComponentListResult {
  /** Component definitions */
  docs: ComponentDefinition[];

  /** Total count of matching components */
  totalDocs: number;

  /** Number of results returned */
  limit: number;

  /** Number of results skipped */
  offset: number;
}
