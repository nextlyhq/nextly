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

// Base types (foundation for all field types)
// ============================================================
// Unified Field Config Types
// ============================================================

import type { RepeaterFieldConfig } from "./array";
import type { FieldType } from "./base";

// Text field configs
import type { CheckboxFieldConfig } from "./checkbox";
import type { ChipsFieldConfig } from "./chips";
import type { CodeFieldConfig } from "./code";
import type { ComponentFieldConfig } from "./component";
import type { DateFieldConfig } from "./date";
import type { EmailFieldConfig } from "./email";
import type { GroupFieldConfig } from "./group";
import type { JoinFieldConfig } from "./join";
import type { JSONFieldConfig } from "./json";
import type { NumberFieldConfig } from "./number";
import type { PasswordFieldConfig } from "./password";
import type { RadioFieldConfig } from "./radio";
import type { RelationshipFieldConfig } from "./relationship";
import type { RichTextFieldConfig } from "./rich-text";
import type { SelectFieldConfig } from "./select";
import type { TextFieldConfig } from "./text";
import type { TextareaFieldConfig } from "./textarea";

// Numeric field configs

// Selection field configs

// Media field configs
import type { UploadFieldConfig } from "./upload";

// Relational field configs

// Structured field configs

// Component field configs

// Virtual field configs (computed at read time, no data storage)

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
export * from "./array";
export * from "./group";

// Component field types
export * from "./component";

// Array-like field types
export * from "./chips";

// Virtual field types (computed at read time, no data storage)
export * from "./join";

export * from "./json";

/**
 * Union of all field configs that store data in the database.
 *
 * These field types create columns/fields in the database and
 * contribute to the document's data structure.
 *
 * Includes:
 * - Text types: text, textarea, richText, email, password, code
 * - Numeric types: number
 * - Selection types: checkbox, date, select, radio
 * - Media types: upload
 * - Relational types: relationship
 * - Structured types: array, group, json
 *
 * @example
 * ```typescript
 * function processDataField(field: DataFieldConfig) {
 *   // TypeScript knows this field stores data
 *   console.log(`Processing data field: ${field.name}`);
 * }
 * ```
 */
export type DataFieldConfig =
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
 * Union of all virtual field configs (computed at read time, no data storage).
 *
 * Virtual fields query related data at read time and display it in the Admin
 * Panel. They do not create database columns or store any data directly.
 *
 * Includes:
 * - join: Displays entries from another collection that reference this document
 *
 * @example
 * ```typescript
 * function isVirtualField(field: FieldConfig): field is VirtualFieldConfig {
 *   return VIRTUAL_FIELD_TYPES.includes(field.type as VirtualFieldType);
 * }
 * ```
 */
export type VirtualFieldConfig = JoinFieldConfig;

/**
 * Union of all field configurations.
 *
 * This is the primary type used when working with fields in Nextly.
 * It includes data-storing fields and virtual fields.
 *
 * Use `DataFieldConfig` when you specifically need data fields,
 * or `VirtualFieldConfig` for computed/virtual fields like join.
 *
 * @example
 * ```typescript
 * const fields: FieldConfig[] = [
 *   { type: 'text', name: 'title', required: true },
 *   { type: 'join', name: 'posts', collection: 'posts', on: 'author' },
 * ];
 * ```
 */
export type FieldConfig = DataFieldConfig | VirtualFieldConfig;

// ============================================================
// Field Type Constants
// ============================================================

/**
 * Field type for data-storing fields.
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
 * Field type for virtual fields (computed at read time, no data storage).
 * Extracted from FieldType for type-safe constant arrays.
 */
export type VirtualFieldType = "join";

/**
 * Array of field types that store data in the database.
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
 * Array of virtual field types (computed at read time, no database column).
 *
 * Use this constant for runtime type checking and filtering.
 *
 * @example
 * ```typescript
 * if (VIRTUAL_FIELD_TYPES.includes(field.type)) {
 *   // This field is virtual, skip database generation
 *   return;
 * }
 * ```
 */
export const VIRTUAL_FIELD_TYPES: readonly VirtualFieldType[] = [
  "join",
] as const;

/**
 * Array of all supported field types.
 *
 * Combines data-storing and virtual field types.
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
  ...VIRTUAL_FIELD_TYPES,
] as const;
