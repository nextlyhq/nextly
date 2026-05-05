/**
 * Repeater Field Type
 *
 * A field for storing repeating sets of fields. Each row in the repeater
 * contains the same field structure, allowing for lists of complex data.
 *
 * @module collections/fields/types/repeater
 * @since 1.0.0
 */

import type React from "react";

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Nested Field Type for Repeater Fields
// ============================================================

/**
 * Permissive type alias for fields nested within a repeater.
 *
 * Uses a structural subset of BaseFieldConfig with an index signature
 * to accept any concrete field config (text, select, group, etc.) without
 * contravariance issues from narrowed validate/name properties.
 *
 * @internal
 */
export type FieldConfig = {
  type: string;
  name?: string;
  label?: string;
  required?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// ============================================================
// Repeater Field Value Types
// ============================================================

/**
 * Value type for a single repeater row.
 *
 * Each row is an object containing field values keyed by field name.
 */
export type RepeaterRowValue = Record<string, unknown>;

/**
 * Value type for a repeater field.
 *
 * Repeater fields store an array of row objects, or null/undefined if empty.
 */
export type RepeaterFieldValue = RepeaterRowValue[] | null | undefined;

// ============================================================
// Repeater Row Label Component Props
// ============================================================

/**
 * Props passed to custom RowLabel components.
 *
 * RowLabel components render the label for each row in the repeater,
 * allowing dynamic labels based on row data.
 *
 * @example
 * ```typescript
 * const CustomRowLabel: React.FC<RepeaterRowLabelProps> = ({ data, index }) => {
 *   return <span>{data.title || `Item ${index + 1}`}</span>;
 * };
 * ```
 */
export interface RepeaterRowLabelProps {
  /**
   * The data for this specific repeater row.
   */
  data: RepeaterRowValue;

  /**
   * The zero-based index of this row in the repeater.
   */
  index: number;

  /**
   * The full path to this row in the document structure.
   */
  path: string;
}

// ============================================================
// Repeater Field Labels
// ============================================================

/**
 * Custom labels for repeater field UI.
 *
 * Allows customization of how repeater rows are labeled in the Admin UI.
 */
export interface RepeaterFieldLabels {
  /**
   * Singular label for a single row (e.g., "Item", "Entry", "Slide").
   *
   * Used in buttons like "Add {singular}" and row headers.
   */
  singular?: string;

  /**
   * Plural label for multiple rows (e.g., "Items", "Entries", "Slides").
   *
   * Used in section headers and descriptions.
   */
  plural?: string;
}

// ============================================================
// Repeater Field Admin Options
// ============================================================

/**
 * Admin panel options specific to repeater fields.
 *
 * Extends the base admin options with repeater-specific settings
 * for controlling row display and interaction.
 */
export interface RepeaterFieldAdminOptions extends FieldAdminOptions {
  /**
   * Whether repeater rows should be initially collapsed.
   *
   * When `true`, rows are rendered in a collapsed state and must
   * be expanded to view/edit their contents.
   *
   * @default false
   */
  initCollapsed?: boolean;

  /**
   * Whether rows can be reordered via drag-and-drop.
   *
   * When `true`, users can drag rows to reorder them.
   * Set to `false` to disable reordering.
   *
   * @default true
   */
  isSortable?: boolean;

  /**
   * Custom components for repeater field rendering.
   */
  components?: FieldAdminOptions["components"] & {
    /**
     * Custom component for rendering row labels.
     *
     * Allows dynamic labels based on row content instead of
     * the default "Item X" format.
     *
     * @example
     * ```typescript
     * components: {
     *   RowLabel: ({ data, index }) => (
     *     <span>{data.title || `Slide ${index + 1}`}</span>
     *   ),
     * }
     * ```
     */
    RowLabel?: React.ComponentType<RepeaterRowLabelProps>;
  };
}

// ============================================================
// Repeater Field Configuration
// ============================================================

/**
 * Configuration interface for repeater fields.
 *
 * Repeater fields store repeating sets of fields, allowing users to add,
 * remove, and reorder rows of structured data. Each row contains the
 * same field structure defined in the `fields` property.
 *
 * **Key Features:**
 * - Repeating field groups with add/remove controls
 * - Drag-and-drop reordering
 * - Min/max row validation
 * - Collapsible rows for complex structures
 * - Custom row labels based on content
 *
 * **Use Cases:**
 * - Image galleries with captions
 * - FAQ sections (question/answer pairs)
 * - Team member lists
 * - Product features or specifications
 * - Timeline entries
 * - Social media links
 *
 * @example
 * ```typescript
 * // Basic repeater - social links
 * const socialLinks: RepeaterFieldConfig = {
 *   name: 'socialLinks',
 *   type: 'repeater',
 *   label: 'Social Links',
 *   labels: {
 *     singular: 'Link',
 *     plural: 'Links',
 *   },
 *   fields: [
 *     {
 *       name: 'platform',
 *       type: 'select',
 *       options: ['twitter', 'facebook', 'linkedin', 'instagram'],
 *       required: true,
 *     },
 *     {
 *       name: 'url',
 *       type: 'text',
 *       required: true,
 *     },
 *   ],
 *   maxRows: 10,
 * };
 *
 * // FAQ section with custom row labels
 * const faq: RepeaterFieldConfig = {
 *   name: 'faq',
 *   type: 'repeater',
 *   label: 'Frequently Asked Questions',
 *   labels: {
 *     singular: 'Question',
 *     plural: 'Questions',
 *   },
 *   fields: [
 *     {
 *       name: 'question',
 *       type: 'text',
 *       required: true,
 *     },
 *     {
 *       name: 'answer',
 *       type: 'richText',
 *       required: true,
 *     },
 *   ],
 *   admin: {
 *     initCollapsed: true,
 *     components: {
 *       RowLabel: ({ data, index }) => (
 *         <span>{data.question || `Question ${index + 1}`}</span>
 *       ),
 *     },
 *   },
 * };
 *
 * // Image gallery with validation
 * const gallery: RepeaterFieldConfig = {
 *   name: 'gallery',
 *   type: 'repeater',
 *   label: 'Image Gallery',
 *   labels: {
 *     singular: 'Image',
 *     plural: 'Images',
 *   },
 *   minRows: 1,
 *   maxRows: 20,
 *   fields: [
 *     {
 *       name: 'image',
 *       type: 'upload',
 *       relationTo: 'media',
 *       required: true,
 *     },
 *     {
 *       name: 'caption',
 *       type: 'text',
 *     },
 *     {
 *       name: 'alt',
 *       type: 'text',
 *       required: true,
 *     },
 *   ],
 *   validate: (value) => {
 *     if (!value || value.length === 0) {
 *       return 'Please add at least one image';
 *     }
 *     return true;
 *   },
 * };
 *
 * // Nested repeaters - product variants with options
 * const variants: RepeaterFieldConfig = {
 *   name: 'variants',
 *   type: 'repeater',
 *   label: 'Product Variants',
 *   fields: [
 *     {
 *       name: 'name',
 *       type: 'text',
 *       required: true,
 *     },
 *     {
 *       name: 'sku',
 *       type: 'text',
 *       required: true,
 *     },
 *     {
 *       name: 'price',
 *       type: 'number',
 *       required: true,
 *     },
 *     {
 *       name: 'options',
 *       type: 'repeater',
 *       fields: [
 *         { name: 'name', type: 'text' },
 *         { name: 'value', type: 'text' },
 *       ],
 *     },
 *   ],
 * };
 * ```
 */
export interface RepeaterFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'repeater'.
   */
  type: "repeater";

  /**
   * Fields that make up each row of the repeater.
   *
   * Each row will contain all these fields. Supports any field type
   * including nested repeaters and groups for complex data structures.
   */
  fields: FieldConfig[];

  /**
   * Minimum number of rows required.
   *
   * Validation will fail if fewer rows are present.
   */
  minRows?: number;

  /**
   * Maximum number of rows allowed.
   *
   * Validation will fail if more rows are present.
   * The Admin UI will disable the add button when this limit is reached.
   */
  maxRows?: number;

  /**
   * Custom labels for repeater rows.
   *
   * Used in the Admin UI for buttons like "Add {singular}" and
   * section headers showing "{plural}".
   */
  labels?: RepeaterFieldLabels;

  /**
   * Default value for the repeater field.
   *
   * An array of row data objects to use as initial values.
   *
   * @example
   * ```typescript
   * defaultValue: [
   *   { platform: 'twitter', url: 'https://twitter.com/example' },
   *   { platform: 'linkedin', url: 'https://linkedin.com/in/example' },
   * ]
   * ```
   */
  defaultValue?:
    | RepeaterRowValue[]
    | ((data: Record<string, unknown>) => RepeaterRowValue[]);

  /**
   * Admin UI configuration options.
   */
  admin?: RepeaterFieldAdminOptions;

  /**
   * Custom interface name for TypeScript generation.
   *
   * When specified, creates a reusable TypeScript interface with
   * this name that can be imported and used elsewhere.
   *
   * @example
   * ```typescript
   * interfaceName: 'SocialLink'
   * // Generates: export interface SocialLink { platform: string; url: string; }
   * ```
   */
  interfaceName?: string;

  /**
   * Custom database table name (SQL adapters only).
   *
   * By default, repeater data is stored in a separate table with an
   * auto-generated name. Use this to specify a custom table name.
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
   * Receives the repeater value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The repeater field value
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Require at least 3 items
   * validate: (value) => {
   *   if (!value || value.length < 3) {
   *     return 'Please add at least 3 items';
   *   }
   *   return true;
   * }
   *
   * // Validate unique values within repeater
   * validate: (value) => {
   *   if (value) {
   *     const names = value.map(row => row.name);
   *     const unique = new Set(names);
   *     if (names.length !== unique.size) {
   *       return 'All item names must be unique';
   *     }
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: RepeaterFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
