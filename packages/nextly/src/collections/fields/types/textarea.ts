/**
 * Textarea Field Type
 *
 * A multi-line text input field for longer text content.
 * Similar to text fields but renders as a textarea element
 * with configurable rows.
 *
 * @module collections/fields/types/textarea
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  FieldValidation,
  RequestContext,
} from "./base";

// ============================================================
// Textarea Field Value Type
// ============================================================

/**
 * Possible value types for a textarea field.
 */
export type TextareaFieldValue = string | null | undefined;

// ============================================================
// Textarea Field Admin Options
// ============================================================

/**
 * Admin panel options specific to textarea fields.
 *
 * Extends the base admin options with textarea-specific settings
 * like rows and resizing behavior.
 */
export interface TextareaFieldAdminOptions extends FieldAdminOptions {
  /**
   * Number of visible text rows.
   *
   * Sets the initial height of the textarea.
   * @default 3
   */
  rows?: number;

  /**
   * Resize behavior for the textarea.
   *
   * - `'vertical'` - Allow vertical resizing only (default)
   * - `'horizontal'` - Allow horizontal resizing only
   * - `'both'` - Allow resizing in both directions
   * - `'none'` - Disable resizing
   */
  resize?: "vertical" | "horizontal" | "both" | "none";
}

// ============================================================
// Textarea Field Configuration
// ============================================================

/**
 * Configuration interface for textarea fields.
 *
 * Textarea fields are used for multi-line text input, such as
 * descriptions, summaries, or any content that may span multiple lines.
 * They differ from text fields in that they render as a resizable
 * textarea element.
 *
 * @example
 * ```typescript
 * // Basic textarea field
 * const descriptionField: TextareaFieldConfig = {
 *   name: 'description',
 *   type: 'textarea',
 *   label: 'Description',
 *   maxLength: 1000,
 * };
 *
 * // Textarea with custom rows
 * const contentField: TextareaFieldConfig = {
 *   name: 'content',
 *   type: 'textarea',
 *   label: 'Content',
 *   required: true,
 *   admin: {
 *     rows: 10,
 *     resize: 'vertical',
 *     placeholder: 'Enter your content here...',
 *   },
 * };
 *
 * // Textarea with length validation
 * const summaryField: TextareaFieldConfig = {
 *   name: 'summary',
 *   type: 'textarea',
 *   label: 'Summary',
 *   minLength: 50,
 *   maxLength: 500,
 *   admin: {
 *     description: 'Write a brief summary (50-500 characters)',
 *   },
 * };
 * ```
 */
export interface TextareaFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'textarea'.
   */
  type: "textarea";

  /**
   * Minimum length for the text value.
   *
   * Validation will fail if the string length is less than this value.
   * Only applies to non-empty values.
   */
  minLength?: number;

  /**
   * Maximum length for the text value.
   *
   * Validation will fail if the string length exceeds this value.
   */
  maxLength?: number;

  /**
   * Default value for the field.
   *
   * Can be a static string or a function that returns one.
   */
  defaultValue?: string | ((data: Record<string, unknown>) => string);

  /**
   * Admin UI configuration options.
   */
  admin?: TextareaFieldAdminOptions;

  /**
   * Nested validation knobs. Mirrors the Schema Builder shape so code-first
   * config and the Builder UI converge. The renderer reads either the flat
   * `minLength` / `maxLength` above or this object — newly written code
   * should prefer this nested form.
   */
  validation?: FieldValidation;

  /**
   * Custom validation function.
   *
   * Receives the typed textarea value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The textarea field value (string, null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * validate: (value, { data }) => {
   *   if (value && value.split('\n').length > 10) {
   *     return 'Content cannot exceed 10 lines';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: TextareaFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
