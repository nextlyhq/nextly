/**
 * Radio Field Type
 *
 * A radio button group field that allows selecting a single value
 * from predefined options. Unlike select fields, all options are
 * visible at once.
 *
 * @module collections/fields/types/radio
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";
import type { SelectOption } from "./select";

// ============================================================
// Radio Field Value Type
// ============================================================

/**
 * Possible value types for a radio field.
 *
 * Radio fields always store a single value (unlike select which can have hasMany).
 *
 * - `string` - Selected option value
 * - `null` - Explicitly empty value
 * - `undefined` - Value not set
 */
export type RadioFieldValue = string | null | undefined;

// ============================================================
// Radio Layout Type
// ============================================================

/**
 * Layout direction for radio button options.
 */
export type RadioLayout = "horizontal" | "vertical";

// ============================================================
// Radio Field Admin Options
// ============================================================

/**
 * Admin panel options specific to radio fields.
 *
 * Extends the base admin options with radio-specific settings
 * like layout direction.
 */
export interface RadioFieldAdminOptions extends FieldAdminOptions {
  /**
   * Layout direction for radio buttons.
   *
   * - `'horizontal'` - Options displayed in a row (default)
   * - `'vertical'` - Options displayed in a column
   *
   * @default 'horizontal'
   */
  layout?: RadioLayout;
}

// ============================================================
// Radio Field Configuration
// ============================================================

/**
 * Configuration interface for radio fields.
 *
 * Radio fields display all options as radio buttons, allowing
 * users to select exactly one value. Unlike select dropdowns,
 * all options are visible at once, making them ideal for small
 * sets of mutually exclusive choices.
 *
 * **Use Cases:**
 * - Yes/No/Maybe choices
 * - Size selection (S, M, L, XL)
 * - Rating scales with few options
 * - Priority levels
 * - Payment methods
 *
 * @example
 * ```typescript
 * // Basic radio field
 * const genderField: RadioFieldConfig = {
 *   name: 'gender',
 *   type: 'radio',
 *   label: 'Gender',
 *   options: [
 *     { label: 'Male', value: 'male' },
 *     { label: 'Female', value: 'female' },
 *     { label: 'Other', value: 'other' },
 *     { label: 'Prefer not to say', value: 'not_specified' },
 *   ],
 *   admin: {
 *     layout: 'vertical',
 *   },
 * };
 *
 * // Size selection with horizontal layout
 * const sizeField: RadioFieldConfig = {
 *   name: 'size',
 *   type: 'radio',
 *   label: 'Size',
 *   required: true,
 *   defaultValue: 'medium',
 *   options: [
 *     { label: 'S', value: 'small' },
 *     { label: 'M', value: 'medium' },
 *     { label: 'L', value: 'large' },
 *     { label: 'XL', value: 'xlarge' },
 *   ],
 *   admin: {
 *     layout: 'horizontal',
 *   },
 * };
 *
 * // Payment method selection
 * const paymentMethodField: RadioFieldConfig = {
 *   name: 'paymentMethod',
 *   type: 'radio',
 *   label: 'Payment Method',
 *   required: true,
 *   options: [
 *     { label: 'Credit Card', value: 'credit_card' },
 *     { label: 'PayPal', value: 'paypal' },
 *     { label: 'Bank Transfer', value: 'bank_transfer' },
 *   ],
 *   admin: {
 *     layout: 'vertical',
 *     description: 'Select your preferred payment method',
 *   },
 * };
 *
 * // Rating with custom validation
 * const satisfactionField: RadioFieldConfig = {
 *   name: 'satisfaction',
 *   type: 'radio',
 *   label: 'How satisfied are you?',
 *   required: true,
 *   options: [
 *     { label: 'Very Dissatisfied', value: '1' },
 *     { label: 'Dissatisfied', value: '2' },
 *     { label: 'Neutral', value: '3' },
 *     { label: 'Satisfied', value: '4' },
 *     { label: 'Very Satisfied', value: '5' },
 *   ],
 *   admin: {
 *     layout: 'horizontal',
 *   },
 * };
 *
 * // Conditional radio field
 * const shippingSpeedField: RadioFieldConfig = {
 *   name: 'shippingSpeed',
 *   type: 'radio',
 *   label: 'Shipping Speed',
 *   options: [
 *     { label: 'Standard (5-7 days)', value: 'standard' },
 *     { label: 'Express (2-3 days)', value: 'express' },
 *     { label: 'Overnight', value: 'overnight' },
 *   ],
 *   defaultValue: 'standard',
 *   admin: {
 *     layout: 'vertical',
 *     condition: {
 *       field: 'requiresShipping',
 *       equals: true,
 *     },
 *   },
 * };
 *
 * // With custom enum name for TypeScript generation
 * const statusField: RadioFieldConfig = {
 *   name: 'approvalStatus',
 *   type: 'radio',
 *   label: 'Approval Status',
 *   enumName: 'ApprovalStatus',
 *   interfaceName: 'ApprovalStatusType',
 *   options: [
 *     { label: 'Pending', value: 'pending' },
 *     { label: 'Approved', value: 'approved' },
 *     { label: 'Rejected', value: 'rejected' },
 *   ],
 * };
 * ```
 */
export interface RadioFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'radio'.
   */
  type: "radio";

  /**
   * Available options for selection.
   *
   * Array of options with label (displayed) and value (stored).
   * All options are displayed as radio buttons.
   *
   * **Important:** Option values should be strings without hyphens
   * or special characters due to GraphQL enumeration naming constraints.
   * Underscores are allowed.
   */
  options: SelectOption[];

  /**
   * Custom enum name for SQL databases and TypeScript generation.
   *
   * If not provided, an enum name will be auto-generated from
   * the collection and field name.
   *
   * @example 'ShippingSpeed', 'PaymentMethod'
   */
  enumName?: string;

  /**
   * Interface name for TypeScript and GraphQL type generation.
   *
   * Creates a reusable top-level type that can be referenced
   * elsewhere in your schema.
   *
   * @example 'ShippingSpeedType', 'PaymentMethodType'
   */
  interfaceName?: string;

  /**
   * Default value for the field.
   *
   * Must be one of the values defined in the `options` array.
   * Can be a static value or a function that returns a value.
   *
   * @example
   * ```typescript
   * // Static default
   * defaultValue: 'medium'
   *
   * // Dynamic default
   * defaultValue: (data) => data.isPremium ? 'express' : 'standard'
   * ```
   */
  defaultValue?: string | ((data: Record<string, unknown>) => string);

  /**
   * Admin UI configuration options.
   */
  admin?: RadioFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the typed radio value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The radio field value (string, null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Validate based on other field values
   * validate: (value, { data }) => {
   *   if (value === 'overnight' && data.weight > 50) {
   *     return 'Overnight shipping not available for items over 50kg';
   *   }
   *   return true;
   * }
   *
   * // Role-based validation
   * validate: (value, { req }) => {
   *   if (value === 'approved' && req.user?.role !== 'admin') {
   *     return 'Only admins can set status to approved';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: RadioFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
