/**
 * Define Single Helper
 *
 * Provides the `defineSingle()` function for creating code-first Single
 * configurations with full TypeScript support. This is the primary API for
 * defining Singles in TypeScript files.
 *
 * Singles are single-document entities for storing site-wide configuration
 * such as site settings, navigation menus, footers, and homepage configurations.
 *
 * Key differences from Collections:
 * - Only one document per Single (no list view)
 * - No create/delete operations (auto-created on first access)
 * - Simplified hooks (4 vs 8 for Collections)
 * - Simplified access control (read/update only)
 * - No timestamps configuration (always has updatedAt)
 * - No pagination options
 *
 * @module singles/config/define-single
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { defineSingle, text, upload, array } from 'nextly';
 *
 * export default defineSingle({
 *   slug: 'site-settings',
 *   label: { singular: 'Site Settings' },
 *   fields: [
 *     text({ name: 'siteName', required: true }),
 *     text({ name: 'tagline' }),
 *     upload({ name: 'logo', relationTo: 'media' }),
 *   ],
 *   access: {
 *     read: true,
 *     update: ({ roles }) => roles.includes('admin'),
 *   },
 * });
 * ```
 */

import type {
  AuthorableFieldConfig,
  FieldConfig,
} from "../../collections/fields/types";
import type { SingleAccessControl } from "../../domains/auth/services/access-control-types";
import { columnsDeclaredBy } from "../../domains/schema/services/field-column-descriptor";

import type {
  SingleConfig,
  SingleLabel,
  SingleAdminOptions,
  SingleHooks,
  SinglePreviewConfig,
} from "./types";
import { assertValidSingleConfig } from "./validate-single";

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
 * toTitleCase('site-settings') // 'Site Settings'
 * toTitleCase('header_nav') // 'Header Nav'
 * toTitleCase('footer') // 'Footer'
 * ```
 */
function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

// ============================================================
// defineSingle Function
// ============================================================

/**
 * Define a code-first Single with full type safety.
 *
 * This is the primary API for creating Single configurations in TypeScript.
 * It validates the configuration, applies sensible defaults, and returns a
 * normalized `SingleConfig` object.
 *
 * **Defaults Applied:**
 * - `label.singular`: Generated from slug (e.g., 'site-settings' → 'Site Settings')
 * - `admin`: Empty object if not provided
 *
 * **Validation:**
 * - Slug must be valid (lowercase, URL-friendly, not reserved)
 * - Fields array must be non-empty
 * - Access functions must be functions (if provided)
 *
 * @param config - The Single configuration
 * @returns Normalized Single configuration with defaults applied
 * @throws Error if configuration is invalid
 *
 * @example Basic Single
 * ```typescript
 * import { defineSingle, text } from 'nextly';
 *
 * export default defineSingle({
 *   slug: 'site-settings',
 *   fields: [
 *     text({ name: 'siteName', required: true }),
 *     text({ name: 'tagline' }),
 *   ],
 * });
 * ```
 *
 * @example Single with Admin Options
 * ```typescript
 * import { defineSingle, text, upload, group, array } from 'nextly';
 *
 * export default defineSingle({
 *   slug: 'site-settings',
 *   label: { singular: 'Site Settings' },
 *   admin: {
 *     group: 'Settings',
 *     icon: 'Settings',
 *     description: 'Site configuration',
 *   },
 *   fields: [
 *     text({ name: 'siteName', required: true, label: 'Site Name' }),
 *     text({ name: 'tagline', label: 'Tagline' }),
 *     upload({ name: 'logo', relationTo: 'media', label: 'Logo' }),
 *     upload({ name: 'favicon', relationTo: 'media', label: 'Favicon' }),
 *     group({
 *       name: 'seo',
 *       label: 'SEO Defaults',
 *       fields: [
 *         text({ name: 'metaTitle', label: 'Default Meta Title' }),
 *         text({ name: 'metaDescription', label: 'Default Meta Description' }),
 *       ],
 *     }),
 *     array({
 *       name: 'socialLinks',
 *       label: 'Social Links',
 *       fields: [
 *         text({ name: 'platform', required: true }),
 *         text({ name: 'url', required: true }),
 *       ],
 *     }),
 *   ],
 *   access: {
 *     read: () => true,
 *     update: ({ req }) => req.user?.role === 'admin',
 *   },
 *   hooks: {
 *     afterChange: [
 *       async ({ doc }) => {
 *         // Revalidate frontend cache
 *         await fetch('/api/revalidate?tag=site-settings', { method: 'POST' });
 *       },
 *     ],
 *   },
 * });
 * ```
 *
 * @example Header Navigation Single
 * ```typescript
 * import { defineSingle, array, text, relationship } from 'nextly';
 *
 * export default defineSingle({
 *   slug: 'header',
 *   label: { singular: 'Header Navigation' },
 *   admin: {
 *     group: 'Navigation',
 *     icon: 'Menu',
 *   },
 *   fields: [
 *     array({
 *       name: 'navItems',
 *       label: 'Navigation Items',
 *       fields: [
 *         text({ name: 'label', required: true }),
 *         text({ name: 'url' }),
 *         relationship({ name: 'page', relationTo: 'pages' }),
 *       ],
 *     }),
 *   ],
 * });
 * ```
 */
/**
 * A single as an author writes it: `SingleConfig` with a fields array that
 * also admits a contributed type declared through `pluginField()`.
 */

/**
 * The authored fields as the rest of the system reads them.
 *
 * A contributed declaration is structurally a field — a name, a type, and the
 * options its own type reads — and every internal consumer dispatches on
 * `type` as a string. The authoring widening exists so a plugin type can be
 * written down; it is dropped at this boundary, after validation, rather than
 * carried into the union every reader shares, where an index-signature member
 * would widen property access for all of them.
 */
function asDeclaredFields(fields: AuthorableFieldConfig[]): FieldConfig[] {
  return fields as FieldConfig[];
}

export type SingleConfigInput = Omit<SingleConfig, "fields"> & {
  fields: AuthorableFieldConfig[];
};

export function defineSingle(config: SingleConfigInput): SingleConfig {
  // ============================================================
  // Comprehensive Validation
  // ============================================================

  // Use the comprehensive validator that checks:
  // - Slug format, reserved names, SQL keywords
  // - Field names (format, duplicates, SQL keywords)
  // - Field-specific validation (select options, relationship targets, etc.)
  // - Nested field validation (array, group, blocks)
  // - Access function type validation (read/update only)
  // Validated as declared; narrowed to the shared union only after.
  assertValidSingleConfig({
    ...config,
    fields: asDeclaredFields(config.fields),
  });

  // ============================================================
  // Auto-inject system fields (title, slug)
  // ============================================================
  // Every Single has title and slug as system-level columns in its DB table
  // (createDefaultDocument always writes them). If the user already defined
  // fields with these names, their definitions take priority.

  // Keyed by the COLUMN each field becomes, not by its declared name. A field named `Title` owns
  // the `title` column, so injecting the system one beside it declares that column twice and the
  // table cannot be created — the injection has to ask the same question the generators do.
  const userFieldColumns = columnsDeclaredBy(config.fields);

  const systemFields: FieldConfig[] = [];

  if (!userFieldColumns.has("title")) {
    systemFields.push({
      type: "text",
      name: "title",
      label: "Title",
      required: true,
      // i18n: the auto-injected system title is SHARED by default, matching
      // collections (define-collection.ts). Localizing title/slug is a deliberate
      // opt-in via a user-defined localized field, not a side effect of text fields
      // localizing by default — otherwise a localized single would relocate its
      // identity columns into the companion `_locales` table.
      localized: false,
    });
  }

  if (!userFieldColumns.has("slug")) {
    systemFields.push({
      type: "text",
      name: "slug",
      label: "Slug",
      required: true,
      unique: true,
      // i18n: auto-injected system slug is SHARED by default (see title above).
      localized: false,
    });
  }

  const fieldsWithSystem = [
    ...systemFields,
    ...asDeclaredFields(config.fields),
  ];

  // ============================================================
  // Apply Defaults
  // ============================================================

  // Generate label from slug if not provided
  const label: SingleLabel = {
    singular: config.label?.singular ?? toTitleCase(config.slug),
  };

  // Build normalized config with defaults
  const normalized: SingleConfig = {
    ...config,
    fields: fieldsWithSystem,
    label,
    admin: {
      ...config.admin,
      // `internal: true` implies hidden-from-nav (D30); explicit admin.hidden wins.
      hidden: config.internal === true ? true : config.admin?.hidden,
    },
  };

  return normalized;
}

// ============================================================
// Re-exports for Convenience
// ============================================================

export type {
  SingleConfig,
  SingleLabel,
  SingleAdminOptions,
  SingleHooks,
  SinglePreviewConfig,
};
export type { SingleAccessControl };
