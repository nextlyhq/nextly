/**
 * Field Types - Public Exports
 *
 * Re-exports all field type definitions for external consumption.
 * Provides unified FieldConfig type and field type categorization.
 *
 * @module collections/fields/types
 * @since 1.0.0
 */

// ============================================================
// Re-exports from individual field type modules
// ============================================================

import type { FieldType } from "./base";
import type { CheckboxFieldConfig } from "./checkbox";
import type { ChipsFieldConfig } from "./chips";
import type { CodeFieldConfig } from "./code";
import type { ComponentFieldConfig } from "./component";
import type { DateFieldConfig } from "./date";
import type { EmailFieldConfig } from "./email";
import type { GroupFieldConfig } from "./group";
import type { JSONFieldConfig } from "./json";
import type { NumberFieldConfig } from "./number";
import type { PasswordFieldConfig } from "./password";
import type { RadioFieldConfig } from "./radio";
import type { RelationshipFieldConfig } from "./relationship";
import type { RepeaterFieldConfig } from "./repeater";
import type { RichTextFieldConfig } from "./rich-text";
import type { SelectFieldConfig } from "./select";
import type { TextFieldConfig } from "./text";
import type { TextareaFieldConfig } from "./textarea";
import type { UploadFieldConfig } from "./upload";

export * from "./base";

// Text field types
export * from "./text";
export * from "./textarea";
export * from "./rich-text";
export * from "./email";
export * from "./password";
export * from "./code";

// Numeric field types
export * from "./number";

// Selection field types
export * from "./checkbox";
export * from "./date";
export * from "./select";
export * from "./radio";

// Media field types
export * from "./upload";

// Relational field types
export * from "./relationship";

// Structured field types
export * from "./repeater";
export * from "./group";

// Component field types
export * from "./component";

// Array-like field types
export * from "./chips";

export * from "./json";

/**
 * Union of all field configurations.
 *
 * This is the primary type used when working with fields in Nextly.
 * It covers all data-storing field types.
 *
 * @example
 * ```typescript
 * const fields: FieldConfig[] = [
 *   { type: 'text', name: 'title', required: true },
 *   { type: 'relationship', name: 'author', relationTo: 'users' },
 * ];
 * ```
 */
export type FieldConfig =
  | TextFieldConfig
  | TextareaFieldConfig
  | RichTextFieldConfig
  | EmailFieldConfig
  | PasswordFieldConfig
  | CodeFieldConfig
  | NumberFieldConfig
  | CheckboxFieldConfig
  | DateFieldConfig
  | SelectFieldConfig
  | RadioFieldConfig
  | UploadFieldConfig
  | RelationshipFieldConfig
  | RepeaterFieldConfig
  | GroupFieldConfig
  | JSONFieldConfig
  | ComponentFieldConfig
  | ChipsFieldConfig;

/**
 * Alias for FieldConfig — all fields store data in the database.
 *
 * @deprecated Use `FieldConfig` directly. `DataFieldConfig` is kept
 * for backwards compatibility.
 */
export type DataFieldConfig = FieldConfig;

// ============================================================
// Field Type Constants
// ============================================================

/**
 * Field type string union — all supported field types.
 * Extracted from FieldType for type-safe constant arrays.
 */
export type DataFieldType =
  | "text"
  | "textarea"
  | "richText"
  | "email"
  | "password"
  | "code"
  | "number"
  | "checkbox"
  | "date"
  | "select"
  | "radio"
  | "upload"
  | "relationship"
  | "repeater"
  | "group"
  | "json"
  | "component"
  | "chips";

/**
 * Array of all supported field types.
 *
 * Use this constant for runtime type checking and filtering.
 *
 * @example
 * ```typescript
 * if (DATA_FIELD_TYPES.includes(field.type)) {
 *   // This field stores data
 *   generateDatabaseColumn(field);
 * }
 * ```
 */
export const DATA_FIELD_TYPES: readonly DataFieldType[] = [
  "text",
  "textarea",
  "richText",
  "email",
  "password",
  "code",
  "number",
  "checkbox",
  "date",
  "select",
  "radio",
  "upload",
  "relationship",
  "repeater",
  "group",
  "json",
  "component",
  "chips",
] as const;

/**
 * Array of all supported field types.
 *
 * @example
 * ```typescript
 * if (!ALL_FIELD_TYPES.includes(field.type)) {
 *   throw new Error(`Unknown field type: ${field.type}`);
 * }
 * ```
 */
export const ALL_FIELD_TYPES: readonly FieldType[] = [
  ...DATA_FIELD_TYPES,
] as const;
