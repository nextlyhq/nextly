/**
 * Text Field Type
 *
 * A basic text input field that stores a string value.
 * Supports single or multiple values (hasMany), length validation,
 * and custom validation functions.
 *
 * @module collections/fields/types/text
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Text Field Value Type
// ============================================================

/**
 * Possible value types for a text field.
 *
 * - `string` - Single text value (default)
 * - `string[]` - Multiple text values (when `hasMany: true`)
 * - `null` - Explicitly empty value
 * - `undefined` - Value not set
 */
export type TextFieldValue = string | string[] | null | undefined;

// ============================================================
// Text Field Admin Options
// ============================================================

/**
 * Admin panel options specific to text fields.
 *
 * Extends the base admin options with text-specific settings
 * like autoComplete and input type.
 */
export interface TextFieldAdminOptions extends FieldAdminOptions {
  /**
   * HTML autocomplete attribute value.
   *
   * Helps browsers provide relevant auto-fill suggestions.
   * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
   *
   * @example 'name', 'email', 'tel', 'off'
   */
  autoComplete?: string;
}

// ============================================================
// Text Field Configuration
// ============================================================

/**
 * Configuration interface for text fields.
 *
 * Text fields are the most basic input type, storing a single string
 * or an array of strings. They support length validation and can be
 * configured for various text input scenarios.
 *
 * @example
 * ```typescript
 * // Basic text field
 * const titleField: TextFieldConfig = {
 *   name: 'title',
 *   type: 'text',
 *   label: 'Title',
 *   required: true,
 *   maxLength: 200,
 * };
 *
 * // Text field with multiple values
 * const tagsField: TextFieldConfig = {
 *   name: 'tags',
 *   type: 'text',
 *   label: 'Tags',
 *   hasMany: true,
 *   admin: {
 *     description: 'Enter tags separated by Enter',
 *   },
 * };
 *
 * // Text field with custom validation
 * const slugField: TextFieldConfig = {
 *   name: 'slug',
 *   type: 'text',
 *   label: 'URL Slug',
 *   unique: true,
 *   validate: (value) => {
 *     if (value && !/^[a-z0-9-]+$/.test(value)) {
 *       return 'Slug can only contain lowercase letters, numbers, and hyphens';
 *     }
 *     return true;
 *   },
 * };
 * ```
 */
export interface TextFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'text'.
   */
  type: "text";

  /**
   * Minimum length for the text value.
   *
   * Validation will fail if the string length is less than this value.
   * Only applies to non-empty values (empty/null values are handled by `required`).
   */
  minLength?: number;

  /**
   * Maximum length for the text value.
   *
   * Validation will fail if the string length exceeds this value.
   * Also used to set the database column size.
   */
  maxLength?: number;

  /**
   * Allow multiple text values.
   *
   * When `true`, the field accepts an array of strings instead of a single string.
   * In the Admin UI, this renders as a tag-style input.
   *
   * @default false
   */
  hasMany?: boolean;

  /**
   * Minimum number of items when `hasMany` is true.
   */
  minRows?: number;

  /**
   * Maximum number of items when `hasMany` is true.
   */
  maxRows?: number;

  /**
   * Default value for the field.
   *
   * Can be a static string/array or a function that returns one.
   */
  defaultValue?:
    | string
    | string[]
    | ((data: Record<string, unknown>) => string | string[]);

  /**
   * Admin UI configuration options.
   */
  admin?: TextFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the typed text value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The text field value (string, string[], null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * validate: (value, { data }) => {
   *   if (value && value.includes('forbidden')) {
   *     return 'Value cannot contain "forbidden"';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: TextFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
