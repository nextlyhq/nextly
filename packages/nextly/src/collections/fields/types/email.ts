/**
 * Email Field Type
 *
 * A specialized text field for email addresses.
 * Automatically validates email format and renders
 * with appropriate input type in the Admin UI.
 *
 * @module collections/fields/types/email
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Email Field Value Type
// ============================================================

/**
 * Possible value types for an email field.
 */
export type EmailFieldValue = string | null | undefined;

// ============================================================
// Email Field Admin Options
// ============================================================

/**
 * Admin panel options specific to email fields.
 *
 * Extends the base admin options with email-specific settings.
 */
export interface EmailFieldAdminOptions extends FieldAdminOptions {
  /**
   * HTML autocomplete attribute value.
   *
   * @default 'email'
   * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
   */
  autoComplete?: string;
}

// ============================================================
// Email Field Configuration
// ============================================================

/**
 * Configuration interface for email fields.
 *
 * Email fields are specialized text inputs that automatically
 * validate email format. They render with `type="email"` in the
 * Admin UI, providing browser-native email validation and
 * appropriate keyboard on mobile devices.
 *
 * Built-in validation ensures the value matches a standard email
 * pattern. Additional custom validation can be added via the
 * `validate` function.
 *
 * @example
 * ```typescript
 * // Basic email field
 * const emailField: EmailFieldConfig = {
 *   name: 'email',
 *   type: 'email',
 *   label: 'Email Address',
 *   required: true,
 *   unique: true,
 * };
 *
 * // Email field with custom validation
 * const workEmailField: EmailFieldConfig = {
 *   name: 'workEmail',
 *   type: 'email',
 *   label: 'Work Email',
 *   validate: (value) => {
 *     if (value && !value.endsWith('@company.com')) {
 *       return 'Must be a company email address';
 *     }
 *     return true;
 *   },
 * };
 *
 * // Contact email with description
 * const contactEmailField: EmailFieldConfig = {
 *   name: 'contactEmail',
 *   type: 'email',
 *   label: 'Contact Email',
 *   admin: {
 *     description: 'This email will be used for notifications',
 *     placeholder: 'you@example.com',
 *   },
 * };
 * ```
 */
export interface EmailFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'email'.
   */
  type: "email";

  /**
   * Default value for the field.
   *
   * Can be a static string or a function that returns one.
   */
  defaultValue?: string | ((data: Record<string, unknown>) => string);

  /**
   * Admin UI configuration options.
   */
  admin?: EmailFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * This runs in addition to the built-in email format validation.
   * Use this for custom rules like domain restrictions.
   *
   * @param value - The email field value (string, null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * validate: (value, { data }) => {
   *   // Restrict to specific domains
   *   const allowedDomains = ['company.com', 'partner.com'];
   *   if (value) {
   *     const domain = value.split('@')[1];
   *     if (!allowedDomains.includes(domain)) {
   *       return 'Email must be from an allowed domain';
   *     }
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: EmailFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
