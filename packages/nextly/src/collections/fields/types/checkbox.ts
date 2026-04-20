/**
 * Checkbox Field Type
 *
 * A boolean toggle field that stores true/false values.
 * Renders as a checkbox input in the Admin UI.
 *
 * @module collections/fields/types/checkbox
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Checkbox Field Value Type
// ============================================================

/**
 * Possible value types for a checkbox field.
 *
 * - `boolean` - true or false
 * - `null` - Explicitly empty value
 * - `undefined` - Value not set
 */
export type CheckboxFieldValue = boolean | null | undefined;

// ============================================================
// Checkbox Field Admin Options
// ============================================================

/**
 * Admin panel options specific to checkbox fields.
 *
 * Checkbox fields use the base admin options without additional
 * field-specific settings.
 */
export interface CheckboxFieldAdminOptions extends FieldAdminOptions {
  // Checkbox uses base admin options only
  // No additional options needed
}

// ============================================================
// Checkbox Field Configuration
// ============================================================

/**
 * Configuration interface for checkbox fields.
 *
 * Checkbox fields store boolean values (true/false) and are
 * commonly used for toggles, flags, and binary choices.
 *
 * **Use Cases:**
 * - Feature toggles (enabled/disabled)
 * - Agreement checkboxes (terms accepted)
 * - Visibility flags (published, featured, archived)
 * - Binary preferences (notifications enabled)
 *
 * @example
 * ```typescript
 * // Basic checkbox field
 * const publishedField: CheckboxFieldConfig = {
 *   name: 'published',
 *   type: 'checkbox',
 *   label: 'Published',
 *   defaultValue: false,
 * };
 *
 * // Required checkbox (e.g., terms acceptance)
 * const termsField: CheckboxFieldConfig = {
 *   name: 'termsAccepted',
 *   type: 'checkbox',
 *   label: 'I accept the terms and conditions',
 *   required: true,
 *   validate: (value) => {
 *     if (value !== true) {
 *       return 'You must accept the terms to continue';
 *     }
 *     return true;
 *   },
 * };
 *
 * // Feature toggle with admin description
 * const featuredField: CheckboxFieldConfig = {
 *   name: 'featured',
 *   type: 'checkbox',
 *   label: 'Featured',
 *   defaultValue: false,
 *   admin: {
 *     description: 'Display this item in the featured section',
 *     position: 'sidebar',
 *   },
 * };
 *
 * // Conditional checkbox
 * const sendNotificationsField: CheckboxFieldConfig = {
 *   name: 'sendNotifications',
 *   type: 'checkbox',
 *   label: 'Send email notifications',
 *   defaultValue: true,
 *   admin: {
 *     condition: {
 *       field: 'email',
 *       exists: true,
 *     },
 *   },
 * };
 * ```
 */
export interface CheckboxFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. 'checkbox' is canonical; 'boolean' is the Schema Builder alias.
   */
  type: "checkbox" | "boolean";

  /**
   * Default value for the field.
   *
   * Can be a static boolean or a function that returns a boolean.
   * If not specified and `required: true`, defaults to `false`.
   *
   * @example
   * ```typescript
   * // Static default
   * defaultValue: false
   *
   * // Dynamic default based on other data
   * defaultValue: (data) => data.role === 'admin'
   * ```
   */
  defaultValue?: boolean | ((data: Record<string, unknown>) => boolean);

  /**
   * Admin UI configuration options.
   */
  admin?: CheckboxFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the typed boolean value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The checkbox field value (boolean, null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Require true value (e.g., terms acceptance)
   * validate: (value) => {
   *   if (value !== true) {
   *     return 'This field must be checked';
   *   }
   *   return true;
   * }
   *
   * // Conditional validation
   * validate: (value, { data }) => {
   *   if (data.type === 'premium' && value !== true) {
   *     return 'Premium items must be featured';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: CheckboxFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
