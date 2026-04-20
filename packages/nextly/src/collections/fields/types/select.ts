/**
 * Select Field Type
 *
 * A dropdown selection field that allows choosing from predefined options.
 * Supports single or multiple selections, searchable dropdowns, and
 * dynamic option filtering.
 *
 * @module collections/fields/types/select
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Select Option Type
// ============================================================

/**
 * A single option in a select field.
 *
 * Options can be defined as objects with label and value,
 * where the label is displayed to users and the value is stored.
 *
 * @example
 * ```typescript
 * const option: SelectOption = {
 *   label: 'Published',
 *   value: 'published',
 * };
 * ```
 */
export interface SelectOption {
  /**
   * Display text shown to users in the dropdown.
   */
  label: string;

  /**
   * Value stored in the database when this option is selected.
   *
   * **Important:** Values should be strings without hyphens or special
   * characters due to GraphQL enumeration naming constraints.
   * Underscores are allowed.
   *
   * @example 'published', 'draft', 'pending_review'
   */
  value: string;
}

// ============================================================
// Select Field Value Type
// ============================================================

/**
 * Possible value types for a select field.
 *
 * - `string` - Single selected value (default)
 * - `string[]` - Multiple selected values (when `hasMany: true`)
 * - `null` - Explicitly empty value
 * - `undefined` - Value not set
 */
export type SelectFieldValue = string | string[] | null | undefined;

// ============================================================
// Filter Options Function
// ============================================================

/**
 * Arguments passed to the filterOptions function.
 */
export interface FilterOptionsArgs {
  /**
   * The current document data being edited.
   */
  data: Record<string, unknown>;

  /**
   * Data from sibling fields (fields at the same level in arrays/groups).
   */
  siblingData: Record<string, unknown>;

  /**
   * The current user making the request.
   */
  user: RequestContext["user"];
}

/**
 * Function to dynamically filter available options.
 *
 * Allows options to be filtered based on document data, sibling data,
 * or user context. Useful for cascading dropdowns or role-based options.
 *
 * @param args - Filter arguments with data and user context
 * @returns Filtered array of options or a Promise resolving to options
 *
 * @example
 * ```typescript
 * // Filter categories based on selected parent
 * filterOptions: ({ data }) => {
 *   const parentId = data.parentCategory;
 *   return allCategories.filter(cat => cat.parentId === parentId);
 * }
 *
 * // Role-based option filtering
 * filterOptions: ({ user }) => {
 *   if (user?.role === 'admin') {
 *     return allOptions;
 *   }
 *   return allOptions.filter(opt => !opt.adminOnly);
 * }
 * ```
 */
export type FilterOptionsFunction = (
  args: FilterOptionsArgs
) => SelectOption[] | Promise<SelectOption[]>;

// ============================================================
// Select Field Admin Options
// ============================================================

/**
 * Admin panel options specific to select fields.
 *
 * Extends the base admin options with select-specific settings
 * like clearable and sortable options.
 */
export interface SelectFieldAdminOptions extends FieldAdminOptions {
  /**
   * Allow users to clear the selection.
   *
   * When `true`, displays a clear button to remove the selected value.
   *
   * @default false
   */
  isClearable?: boolean;

  /**
   * Allow drag-and-drop reordering of selected items.
   *
   * Only applies when `hasMany: true`. Enables users to reorder
   * their selections by dragging.
   *
   * @default false
   */
  isSortable?: boolean;
}

// ============================================================
// Select Field Configuration
// ============================================================

/**
 * Configuration interface for select fields.
 *
 * Select fields provide a dropdown interface for choosing from
 * predefined options. They support single or multiple selections,
 * custom validation, and dynamic option filtering.
 *
 * **Use Cases:**
 * - Status fields (draft, published, archived)
 * - Category selection
 * - Priority levels
 * - Country/region selection
 * - Role assignment
 *
 * @example
 * ```typescript
 * // Basic select field
 * const statusField: SelectFieldConfig = {
 *   name: 'status',
 *   type: 'select',
 *   label: 'Status',
 *   required: true,
 *   defaultValue: 'draft',
 *   options: [
 *     { label: 'Draft', value: 'draft' },
 *     { label: 'Published', value: 'published' },
 *     { label: 'Archived', value: 'archived' },
 *   ],
 * };
 *
 * // Multi-select field
 * const categoriesField: SelectFieldConfig = {
 *   name: 'categories',
 *   type: 'select',
 *   label: 'Categories',
 *   hasMany: true,
 *   options: [
 *     { label: 'Technology', value: 'technology' },
 *     { label: 'Business', value: 'business' },
 *     { label: 'Design', value: 'design' },
 *     { label: 'Marketing', value: 'marketing' },
 *   ],
 *   admin: {
 *     isClearable: true,
 *     isSortable: true,
 *     description: 'Select one or more categories',
 *   },
 * };
 *
 * // Select with dynamic filtering
 * const subcategoryField: SelectFieldConfig = {
 *   name: 'subcategory',
 *   type: 'select',
 *   label: 'Subcategory',
 *   options: allSubcategories,
 *   filterOptions: ({ data }) => {
 *     const parentCategory = data.category as string;
 *     return allSubcategories.filter(sub => sub.parentId === parentCategory);
 *   },
 *   admin: {
 *     condition: {
 *       field: 'category',
 *       exists: true,
 *     },
 *   },
 * };
 *
 * // Priority field with custom validation
 * const priorityField: SelectFieldConfig = {
 *   name: 'priority',
 *   type: 'select',
 *   label: 'Priority',
 *   options: [
 *     { label: 'Low', value: 'low' },
 *     { label: 'Medium', value: 'medium' },
 *     { label: 'High', value: 'high' },
 *     { label: 'Critical', value: 'critical' },
 *   ],
 *   validate: (value, { data }) => {
 *     if (data.type === 'bug' && value !== 'high' && value !== 'critical') {
 *       return 'Bugs must have high or critical priority';
 *     }
 *     return true;
 *   },
 * };
 *
 * // Unique select (e.g., primary contact)
 * const primaryContactField: SelectFieldConfig = {
 *   name: 'primaryContact',
 *   type: 'select',
 *   label: 'Primary Contact',
 *   unique: true,
 *   options: contactOptions,
 *   admin: {
 *     isClearable: true,
 *   },
 * };
 * ```
 */
export interface SelectFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'select'.
   */
  type: "select";

  /**
   * Available options for selection.
   *
   * Array of options with label (displayed) and value (stored).
   *
   * **Important:** Option values should be strings without hyphens
   * or special characters due to GraphQL enumeration naming constraints.
   * Underscores are allowed.
   */
  options: SelectOption[];

  /**
   * Allow multiple selections.
   *
   * When `true`, the field accepts an array of values instead of
   * a single value. Renders as a multi-select dropdown.
   *
   * @default false
   */
  hasMany?: boolean;

  /**
   * Custom enum name for SQL databases and TypeScript generation.
   *
   * If not provided, an enum name will be auto-generated from
   * the collection and field name.
   *
   * @example 'PostStatus', 'UserRole'
   */
  enumName?: string;

  /**
   * Interface name for TypeScript and GraphQL type generation.
   *
   * Creates a reusable top-level type that can be referenced
   * elsewhere in your schema.
   *
   * @example 'Status', 'Priority'
   */
  interfaceName?: string;

  /**
   * Function to dynamically filter available options.
   *
   * Allows options to be filtered based on document data,
   * sibling data, or user context.
   */
  filterOptions?: FilterOptionsFunction;

  /**
   * Default value for the field.
   *
   * Can be a static value or a function that returns a value.
   * For `hasMany: true`, provide an array of values.
   *
   * @example
   * ```typescript
   * // Single default
   * defaultValue: 'draft'
   *
   * // Multiple defaults (when hasMany: true)
   * defaultValue: ['technology', 'design']
   *
   * // Dynamic default
   * defaultValue: (data) => data.isUrgent ? 'high' : 'medium'
   * ```
   */
  defaultValue?:
    | string
    | string[]
    | ((data: Record<string, unknown>) => string | string[]);

  /**
   * Admin UI configuration options.
   */
  admin?: SelectFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the typed select value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The select field value (string, string[], null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Ensure at least 2 categories selected
   * validate: (value) => {
   *   if (Array.isArray(value) && value.length < 2) {
   *     return 'Please select at least 2 categories';
   *   }
   *   return true;
   * }
   *
   * // Validate against other field values
   * validate: (value, { data }) => {
   *   if (value === 'published' && !data.title) {
   *     return 'Cannot publish without a title';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: SelectFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
