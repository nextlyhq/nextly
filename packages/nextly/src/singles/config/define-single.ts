/**
 * Define Single Helper
 *
 * Provides the `defineSingle()` function for creating code-first Single
 * configurations with full TypeScript support. This is the primary API for
 * defining Singles (global documents) in TypeScript files.
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
 * import { defineSingle, text, upload, array } from '@revnixhq/nextly';
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

import type { FieldConfig } from "../../collections/fields/types";
import type { SingleAccessControl } from "../../services/auth/access-control-types";

import type {
  SingleConfig,
  SingleLabel,
  SingleAdminOptions,
  SingleHooks,
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
 * import { defineSingle, text } from '@revnixhq/nextly';
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
 * import { defineSingle, text, upload, group, array } from '@revnixhq/nextly';
 *
 * export default defineSingle({
 *   slug: 'site-settings',
 *   label: { singular: 'Site Settings' },
 *   admin: {
 *     group: 'Settings',
 *     icon: 'Settings',
 *     description: 'Global site configuration',
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
 * import { defineSingle, array, text, relationship } from '@revnixhq/nextly';
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
export function defineSingle(config: SingleConfig): SingleConfig {
  // ============================================================
  // Comprehensive Validation
  // ============================================================

  // Use the comprehensive validator that checks:
  // - Slug format, reserved names, SQL keywords
  // - Field names (format, duplicates, SQL keywords)
  // - Field-specific validation (select options, relationship targets, etc.)
  // - Nested field validation (array, group, blocks)
  // - Access function type validation (read/update only)
  assertValidSingleConfig(config);

  // ============================================================
  // Auto-inject system fields (title, slug)
  // ============================================================
  // Every Single has title and slug as system-level columns in its DB table
  // (createDefaultDocument always writes them). If the user already defined
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

  const fieldsWithSystem = [...systemFields, ...config.fields];

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
    },
  };

  return normalized;
}

// ============================================================
// Re-exports for Convenience
// ============================================================

export type { SingleConfig, SingleLabel, SingleAdminOptions, SingleHooks };
export type { SingleAccessControl };
