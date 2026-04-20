/**
 * Group Field Type
 *
 * A field for nesting other fields under a common property.
 * Groups provide both data organization and visual grouping in the Admin UI.
 *
 * @module collections/fields/types/group
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Nested Field Type for Group Fields
// ============================================================

/**
 * Permissive type alias for fields nested within a group.
 *
 * Uses a structural subset of BaseFieldConfig with `Record<string, any>`
 * to accept any concrete field config (text, select, array, etc.) without
 * contravariance issues from narrowed validate/name properties.
 *
 * @internal
 */
export type GroupFieldConfig_FieldConfig = {
  type: string;
  name?: string;
  label?: string;
  required?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// ============================================================
// Group Field Value Types
// ============================================================

/**
 * Value type for a group field.
 *
 * Group fields store an object containing nested field values,
 * keyed by field name.
 */
export type GroupFieldValue = Record<string, unknown> | null | undefined;

// ============================================================
// Group Field Admin Options
// ============================================================

/**
 * Admin panel options specific to group fields.
 *
 * Extends the base admin options with group-specific settings
 * for controlling visual presentation.
 */
export interface GroupFieldAdminOptions extends FieldAdminOptions {
  /**
   * Hide the group's visual gutter (vertical line and padding).
   *
   * By default, groups display a vertical line on the left side
   * to visually indicate nesting. Set to `true` to remove this
   * visual indicator for a flatter appearance.
   *
   * @default false
   */
  hideGutter?: boolean;
}

// ============================================================
// Group Field Configuration
// ============================================================

/**
 * Configuration interface for group fields.
 *
 * Group fields nest other fields under a common property, creating
 * both a data structure (nested object) and visual grouping in the
 * Admin UI. Groups can be "named" (with a `name` property) to create
 * nested data, or "presentational" (without `name`) for UI-only grouping.
 *
 * **Key Features:**
 * - Nest fields under a common property
 * - Visual grouping with optional gutter
 * - Support for deeply nested structures
 * - Can be presentational (no data nesting) or named (creates nested object)
 *
 * **Use Cases:**
 * - SEO metadata (title, description, keywords as a group)
 * - Address fields (street, city, state, zip grouped together)
 * - Social settings (links, sharing options grouped)
 * - Author information (name, bio, avatar grouped)
 * - Product dimensions (width, height, depth, weight)
 *
 * **Named vs Presentational Groups:**
 *
 * - **Named Group:** Has a `name` property. Data is stored under that property.
 *   ```typescript
 *   // Config
 *   { name: 'seo', type: 'group', fields: [{ name: 'title' }] }
 *   // Data: { seo: { title: 'My Title' } }
 *   ```
 *
 * - **Presentational Group:** No `name` property. Fields are stored at the parent level.
 *   ```typescript
 *   // Config
 *   { type: 'group', label: 'SEO Settings', fields: [{ name: 'seoTitle' }] }
 *   // Data: { seoTitle: 'My Title' }
 *   ```
 *
 * @example
 * ```typescript
 * // Named group - SEO metadata
 * const seo: GroupFieldConfig = {
 *   name: 'seo',
 *   type: 'group',
 *   label: 'SEO Settings',
 *   fields: [
 *     {
 *       name: 'title',
 *       type: 'text',
 *       label: 'Meta Title',
 *       maxLength: 60,
 *     },
 *     {
 *       name: 'description',
 *       type: 'textarea',
 *       label: 'Meta Description',
 *       maxLength: 160,
 *     },
 *     {
 *       name: 'keywords',
 *       type: 'text',
 *       hasMany: true,
 *       label: 'Keywords',
 *     },
 *   ],
 *   admin: {
 *     description: 'Configure SEO settings for this page',
 *   },
 * };
 * // Stored as: { seo: { title: '...', description: '...', keywords: [...] } }
 *
 * // Named group - Address
 * const address: GroupFieldConfig = {
 *   name: 'address',
 *   type: 'group',
 *   label: 'Shipping Address',
 *   fields: [
 *     { name: 'street', type: 'text', required: true },
 *     { name: 'city', type: 'text', required: true },
 *     { name: 'state', type: 'text', required: true },
 *     { name: 'zipCode', type: 'text', required: true },
 *     { name: 'country', type: 'select', options: ['US', 'CA', 'UK', 'AU'] },
 *   ],
 * };
 *
 * // Named group - Social links with hidden gutter
 * const social: GroupFieldConfig = {
 *   name: 'social',
 *   type: 'group',
 *   label: 'Social Media',
 *   admin: {
 *     hideGutter: true,
 *   },
 *   fields: [
 *     { name: 'twitter', type: 'text', label: 'Twitter URL' },
 *     { name: 'facebook', type: 'text', label: 'Facebook URL' },
 *     { name: 'linkedin', type: 'text', label: 'LinkedIn URL' },
 *     { name: 'instagram', type: 'text', label: 'Instagram URL' },
 *   ],
 * };
 *
 * // Nested groups - Author with contact details
 * const author: GroupFieldConfig = {
 *   name: 'author',
 *   type: 'group',
 *   label: 'Author Information',
 *   fields: [
 *     { name: 'name', type: 'text', required: true },
 *     { name: 'bio', type: 'textarea' },
 *     { name: 'avatar', type: 'upload', relationTo: 'media' },
 *     {
 *       name: 'contact',
 *       type: 'group',
 *       label: 'Contact Details',
 *       fields: [
 *         { name: 'email', type: 'email' },
 *         { name: 'phone', type: 'text' },
 *         { name: 'website', type: 'text' },
 *       ],
 *     },
 *   ],
 * };
 *
 * // Presentational group (no name) - just visual grouping
 * const settingsSection: GroupFieldConfig = {
 *   type: 'group',
 *   label: 'Display Settings',
 *   admin: {
 *     description: 'Configure how this content is displayed',
 *   },
 *   fields: [
 *     { name: 'showTitle', type: 'checkbox', defaultValue: true },
 *     { name: 'showDate', type: 'checkbox', defaultValue: true },
 *     { name: 'showAuthor', type: 'checkbox', defaultValue: false },
 *   ],
 * };
 * // Fields stored at parent level: { showTitle: true, showDate: true, ... }
 *
 * // Group with default values
 * const defaults: GroupFieldConfig = {
 *   name: 'settings',
 *   type: 'group',
 *   label: 'Default Settings',
 *   defaultValue: {
 *     theme: 'light',
 *     notifications: true,
 *     language: 'en',
 *   },
 *   fields: [
 *     { name: 'theme', type: 'select', options: ['light', 'dark', 'auto'] },
 *     { name: 'notifications', type: 'checkbox' },
 *     { name: 'language', type: 'select', options: ['en', 'es', 'fr', 'de'] },
 *   ],
 * };
 *
 * // Group with conditional visibility
 * const advancedOptions: GroupFieldConfig = {
 *   name: 'advanced',
 *   type: 'group',
 *   label: 'Advanced Options',
 *   admin: {
 *     condition: {
 *       field: 'showAdvanced',
 *       equals: true,
 *     },
 *   },
 *   fields: [
 *     { name: 'cacheTimeout', type: 'number' },
 *     { name: 'customCSS', type: 'code', language: 'css' },
 *     { name: 'customJS', type: 'code', language: 'javascript' },
 *   ],
 * };
 * ```
 */
export interface GroupFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin" | "name" | "required"
  > {
  /**
   * Field type identifier. Must be 'group'.
   */
  type: "group";

  /**
   * Unique field name (identifier).
   *
   * **Named groups:** When `name` is provided, fields are nested under
   * this property in the data structure.
   *
   * **Presentational groups:** When `name` is omitted, the group is
   * purely visual - fields are stored at the parent level.
   *
   * @example
   * ```typescript
   * // Named group - data stored under 'seo' property
   * { name: 'seo', type: 'group', fields: [...] }
   *
   * // Presentational group - fields stored at parent level
   * { type: 'group', label: 'SEO Settings', fields: [...] }
   * ```
   */
  name?: string;

  /**
   * Fields nested within this group.
   *
   * Supports any field type including nested groups and arrays
   * for complex data structures.
   */
  fields: GroupFieldConfig_FieldConfig[];

  /**
   * Default value for the group field.
   *
   * An object containing default values for nested fields.
   * Only applicable for named groups.
   *
   * @example
   * ```typescript
   * defaultValue: {
   *   title: 'Default Title',
   *   description: '',
   *   keywords: [],
   * }
   * ```
   */
  defaultValue?:
    | GroupFieldValue
    | ((data: Record<string, unknown>) => GroupFieldValue);

  /**
   * Admin UI configuration options.
   */
  admin?: GroupFieldAdminOptions;

  /**
   * Custom interface name for TypeScript generation.
   *
   * When specified, creates a reusable TypeScript interface with
   * this name that can be imported and used elsewhere.
   *
   * @example
   * ```typescript
   * interfaceName: 'SEOMetadata'
   * // Generates: export interface SEOMetadata { title: string; description?: string; }
   * ```
   */
  interfaceName?: string;

  /**
   * Custom database column/table name (SQL adapters only).
   *
   * By default, group data is stored using the field name.
   * Use this to specify a custom database identifier.
   */
  dbName?: string;

  /**
   * Mark field as virtual (no database storage).
   *
   * When `true`, the field exists in the API but is not persisted
   * to the database. Useful for computed or derived fields.
   *
   * @default false
   */
  virtual?: boolean;

  /**
   * Custom validation function.
   *
   * Receives the group value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The group field value (object with nested values)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Validate that at least one social link is provided
   * validate: (value) => {
   *   if (value) {
   *     const hasLink = Object.values(value).some(v => v);
   *     if (!hasLink) {
   *       return 'Please provide at least one social link';
   *     }
   *   }
   *   return true;
   * }
   *
   * // Cross-field validation within group
   * validate: (value, { data }) => {
   *   if (value?.endDate && value?.startDate) {
   *     if (new Date(value.endDate) < new Date(value.startDate)) {
   *       return 'End date must be after start date';
   *     }
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: GroupFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
