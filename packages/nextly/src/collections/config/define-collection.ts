/**
 * Define Collection Helper
 *
 * Provides the `defineCollection()` function for creating code-first collection
 * configurations with full TypeScript support. This is the primary API for
 * defining collections in TypeScript files.
 *
 * @module collections/config/define-collection
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { defineCollection, text, relationship } from '@nextly/core';
 *
 * export default defineCollection({
 *   slug: 'posts',
 *   labels: {
 *     singular: 'Post',
 *     plural: 'Posts',
 *   },
 *   fields: [
 *     text({ name: 'title', required: true }),
 *     text({ name: 'slug', unique: true }),
 *     relationship({ name: 'author', relationTo: 'users' }),
 *   ],
 *   access: {
 *     read: true,
 *     create: ({ roles }) => roles.includes('editor') || roles.includes('admin'),
 *   },
 * });
 * ```
 */

import type { HookHandler } from "@nextly/hooks/types";

import type { CollectionAccessControl } from "../../services/auth/access-control-types";
import { simplePluralize } from "../../shared/lib/pluralization";
import type { FieldConfig } from "../fields/types";

// Import validation conditionally - only in server environments
// This prevents client-side bundlers from including the validation code
import { assertValidCollectionConfig } from "./validate-config";

// ============================================================
// Collection Labels
// ============================================================

/**
 * Display labels for a collection.
 *
 * Used in the Admin UI to display human-readable names for the collection.
 * If not provided, labels are auto-generated from the slug.
 *
 * @example
 * ```typescript
 * const labels: CollectionLabels = {
 *   singular: 'Blog Post',
 *   plural: 'Blog Posts',
 * };
 * ```
 */
export interface CollectionLabels {
  /**
   * Singular form of the collection name.
   * Used when referring to a single document (e.g., "Create Post").
   */
  singular?: string;

  /**
   * Plural form of the collection name.
   * Used when referring to multiple documents (e.g., "All Posts").
   */
  plural?: string;
}

// ============================================================
// Admin Options
// ============================================================

/**
 * Pagination configuration for the collection list view.
 *
 * @example
 * ```typescript
 * const pagination: CollectionPagination = {
 *   defaultLimit: 25,
 *   limits: [10, 25, 50, 100],
 * };
 * ```
 */
export interface CollectionPagination {
  /**
   * Default number of documents per page.
   * @default 10
   */
  defaultLimit?: number;

  /**
   * Available page size options.
   * @default [10, 25, 50, 100]
   */
  limits?: number[];
}

/**
 * Preview URL configuration for content preview workflows.
 *
 * Enables editors to preview entries before publishing by generating
 * preview URLs that can be opened in a new tab or iframe.
 *
 * @example Function-based URL
 * ```typescript
 * const preview: CollectionPreviewConfig = {
 *   url: (entry) => `/preview/posts/${entry.slug}`,
 *   label: "Preview Post",
 * };
 * ```
 *
 * @example Conditional preview availability
 * ```typescript
 * const preview: CollectionPreviewConfig = {
 *   url: (entry) => entry.slug ? `/preview/${entry.slug}` : null,
 *   openInNewTab: true,
 * };
 * ```
 */
export interface CollectionPreviewConfig {
  /**
   * Function to generate preview URL from entry data.
   *
   * Receives the current entry data (which may include unsaved changes)
   * and should return a URL string or null if preview is not available.
   *
   * @param entry - The entry data (may be unsaved/draft)
   * @returns Preview URL string or null if preview not available
   *
   * @example
   * ```typescript
   * url: (entry) => `/preview/posts/${entry.slug}`
   * url: (entry) => entry.status === 'draft' ? `/api/preview?id=${entry.id}` : null
   * ```
   */
  url: (entry: Record<string, unknown>) => string | null;

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
}

/**
 * Component path string format.
 *
 * Uses the format: `"package-name/path#ExportName"` where:
 * - `package-name/path` is the module path (e.g., `@nextly/plugin-form-builder/admin`)
 * - `#ExportName` is the named export (e.g., `#FormBuilderView`)
 *
 * @example
 * ```typescript
 * // Named export from package subpath
 * "@revnixhq/plugin-form-builder/admin#FormBuilderView"
 *
 * // Default export (no hash)
 * "@revnixhq/plugin-form-builder/admin/FormBuilderView"
 * ```
 */
export type ComponentPath = string;

/**
 * Custom view configuration for replacing default admin views.
 *
 * @example
 * ```typescript
 * const editView: CollectionAdminViewConfig = {
 *   Component: "@revnixhq/plugin-form-builder/admin#FormBuilderView",
 * };
 * ```
 */
export interface CollectionAdminViewConfig {
  /**
   * Component path to the custom view component.
   * Format: `"package-name/path#ExportName"`
   */
  Component: ComponentPath;
}

/**
 * Custom components configuration for collection admin UI.
 *
 * Allows overriding default admin views and injecting custom components
 * at specific locations in the admin interface.
 *
 * @example
 * ```typescript
 * const components: CollectionAdminComponents = {
 *   views: {
 *     Edit: {
 *       Component: "@revnixhq/plugin-form-builder/admin#FormBuilderView",
 *     },
 *   },
 *   BeforeListTable: "@revnixhq/plugin-form-builder/admin#CreateFormButton",
 * };
 * ```
 */
export interface CollectionAdminComponents {
  /**
   * Custom views to replace default admin views.
   */
  views?: {
    /**
     * Custom Edit view component.
     * Replaces the default entry edit form with a custom view.
     */
    Edit?: CollectionAdminViewConfig;

    /**
     * Custom List view component.
     * Replaces the default entry list view with a custom view.
     */
    List?: CollectionAdminViewConfig;
  };

  /**
   * Component to render before the list table.
   * Useful for custom action buttons or filters.
   */
  BeforeListTable?: ComponentPath;

  /**
   * Component to render after the list table.
   */
  AfterListTable?: ComponentPath;

  /**
   * Component to render before the edit form.
   */
  BeforeEdit?: ComponentPath;

  /**
   * Component to render after the edit form.
   */
  AfterEdit?: ComponentPath;
}

/**
 * Admin panel configuration options for a collection.
 *
 * Controls how the collection appears and behaves in the Admin UI.
 *
 * @example
 * ```typescript
 * const admin: CollectionAdminOptions = {
 *   group: 'Content',
 *   icon: 'FileText',
 *   useAsTitle: 'title',
 *   pagination: {
 *     defaultLimit: 25,
 *   },
 * };
 * ```
 *
 * @example Custom edit view
 * ```typescript
 * const admin: CollectionAdminOptions = {
 *   group: 'Forms',
 *   useAsTitle: 'name',
 *   components: {
 *     views: {
 *       Edit: {
 *         Component: "@revnixhq/plugin-form-builder/admin#FormBuilderView",
 *       },
 *     },
 *   },
 * };
 * ```
 */
export interface CollectionAdminOptions {
  /**
   * Group name for organizing collections in the sidebar.
   * Collections with the same group appear together.
   *
   * @example 'Content', 'Settings', 'Commerce'
   */
  group?: string;

  /**
   * Whether this collection is provided by a plugin.
   *
   * When `true`, the collection appears in the "Plugins" section of the sidebar
   * instead of under "Collections". This helps users distinguish between
   * their own collections and plugin-provided functionality.
   *
   * @default false
   *
   * @example
   * ```typescript
   * admin: {
   *   isPlugin: true,
   *   group: 'Forms', // Groups within the Plugins section
   * }
   * ```
   */
  isPlugin?: boolean;

  /**
   * Icon identifier for the collection.
   * Should be a valid icon name from the icon library (e.g., Lucide).
   *
   * @example 'FileText', 'Users', 'ShoppingCart'
   */
  icon?: string;

  /**
   * Hide the collection from the Admin UI navigation.
   * The collection is still accessible via direct URL and API.
   *
   * @default false
   */
  hidden?: boolean;

  /** Sort order within sidebar group (lower = higher position, default: 100) */
  order?: number;

  /** Custom sidebar group slug. When set, item moves from its default section to this custom group */
  sidebarGroup?: string;

  /**
   * Field name to use as the document title in the Admin UI.
   * This value is displayed in lists, breadcrumbs, and relationships.
   * If not specified, the document ID is used.
   *
   * @example 'title', 'name', 'email'
   */
  useAsTitle?: string;

  /**
   * Pagination configuration for the list view.
   */
  pagination?: CollectionPagination;

  /**
   * Description text displayed below the collection title.
   * Use this to provide helpful context for editors.
   */
  description?: string;

  /**
   * Preview URL configuration for content preview workflows.
   *
   * When configured, a "Preview" button appears in the entry form
   * that opens the generated URL in a new tab (or same tab if configured).
   *
   * @example
   * ```typescript
   * preview: {
   *   url: (entry) => `/preview/posts/${entry.slug}`,
   *   label: "Preview Post",
   * }
   * ```
   */
  preview?: CollectionPreviewConfig;

  /**
   * Custom components configuration for the admin UI.
   *
   * Allows overriding default views (Edit, List) and injecting
   * custom components at specific locations.
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
  components?: CollectionAdminComponents;
}

// ============================================================
// Access Control
// ============================================================

// CollectionAccessControl is imported from services/auth/access-control-types
// and re-exported from this module for convenience.
// See access-control-types.ts for the full interface definition.

// ============================================================
// Collection Hooks
// ============================================================

/**
 * Collection-level lifecycle hooks configuration.
 *
 * Hooks allow custom logic to run at specific points in a document's lifecycle.
 * All hooks receive a `HookContext` with operation metadata and can optionally
 * modify the data (for `before*` hooks).
 *
 * **Hook Execution Order:**
 * 1. `beforeOperation` - Before any operation begins
 * 2. `beforeValidate` - Before validation (create/update)
 * 3. `beforeChange` - Before database write (create/update)
 * 4. Database operation executes
 * 5. `afterChange` - After database write (create/update)
 * 6. `afterRead` - After reading from database
 * 7. `afterDelete` - After deletion
 *
 * @example
 * ```typescript
 * const hooks: CollectionHooks = {
 *   beforeChange: [
 *     async ({ data, operation }) => {
 *       if (operation === 'create') {
 *         return { ...data, slug: slugify(data.title) };
 *       }
 *       return data;
 *     },
 *   ],
 *   afterChange: [
 *     async ({ data }) => {
 *       await invalidateCache(`posts:${data.id}`);
 *     },
 *   ],
 * };
 * ```
 */
export interface CollectionHooks {
  /**
   * Runs before any operation begins.
   * Can modify operation arguments or execute side effects.
   */
  beforeOperation?: HookHandler[];

  /**
   * Runs before validation during create/update.
   * Can transform data before validation rules are applied.
   */
  beforeValidate?: HookHandler[];

  /**
   * Runs before the database write during create/update.
   * Can transform the final data to be stored.
   */
  beforeChange?: HookHandler[];

  /**
   * Runs after the database write during create/update.
   * Useful for side effects like sending notifications.
   */
  afterChange?: HookHandler[];

  /**
   * Runs before reading from the database.
   * Can modify query parameters.
   */
  beforeRead?: HookHandler[];

  /**
   * Runs after reading from the database.
   * Can transform the data before it's returned.
   */
  afterRead?: HookHandler[];

  /**
   * Runs before deleting a document.
   * Can prevent deletion by throwing an error.
   */
  beforeDelete?: HookHandler[];

  /**
   * Runs after deleting a document.
   * Useful for cleanup or cascading deletes.
   */
  afterDelete?: HookHandler[];
}

// ============================================================
// Custom Endpoints
// ============================================================

/**
 * HTTP method types for custom endpoints.
 */
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * Custom REST API endpoint configuration.
 *
 * Allows defining additional endpoints on the collection's API namespace.
 * Endpoints are mounted at `/api/[collection-slug]/[path]`.
 *
 * @example
 * ```typescript
 * const publishEndpoint: CustomEndpoint = {
 *   path: '/publish',
 *   method: 'post',
 *   handler: async (req) => {
 *     const { id } = await req.json();
 *     // Publish logic here
 *     return Response.json({ success: true });
 *   },
 * };
 * ```
 */
export interface CustomEndpoint {
  /**
   * URL path for the endpoint (relative to collection namespace).
   * Must start with '/'.
   *
   * @example '/publish', '/export', '/bulk-update'
   */
  path: string;

  /**
   * HTTP method for the endpoint.
   */
  method: HttpMethod;

  /**
   * Handler function that processes the request.
   * Receives a standard Web API Request and returns a Response.
   *
   * @param req - The incoming HTTP request
   * @returns A Response object (or Promise thereof)
   */
  handler: (req: Request) => Promise<Response> | Response;
}

// ============================================================
// Index Configuration
// ============================================================

/**
 * Configuration for a database index.
 *
 * Indexes improve query performance for frequently searched or sorted fields.
 * Use compound indexes when queries filter or sort by multiple fields together.
 *
 * @example Single compound index
 * ```typescript
 * const config: IndexConfig = {
 *   fields: ['authorId', 'createdAt'],
 * };
 * ```
 *
 * @example Unique compound index
 * ```typescript
 * const config: IndexConfig = {
 *   fields: ['slug', 'locale'],
 *   unique: true,
 *   name: 'slug_locale_unique',
 * };
 * ```
 */
export interface IndexConfig {
  /**
   * Fields to include in the index.
   *
   * For compound indexes, the order of fields matters for query optimization.
   * Place the most selective (highest cardinality) fields first.
   *
   * @example ['authorId', 'createdAt'] - Optimizes queries like `WHERE authorId = ? ORDER BY createdAt`
   */
  fields: string[];

  /**
   * Whether this is a unique index.
   *
   * Unique indexes enforce that no two documents have the same combination
   * of values for the indexed fields.
   *
   * @default false
   */
  unique?: boolean;

  /**
   * Optional custom index name.
   *
   * If not provided, a name is auto-generated using the pattern:
   * `{tableName}_{field1}_{field2}_idx` (or `_unique` for unique indexes)
   *
   * @example 'posts_author_status_idx'
   */
  name?: string;
}

// ============================================================
// Search Config
// ============================================================

/**
 * Configuration for full-text search on collection entries.
 *
 * Defines which fields are searchable and how search should behave.
 * When not configured, search will auto-detect searchable fields
 * (text, textarea, email types).
 *
 * @example
 * ```typescript
 * const config: CollectionConfig = {
 *   slug: 'posts',
 *   search: {
 *     searchableFields: ['title', 'content', 'excerpt'],
 *   },
 *   fields: [
 *     { type: 'text', name: 'title' },
 *     { type: 'textarea', name: 'content' },
 *     { type: 'textarea', name: 'excerpt' },
 *   ],
 * };
 * ```
 */
export interface SearchConfig {
  /**
   * Fields to include in search queries.
   *
   * If not specified, automatically includes all text, textarea,
   * and email fields from the collection schema.
   *
   * @example ['title', 'content', 'author.name']
   */
  searchableFields?: string[];

  /**
   * Minimum query length required to trigger search.
   * Queries shorter than this will return empty results.
   *
   * @default 2
   */
  minSearchLength?: number;
}

// ============================================================
// Collection Config
// ============================================================

/**
 * Complete collection configuration interface.
 *
 * This is the main interface for defining a collection in code.
 * Only `slug` and `fields` are required; all other properties have defaults.
 *
 * @example
 * ```typescript
 * const PostsConfig: CollectionConfig = {
 *   slug: 'posts',
 *   labels: {
 *     singular: 'Post',
 *     plural: 'Posts',
 *   },
 *   fields: [
 *     { type: 'text', name: 'title', required: true },
 *     { type: 'textarea', name: 'content' },
 *     { type: 'select', name: 'status', options: [
 *       { label: 'Draft', value: 'draft' },
 *       { label: 'Published', value: 'published' },
 *     ]},
 *   ],
 *   timestamps: true,
 *   admin: {
 *     group: 'Content',
 *     useAsTitle: 'title',
 *   },
 *   access: {
 *     read: true,
 *     create: ({ roles }) => roles.includes('editor') || roles.includes('admin'),
 *   },
 * };
 * ```
 */
export interface CollectionConfig {
  /**
   * Unique identifier for the collection.
   *
   * Used as the database table name, API endpoint, and internal reference.
   * Must be:
   * - Unique across all collections
   * - URL-friendly (lowercase, no spaces)
   * - Not a reserved name (e.g., 'users', 'media' if used by system)
   *
   * @example 'posts', 'products', 'blog-posts', 'order_items'
   */
  slug: string;

  /**
   * Field definitions for the collection.
   *
   * An array of field configurations that define the document structure.
   * Must contain at least one data-storing field.
   */
  fields: FieldConfig[];

  /**
   * Display labels for the Admin UI.
   * If not provided, labels are auto-generated from the slug.
   */
  labels?: CollectionLabels;

  /**
   * Whether to automatically add `createdAt` and `updatedAt` timestamp fields.
   *
   * When `true`, documents will have:
   * - `createdAt`: Set once when document is created
   * - `updatedAt`: Updated on every modification
   *
   * @default true
   */
  timestamps?: boolean;

  /**
   * Admin panel configuration options.
   */
  admin?: CollectionAdminOptions;

  /**
   * Collection-level access control.
   * Defines who can perform CRUD operations.
   *
   * Each operation can be:
   * - A **function** receiving `AccessControlContext` (user, roles, permissions) → returns boolean
   * - A **boolean** for simple allow/deny
   * - **Omitted** to fall back to database role/permission checks
   *
   * Code-defined access always takes precedence over database permissions.
   * Super-admin always bypasses all access checks.
   *
   * @example
   * ```typescript
   * access: {
   *   create: ({ roles }) => roles.includes('admin') || roles.includes('editor'),
   *   read: true,
   *   update: ({ roles }) => roles.includes('admin') || roles.includes('editor'),
   *   delete: ({ roles }) => roles.includes('admin'),
   * }
   * ```
   */
  access?: CollectionAccessControl;

  /**
   * Collection-level lifecycle hooks.
   * Custom logic that runs during document operations.
   */
  hooks?: CollectionHooks;

  /**
   * Custom REST API endpoints.
   * Additional endpoints mounted on the collection's API namespace.
   */
  endpoints?: CustomEndpoint[];

  /**
   * Custom metadata for plugins and extensions.
   * Store arbitrary data that can be accessed by hooks, plugins, or custom code.
   */
  custom?: Record<string, unknown>;

  /**
   * Custom database table name.
   * If not specified, the slug is used as the table name.
   *
   * Useful when you need a specific table name for legacy databases
   * or when the slug doesn't match your naming convention.
   *
   * @example 'wp_posts', 'tbl_products'
   */
  dbName?: string;

  /**
   * Description of the collection.
   * Displayed in the Admin UI and used for documentation.
   */
  description?: string;

  /**
   * Search configuration for this collection.
   *
   * Defines which fields are searchable when using the search parameter
   * in list queries. If not configured, search auto-detects searchable
   * fields (text, textarea, email types).
   *
   * @example
   * ```typescript
   * search: {
   *   searchableFields: ['title', 'content'],
   *   minSearchLength: 3,
   * }
   * ```
   */
  search?: SearchConfig;

  /**
   * Database indexes for query performance optimization.
   *
   * Use this to define compound indexes (indexes on multiple fields).
   * For single-field indexes, use `index: true` on the field itself.
   *
   * The `id`, `createdAt`, and `updatedAt` fields are indexed by default.
   *
   * @example
   * ```typescript
   * indexes: [
   *   // Compound index for filtering by author and sorting by date
   *   { fields: ['authorId', 'createdAt'] },
   *
   *   // Unique compound index for slug + locale
   *   { fields: ['slug', 'locale'], unique: true },
   *
   *   // Custom named index
   *   { fields: ['status', 'publishedAt'], name: 'posts_published_idx' },
   * ]
   * ```
   */
  indexes?: IndexConfig[];

  /**
   * Whether to enable automatic input sanitization for this collection.
   *
   * When `true` (default), the global sanitization hook strips HTML tags
   * from plain-text fields (text, textarea, email) before database storage.
   *
   * Set to `false` to disable automatic HTML tag stripping for text fields.
   * Use with caution — only disable if this collection intentionally stores
   * HTML in text fields.
   *
   * @default true
   */
  sanitize?: boolean;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Converts a slug to title case for display.
 *
 * @param str - The string to convert
 * @returns Title-cased string
 *
 * @example
 * ```typescript
 * toTitleCase('blog-posts') // 'Blog Posts'
 * toTitleCase('order_items') // 'Order Items'
 * toTitleCase('users') // 'Users'
 * ```
 */
function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

// ============================================================
// defineCollection Function
// ============================================================

/**
 * Define a code-first collection with full type safety.
 *
 * This is the primary API for creating collection configurations in TypeScript.
 * It validates the configuration, applies sensible defaults, and returns a
 * normalized `CollectionConfig` object.
 *
 * **Defaults Applied:**
 * - `labels.singular`: Generated from slug (e.g., 'blog-posts' → 'Blog Posts')
 * - `labels.plural`: Generated from singular + 's'
 * - `timestamps`: `true`
 * - `admin.pagination.defaultLimit`: `10`
 * - `admin.pagination.limits`: `[10, 25, 50, 100]`
 *
 * **Validation:**
 * - Slug must be valid (lowercase, URL-friendly, not reserved)
 * - Fields array must be non-empty
 *
 * @param config - The collection configuration
 * @returns Normalized collection configuration with defaults applied
 * @throws Error if configuration is invalid
 *
 * @example
 * ```typescript
 * import { defineCollection, text, textarea, select, relationship } from '@nextly/core';
 *
 * export default defineCollection({
 *   slug: 'posts',
 *   labels: {
 *     singular: 'Post',
 *     plural: 'Posts',
 *   },
 *   fields: [
 *     text({ name: 'title', required: true }),
 *     text({ name: 'slug', unique: true }),
 *     textarea({ name: 'excerpt' }),
 *     select({
 *       name: 'status',
 *       options: [
 *         { label: 'Draft', value: 'draft' },
 *         { label: 'Published', value: 'published' },
 *       ],
 *       defaultValue: 'draft',
 *     }),
 *     relationship({ name: 'author', relationTo: 'users' }),
 *   ],
 *   timestamps: true,
 *   admin: {
 *     group: 'Content',
 *     icon: 'FileText',
 *     useAsTitle: 'title',
 *   },
 *   access: {
 *     read: () => true,
 *     create: ({ req }) => !!req.user,
 *     update: ({ req }) => req.user?.role === 'admin' || req.user?.role === 'editor',
 *     delete: ({ req }) => req.user?.role === 'admin',
 *   },
 *   hooks: {
 *     beforeChange: [
 *       async ({ data, operation }) => {
 *         if (operation === 'create' && !data.slug) {
 *           return { ...data, slug: slugify(data.title) };
 *         }
 *         return data;
 *       },
 *     ],
 *   },
 * });
 * ```
 */
export function defineCollection(config: CollectionConfig): CollectionConfig {
  // ============================================================
  // Comprehensive Validation
  // ============================================================

  // Use the comprehensive validator that checks:
  // - Slug format, reserved names, SQL keywords
  // - Field names (format, duplicates, SQL keywords)
  // - Field-specific validation (select options, relationship targets, etc.)
  // - Nested field validation (array, group, blocks)
  // - Access function type validation
  assertValidCollectionConfig(config);

  // ============================================================
  // Auto-inject system fields (title, slug)
  // ============================================================
  // Every collection has title and slug as system-level fields,
  // matching the Schema Builder behavior. If the user already defined
  // fields with these names, their definitions take priority.

  const userFieldNames = new Set(
    config.fields
      .filter(
        (f): f is FieldConfig & { name: string } =>
          "name" in f && typeof f.name === "string"
      )
      .map(f => f.name)
  );

  const systemFields: FieldConfig[] = [];

  if (!userFieldNames.has("title")) {
    systemFields.push({
      type: "text",
      name: "title",
      label: "Title",
      required: true,
    } as FieldConfig);
  }

  if (!userFieldNames.has("slug")) {
    systemFields.push({
      type: "text",
      name: "slug",
      label: "Slug",
      required: true,
      unique: true,
    } as FieldConfig);
  }

  // Prepend system fields so they appear first in the form
  const fieldsWithSystem = [...systemFields, ...config.fields];

  // ============================================================
  // Apply Defaults
  // ============================================================

  // Generate labels from slug if not provided
  const singularLabel = config.labels?.singular ?? toTitleCase(config.slug);
  const pluralLabel = config.labels?.plural ?? simplePluralize(singularLabel);

  // Build normalized config with defaults
  const normalized: CollectionConfig = {
    ...config,
    fields: fieldsWithSystem,
    labels: {
      singular: singularLabel,
      plural: pluralLabel,
    },
    timestamps: config.timestamps ?? true,
    admin: {
      ...config.admin,
      pagination: {
        defaultLimit: config.admin?.pagination?.defaultLimit ?? 10,
        limits: config.admin?.pagination?.limits ?? [10, 25, 50, 100],
      },
    },
  };

  return normalized;
}

// ============================================================
// Re-exports for Convenience
// ============================================================

export type { FieldConfig };
export type { HookHandler };
export type { CollectionAccessControl };
