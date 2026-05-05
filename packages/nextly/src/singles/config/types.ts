/**
 * Single Configuration Types
 *
 * Type definitions for Singles.
 * Singles are single-document entities for storing site-wide configuration
 * such as site settings, navigation menus, footers, and homepage configurations.
 *
 * Key differences from Collections:
 * - Only one document per Single (no list view)
 * - No create/delete operations (auto-created on first access)
 * - Simplified hooks (4 vs 8 for Collections)
 * - Simplified access control (read/update only)
 *
 * @module singles/config/types
 * @since 1.0.0
 */

import type { FieldConfig } from "../../collections/fields/types";
import type { HookHandler } from "../../hooks/types";
import type { SingleAccessControl } from "../../services/auth/access-control-types";

// ============================================================
// Single Labels
// ============================================================

/**
 * Display label for a Single.
 *
 * Unlike Collections which have singular/plural forms, Singles only need
 * a singular label since there's always exactly one document.
 *
 * @example
 * ```typescript
 * const label: SingleLabel = {
 *   singular: 'Site Settings',
 * };
 * ```
 */
export interface SingleLabel {
  /**
   * Display name for the Single.
   * Used in the Admin UI sidebar, breadcrumbs, and page titles.
   *
   * @example 'Site Settings', 'Header Navigation', 'Footer'
   */
  singular: string;
}

// ============================================================
// Admin Options
// ============================================================

/**
 * Admin panel configuration options for a Single.
 *
 * Controls how the Single appears and behaves in the Admin UI.
 * Simpler than CollectionAdminOptions since there's no list view.
 *
 * @example
 * ```typescript
 * const admin: SingleAdminOptions = {
 *   group: 'Settings',
 *   icon: 'Settings',
 *   description: 'Site configuration',
 * };
 * ```
 */
export interface SingleAdminOptions {
  /**
   * Group name for organizing Singles in the sidebar.
   * Singles with the same group appear together under a common heading.
   *
   * @example 'Settings', 'Navigation', 'Content'
   */
  group?: string;

  /**
   * Icon identifier for the Single.
   * Should be a valid icon name from the icon library (e.g., Lucide).
   *
   * @example 'Settings', 'Menu', 'Home', 'FileText'
   */
  icon?: string;

  /**
   * Hide the Single from Admin UI navigation.
   * The Single is still accessible via direct URL and API.
   *
   * @default false
   */
  hidden?: boolean;

  /** Sort order within sidebar group (lower = higher position, default: 100) */
  order?: number;

  /** Custom sidebar group slug. When set, item moves from its default section to this custom group */
  sidebarGroup?: string;

  /**
   * Description text displayed below the Single title.
   * Use this to provide helpful context for editors.
   *
   * @example 'Configure site settings like name, logo, and SEO defaults.'
   */
  description?: string;
}

// ============================================================
// Access Control
// ============================================================

// SingleAccessControl is imported from services/auth/access-control-types
// and re-exported from this module for convenience.
// See access-control-types.ts for the full interface definition.

// ============================================================
// Lifecycle Hooks
// ============================================================

/**
 * Lifecycle hooks for Singles.
 *
 * Singles support a subset of Collection hooks since they only have
 * read and update operations (no create or delete).
 *
 * **Hook Execution Order for Read:**
 * 1. `beforeRead` - Before fetching from database
 * 2. Database read
 * 3. `afterRead` - After fetching, can transform data
 *
 * **Hook Execution Order for Update:**
 * 1. `beforeChange` - Before validation and database write
 * 2. Database update
 * 3. `afterChange` - After database write, for side effects
 *
 * @example
 * ```typescript
 * const hooks: SingleHooks = {
 *   afterChange: [
 *     async ({ doc }) => {
 *       // Revalidate frontend cache when settings change
 *       await fetch('/api/revalidate?tag=site-settings', { method: 'POST' });
 *     },
 *   ],
 * };
 * ```
 */
export interface SingleHooks {
  /**
   * Runs before reading the Single document.
   * Can modify query parameters or execute side effects.
   *
   * @example
   * ```typescript
   * beforeRead: [
   *   async ({ req }) => {
   *     console.log(`User ${req.user?.id} reading settings`);
   *   },
   * ]
   * ```
   */
  beforeRead?: HookHandler[];

  /**
   * Runs after reading the Single document.
   * Can transform the data before it's returned to the client.
   *
   * @example
   * ```typescript
   * afterRead: [
   *   async ({ doc }) => {
   *     // Add computed property
   *     return { ...doc, fullAddress: `${doc.street}, ${doc.city}` };
   *   },
   * ]
   * ```
   */
  afterRead?: HookHandler[];

  /**
   * Runs before updating the Single document.
   * Can transform data before validation and database write.
   *
   * @example
   * ```typescript
   * beforeChange: [
   *   async ({ data }) => {
   *     // Normalize data before saving
   *     return { ...data, siteName: data.siteName?.trim() };
   *   },
   * ]
   * ```
   */
  beforeChange?: HookHandler[];

  /**
   * Runs after updating the Single document.
   * Useful for side effects like cache invalidation, notifications, etc.
   *
   * @example
   * ```typescript
   * afterChange: [
   *   async ({ doc }) => {
   *     // Invalidate CDN cache
   *     await invalidateCache(['site-settings', 'header', 'footer']);
   *   },
   * ]
   * ```
   */
  afterChange?: HookHandler[];
}

// ============================================================
// Single Configuration
// ============================================================

/**
 * Complete Single configuration interface.
 *
 * This is the main interface for defining a Single in code.
 * Only `slug` and `fields` are required; all other properties have defaults.
 *
 * Singles are similar to Collections but simpler:
 * - Single document per Single (no list view)
 * - Auto-created on first access
 * - Only read/update operations (no create/delete)
 * - Table naming: `single_` prefix (e.g., `single_site_settings`)
 *
 * @example
 * ```typescript
 * import { defineSingle, text, upload, array, group } from '@revnixhq/nextly';
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
 *     group({
 *       name: 'seo',
 *       label: 'SEO Defaults',
 *       fields: [
 *         text({ name: 'metaTitle', label: 'Default Meta Title' }),
 *         text({ name: 'metaDescription', label: 'Default Meta Description' }),
 *       ],
 *     }),
 *   ],
 *   access: {
 *     read: true,
 *     update: ({ roles }) => roles.includes('admin'),
 *   },
 * });
 * ```
 */
export interface SingleConfig {
  /**
   * Unique identifier for the Single.
   *
   * Used as the database table name (with `single_` prefix), API endpoint,
   * and internal reference. Must be:
   * - Unique across all Singles AND Collections
   * - URL-friendly (lowercase, no spaces)
   * - Not a reserved name
   *
   * @example 'site-settings', 'header', 'footer', 'homepage'
   */
  slug: string;

  /**
   * Field definitions for the Single.
   *
   * An array of field configurations that define the document structure.
   * Supports all 26 field types from the Collections system.
   *
   * @example
   * ```typescript
   * fields: [
   *   text({ name: 'siteName', required: true }),
   *   upload({ name: 'logo', relationTo: 'media' }),
   *   array({
   *     name: 'socialLinks',
   *     fields: [
   *       text({ name: 'platform', required: true }),
   *       text({ name: 'url', required: true }),
   *     ],
   *   }),
   * ]
   * ```
   */
  fields: FieldConfig[];

  /**
   * Display label for the Admin UI.
   * If not provided, the label is auto-generated from the slug.
   *
   * @example
   * ```typescript
   * label: { singular: 'Site Settings' }
   * ```
   */
  label?: SingleLabel;

  /**
   * Enable the Draft / Published lifecycle for this Single.
   *
   * When `true`, Nextly injects a `status` system column on the data table
   * (NOT NULL, default `'draft'`) and the admin edit page shows separate
   * Save Draft / Publish buttons. Public callers querying with
   * `{ status: { equals: "published" } }` will only see published values;
   * drafts remain admin-only.
   *
   * Mirrors the Schema Builder's Advanced tab "Status (Draft / Published)"
   * toggle so code-first and Builder configurations converge on the same
   * underlying behaviour.
   *
   * @default false
   */
  status?: boolean;

  /**
   * Admin panel configuration options.
   * Controls how the Single appears in the Admin UI.
   */
  admin?: SingleAdminOptions;

  /**
   * Access control for read/update operations.
   * Defines who can view and modify the Single document.
   *
   * Each operation can be:
   * - A **function** receiving `AccessControlContext` (user, roles, permissions) → returns boolean
   * - A **boolean** for simple allow/deny
   * - **Omitted** to fall back to database role/permission checks
   *
   * @example
   * ```typescript
   * access: {
   *   read: true,
   *   update: ({ roles }) => roles.includes('admin'),
   * }
   * ```
   */
  access?: SingleAccessControl;

  /**
   * Lifecycle hooks.
   * Custom logic that runs during read/update operations.
   */
  hooks?: SingleHooks;

  /**
   * Custom database table name.
   *
   * If not specified, the table name is generated from the slug
   * with a `single_` prefix (e.g., 'site-settings' -> 'single_site_settings').
   *
   * @example 'single_site_config', 'global_settings'
   */
  dbName?: string;

  /**
   * Description of the Single.
   *
   * Displayed in the Admin UI and used for documentation.
   * If not provided, falls back to `admin.description`.
   */
  description?: string;

  /**
   * Custom metadata for plugins and extensions.
   *
   * Store arbitrary data that can be accessed by hooks, plugins,
   * or custom code. Not persisted to the database.
   *
   * @example
   * ```typescript
   * custom: {
   *   revalidateTags: ['site-settings', 'header'],
   *   cacheKey: 'global:site-settings',
   * }
   * ```
   */
  custom?: Record<string, unknown>;

  /**
   * Whether to enable automatic input sanitization for this Single.
   *
   * When `true` (default), the global sanitization hook strips HTML tags
   * from plain-text fields (text, textarea, email) before database storage.
   *
   * Set to `false` to disable automatic HTML tag stripping for text fields.
   * Use with caution — only disable if this Single intentionally stores
   * HTML in text fields.
   *
   * @default true
   */
  sanitize?: boolean;
}
