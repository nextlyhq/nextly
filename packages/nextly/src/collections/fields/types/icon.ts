/**
 * Icon Field Type
 *
 * A field holding one icon id of the form `<set>:<name>`, for example
 * `"lucide:star"`. The value is a plain string stored in a text column,
 * the same way an email field is stored.
 *
 * Only the id's SHAPE is checked when a value is saved. Icon sets are
 * registered at runtime, so an id naming an unknown set or an unknown icon
 * is stored as given and reported as an issue elsewhere, never refused.
 *
 * @module collections/fields/types/icon
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  FieldValidation,
  RequestContext,
} from "./base";

// ============================================================
// Icon Field Value Type
// ============================================================

/**
 * Possible value types for an icon field: an icon id such as
 * `"lucide:star"`, or nothing.
 */
export type IconFieldValue = string | null | undefined;

// ============================================================
// Icon Id Shape
// ============================================================

/**
 * The shape every stored icon id has: a set prefix and an icon name, each
 * of lowercase letters, digits and hyphens, joined by one colon
 * (`"lucide:star"`, `"lucide:arrow-up-right"`). The config validator, the
 * zod schema and the write-path validator all read this one pattern.
 */
export const ICON_ID_PATTERN: RegExp = /^[a-z0-9-]+:[a-z0-9-]+$/;

/**
 * Whether a value has the icon id shape. Checks the shape only: whether
 * the set and the icon exist is a runtime question this does not answer.
 */
export function isIconIdShape(value: unknown): value is string {
  return typeof value === "string" && ICON_ID_PATTERN.test(value);
}

// ============================================================
// Icon Field Configuration
// ============================================================

/**
 * Configuration interface for icon fields.
 *
 * The Admin UI renders an icon picker; the stored value is the chosen
 * icon's id.
 *
 * @example
 * ```typescript
 * const iconField: IconFieldConfig = {
 *   name: 'icon',
 *   type: 'icon',
 *   label: 'Icon',
 *   defaultValue: 'lucide:star',
 * };
 * ```
 */
export interface IconFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'icon'.
   */
  type: "icon";

  /**
   * Default icon id, in the `<set>:<name>` shape (for example
   * `"lucide:star"`). A value of any other shape is refused when the
   * config is validated.
   */
  defaultValue?: string;

  /**
   * Admin UI configuration options.
   */
  admin?: FieldAdminOptions;

  /**
   * Nested validation knobs. Mirrors the Schema Builder shape so code-first
   * config and the Builder UI converge on one source of truth.
   */
  validation?: FieldValidation;

  /**
   * Custom validation function.
   *
   * Runs in addition to the built-in id shape check.
   *
   * @param value - The icon id (string, null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   */
  validate?: (
    value: IconFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
