/**
 * Number Field Type
 *
 * A numeric input field that stores integer or decimal values.
 * Supports single or multiple values (hasMany), min/max validation,
 * and customizable step increments.
 *
 * @module collections/fields/types/number
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  FieldValidation,
  RequestContext,
} from "./base";

// ============================================================
// Number Field Value Type
// ============================================================

/**
 * Possible value types for a number field.
 *
 * - `number` - Single numeric value (default)
 * - `number[]` - Multiple numeric values (when `hasMany: true`)
 * - `null` - Explicitly empty value
 * - `undefined` - Value not set
 */
export type NumberFieldValue = number | number[] | null | undefined;

// ============================================================
// Number Field Admin Options
// ============================================================

/**
 * Admin panel options specific to number fields.
 *
 * Extends the base admin options with number-specific settings
 * like step increment and placeholder text.
 */
export interface NumberFieldAdminOptions extends FieldAdminOptions {
  /**
   * Step increment for the number input.
   *
   * Controls the increment/decrement amount when using
   * spinner buttons or arrow keys.
   *
   * @example 1, 0.1, 0.01, 5, 10
   * @default 1
   */
  step?: number;

  /**
   * Placeholder text displayed when the input is empty.
   *
   * @example 'Enter quantity', '0.00'
   */
  placeholder?: string;
}

// ============================================================
// Number Field Configuration
// ============================================================

/**
 * Configuration interface for number fields.
 *
 * Number fields store numeric values (integers or decimals) and
 * support range validation, step increments, and multiple values.
 *
 * **Use Cases:**
 * - Quantities, counts, amounts
 * - Prices, percentages, ratings
 * - Coordinates, dimensions, measurements
 * - Any numeric data requiring validation
 *
 * @example
 * ```typescript
 * // Basic number field
 * const priceField: NumberFieldConfig = {
 *   name: 'price',
 *   type: 'number',
 *   label: 'Price',
 *   required: true,
 *   min: 0,
 *   admin: {
 *     step: 0.01,
 *     placeholder: '0.00',
 *   },
 * };
 *
 * // Number field with range validation
 * const ratingField: NumberFieldConfig = {
 *   name: 'rating',
 *   type: 'number',
 *   label: 'Rating',
 *   min: 1,
 *   max: 5,
 *   admin: {
 *     step: 1,
 *     description: 'Rate from 1 to 5 stars',
 *   },
 * };
 *
 * // Number field with multiple values
 * const dimensionsField: NumberFieldConfig = {
 *   name: 'dimensions',
 *   type: 'number',
 *   label: 'Dimensions (cm)',
 *   hasMany: true,
 *   minRows: 3,
 *   maxRows: 3,
 *   min: 0,
 *   admin: {
 *     description: 'Enter length, width, height',
 *   },
 * };
 *
 * // Percentage field
 * const discountField: NumberFieldConfig = {
 *   name: 'discount',
 *   type: 'number',
 *   label: 'Discount',
 *   min: 0,
 *   max: 100,
 *   defaultValue: 0,
 *   admin: {
 *     step: 1,
 *     description: 'Discount percentage (0-100%)',
 *   },
 *   validate: (value) => {
 *     if (value !== null && value !== undefined && !Number.isInteger(value)) {
 *       return 'Discount must be a whole number';
 *     }
 *     return true;
 *   },
 * };
 * ```
 */
export interface NumberFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'number'.
   */
  type: "number";

  /**
   * Minimum allowed value.
   *
   * Validation will fail if the value is less than this number.
   * Use for range constraints like prices (min: 0) or ratings (min: 1).
   */
  min?: number;

  /**
   * Maximum allowed value.
   *
   * Validation will fail if the value exceeds this number.
   * Use for range constraints like percentages (max: 100) or ratings (max: 5).
   */
  max?: number;

  /**
   * Allow multiple numeric values.
   *
   * When `true`, the field accepts an array of numbers instead of a single number.
   * In the Admin UI, this renders as a multi-value input with add/remove buttons.
   *
   * @default false
   */
  hasMany?: boolean;

  /**
   * Minimum number of items when `hasMany` is true.
   *
   * Validation will fail if fewer items are provided.
   */
  minRows?: number;

  /**
   * Maximum number of items when `hasMany` is true.
   *
   * Validation will fail if more items are provided.
   * The Admin UI will disable the add button when this limit is reached.
   */
  maxRows?: number;

  /**
   * Default value for the field.
   *
   * Can be a static number/array or a function that returns one.
   *
   * @example
   * ```typescript
   * // Static default
   * defaultValue: 0
   *
   * // Dynamic default
   * defaultValue: () => Date.now()
   *
   * // Array default (when hasMany: true)
   * defaultValue: [0, 0, 0]
   * ```
   */
  defaultValue?:
    | number
    | number[]
    | ((data: Record<string, unknown>) => number | number[]);

  /**
   * Admin UI configuration options.
   */
  admin?: NumberFieldAdminOptions;

  /**
   * Nested validation knobs. Mirrors the Schema Builder shape so code-first
   * config and the Builder UI converge on one source of truth.
   */
  validation?: FieldValidation;

  /**
   * Custom validation function.
   *
   * Receives the typed number value and returns `true` for valid
   * or an error message string for invalid. Runs after built-in
   * min/max validation.
   *
   * @param value - The number field value (number, number[], null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Require integer values only
   * validate: (value) => {
   *   if (value !== null && value !== undefined) {
   *     if (Array.isArray(value)) {
   *       if (!value.every(Number.isInteger)) {
   *         return 'All values must be integers';
   *       }
   *     } else if (!Number.isInteger(value)) {
   *       return 'Value must be an integer';
   *     }
   *   }
   *   return true;
   * }
   *
   * // Require even numbers
   * validate: (value) => {
   *   if (typeof value === 'number' && value % 2 !== 0) {
   *     return 'Value must be an even number';
   *   }
   *   return true;
   * }
   *
   * // Custom business logic
   * validate: (value, { data }) => {
   *   if (typeof value === 'number' && data.type === 'premium' && value < 100) {
   *     return 'Premium products must cost at least $100';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: NumberFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
