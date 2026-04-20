/**
 * Password Field Type
 *
 * A secure text field for password input.
 * Values are masked in the Admin UI and should be
 * hashed before storage using hooks.
 *
 * @module collections/fields/types/password
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Password Field Value Type
// ============================================================

/**
 * Possible value types for a password field.
 */
export type PasswordFieldValue = string | null | undefined;

// ============================================================
// Password Field Admin Options
// ============================================================

/**
 * Admin panel options specific to password fields.
 *
 * Extends the base admin options with password-specific settings.
 */
export interface PasswordFieldAdminOptions extends FieldAdminOptions {
  /**
   * HTML autocomplete attribute value.
   *
   * Use 'new-password' for registration forms,
   * 'current-password' for login forms.
   *
   * @default 'new-password'
   * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
   */
  autoComplete?: "new-password" | "current-password" | "off";

  /**
   * Show password strength indicator.
   *
   * When `true`, displays a visual indicator of password strength
   * based on length, character variety, and common patterns.
   *
   * @default false
   */
  showStrengthIndicator?: boolean;
}

// ============================================================
// Password Field Configuration
// ============================================================

/**
 * Configuration interface for password fields.
 *
 * Password fields are specialized text inputs that mask user input.
 * They render with `type="password"` in the Admin UI.
 *
 * **Important Security Notes:**
 * - Passwords should NEVER be stored in plain text
 * - Use a `beforeChange` hook to hash passwords before storage
 * - Set `read` access to `false` to prevent returning hashed passwords
 * - Consider using bcrypt, argon2, or similar secure hashing algorithms
 *
 * @example
 * ```typescript
 * // Basic password field
 * const passwordField: PasswordFieldConfig = {
 *   name: 'password',
 *   type: 'password',
 *   label: 'Password',
 *   required: true,
 *   minLength: 8,
 *   access: {
 *     read: () => false, // Never return password to client
 *   },
 *   hooks: {
 *     beforeChange: [
 *       async ({ value }) => {
 *         if (value) {
 *           return await bcrypt.hash(value, 10);
 *         }
 *         return value;
 *       },
 *     ],
 *   },
 * };
 *
 * // Password with strength requirements
 * const securePasswordField: PasswordFieldConfig = {
 *   name: 'password',
 *   type: 'password',
 *   label: 'Password',
 *   required: true,
 *   minLength: 12,
 *   maxLength: 128,
 *   admin: {
 *     showStrengthIndicator: true,
 *     description: 'Must be at least 12 characters with mixed case and numbers',
 *   },
 *   validate: (value) => {
 *     if (!value) return true;
 *     if (!/[A-Z]/.test(value)) return 'Must contain uppercase letter';
 *     if (!/[a-z]/.test(value)) return 'Must contain lowercase letter';
 *     if (!/[0-9]/.test(value)) return 'Must contain a number';
 *     return true;
 *   },
 * };
 * ```
 */
export interface PasswordFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'password'.
   */
  type: "password";

  /**
   * Minimum length for the password.
   *
   * Recommended minimum is 8 characters for general use,
   * 12+ characters for high-security applications.
   *
   * @default 8
   */
  minLength?: number;

  /**
   * Maximum length for the password.
   *
   * Should be set high enough to allow passphrases.
   * Most hashing algorithms handle up to 72-128 bytes.
   */
  maxLength?: number;

  /**
   * Default value for the field.
   *
   * **Warning:** Setting a default password is generally
   * not recommended for security reasons.
   */
  defaultValue?: string | ((data: Record<string, unknown>) => string);

  /**
   * Admin UI configuration options.
   */
  admin?: PasswordFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Use this to enforce password complexity requirements
   * like mixed case, numbers, or special characters.
   *
   * @param value - The password field value (string, null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * validate: (value) => {
   *   if (!value) return true;
   *
   *   // Check for common weak passwords
   *   const weakPasswords = ['password', '123456', 'qwerty'];
   *   if (weakPasswords.includes(value.toLowerCase())) {
   *     return 'Password is too common';
   *   }
   *
   *   // Require special character
   *   if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) {
   *     return 'Password must contain a special character';
   *   }
   *
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: PasswordFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
