/**
 * Chips Field Type
 *
 * A free-form multi-value string field that stores an array of strings.
 * Renders as interactive chips/tags in the Admin UI.
 *
 * @module collections/fields/types/chips
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Chips Field Value Type
// ============================================================

/**
 * Possible value types for a chips field.
 */
export type ChipsFieldValue = string[] | null | undefined;

// ============================================================
// Chips Field Admin Options
// ============================================================

/**
 * Admin panel options specific to chips fields.
 */
export interface ChipsFieldAdminOptions extends FieldAdminOptions {
  /**
   * Placeholder text for the chip input.
   * @default 'Type and press Enter to add'
   */
  placeholder?: string;
}

// ============================================================
// Chips Field Configuration
// ============================================================

/**
 * Configuration interface for chips fields.
 *
 * Chips fields store an array of unique free-form strings.
 * Renders as interactive chips/tags with add/remove capability.
 * Duplicate values are automatically prevented.
 *
 * @example
 * ```typescript
 * // Basic chips field
 * chips({ name: 'tags', label: 'Tags' })
 *
 * // With max limit
 * chips({ name: 'keywords', label: 'Keywords', maxChips: 10 })
 *
 * // Required with minimum
 * chips({ name: 'categories', required: true, minChips: 1, maxChips: 5 })
 * ```
 */
export interface ChipsFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'chips'.
   */
  type: "chips";

  /**
   * Default value for the field.
   */
  defaultValue?: string[] | ((data: Record<string, unknown>) => string[]);

  /**
   * Maximum number of chips allowed.
   * When reached, the add input is hidden.
   */
  maxChips?: number;

  /**
   * Minimum number of chips required (used for validation).
   */
  minChips?: number;

  /**
   * Admin UI configuration options.
   */
  admin?: ChipsFieldAdminOptions;

  /**
   * Custom validation function.
   */
  validate?: (
    value: ChipsFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
