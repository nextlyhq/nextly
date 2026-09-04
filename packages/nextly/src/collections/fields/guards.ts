/**
 * Field Type Guards
 *
 * Runtime type guard functions for narrowing FieldConfig union types.
 * Uses discriminated union pattern based on the `type` property.
 *
 * @module collections/fields/guards
 * @since 1.0.0
 */

import { isFieldGroupType } from "../../domains/field-groups/storage/field-group-field-type";

import type {
  // Text field types
  TextFieldConfig,
  TextareaFieldConfig,
  RichTextFieldConfig,
  EmailFieldConfig,
  PasswordFieldConfig,
  CodeFieldConfig,
  // Numeric field types
  NumberFieldConfig,
  // Selection field types
  CheckboxFieldConfig,
  DateFieldConfig,
  SelectFieldConfig,
  RadioFieldConfig,
  // Media field types
  UploadFieldConfig,
  // Relational field types
  RelationshipFieldConfig,
  // Structured field types
  RepeaterFieldConfig,
  GroupFieldConfig,
  JSONFieldConfig,
  // Component field types
  FieldGroupFieldConfig,
  // Chips field type
  ChipsFieldConfig,
  // Union types
  FieldConfig,
  DataFieldConfig,
} from "./types";
import { DATA_FIELD_TYPES } from "./types";
import type { FieldType } from "./types/base";

// ============================================================
// Generic Type Guard Factory
// ============================================================

/**
 * Creates a type guard function for a specific field type.
 *
 * This factory function generates type-safe guards that narrow
 * the FieldConfig union to a specific field config type.
 *
 * @param type - The field type string to check against
 * @returns A type guard function that narrows FieldConfig to T
 *
 * @example
 * ```typescript
 * const isTextField = createTypeGuard<TextFieldConfig>("text");
 * if (isTextField(field)) {
 *   // field is now TextFieldConfig
 *   console.log(field.hasMany);
 * }
 * ```
 */
function createTypeGuard<T extends FieldConfig>(type: FieldType) {
  // Accepts any discriminated field shape (not just FieldConfig) so callers
  // holding a wider surface union — e.g. user fields, which add types the
  // canonical union does not know — can narrow without casting.
  return (field: { type: string }): field is T => field.type === type;
}

// ============================================================
// Individual Type Guards - Text Fields
// ============================================================

/**
 * Type guard for text field config.
 *
 * @example
 * ```typescript
 * if (isTextField(field)) {
 *   console.log(field.hasMany, field.minLength, field.maxLength);
 * }
 * ```
 */
export const isTextField = createTypeGuard<TextFieldConfig>("text");

/**
 * Type guard for textarea field config.
 *
 * @example
 * ```typescript
 * if (isTextareaField(field)) {
 *   console.log(field.rows);
 * }
 * ```
 */
export const isTextareaField = createTypeGuard<TextareaFieldConfig>("textarea");

/**
 * Type guard for rich text field config.
 *
 * @example
 * ```typescript
 * if (isRichTextField(field)) {
 *   console.log(field.features);
 * }
 * ```
 */
export const isRichTextField = createTypeGuard<RichTextFieldConfig>("richText");

/**
 * Type guard for email field config.
 *
 * @example
 * ```typescript
 * if (isEmailField(field)) {
 *   // Email field has auto-validation
 * }
 * ```
 */
export const isEmailField = createTypeGuard<EmailFieldConfig>("email");

/**
 * Type guard for password field config.
 *
 * @example
 * ```typescript
 * if (isPasswordField(field)) {
 *   console.log(field.minLength, field.maxLength);
 * }
 * ```
 */
export const isPasswordField = createTypeGuard<PasswordFieldConfig>("password");

/**
 * Type guard for code field config.
 *
 * @example
 * ```typescript
 * if (isCodeField(field)) {
 *   console.log(field.language, field.editorOptions);
 * }
 * ```
 */
export const isCodeField = createTypeGuard<CodeFieldConfig>("code");

// ============================================================
// Individual Type Guards - Numeric Fields
// ============================================================

/**
 * Type guard for number field config.
 *
 * @example
 * ```typescript
 * if (isNumberField(field)) {
 *   console.log(field.min, field.max, field.step);
 * }
 * ```
 */
export const isNumberField = createTypeGuard<NumberFieldConfig>("number");

// ============================================================
// Individual Type Guards - Selection Fields
// ============================================================

/**
 * Type guard for checkbox field config.
 *
 * @example
 * ```typescript
 * if (isCheckboxField(field)) {
 *   console.log(field.defaultValue); // boolean
 * }
 * ```
 */
export const isCheckboxField = (field: {
  type: string;
}): field is CheckboxFieldConfig => field.type === "checkbox";

/**
 * Type guard for date field config.
 *
 * @example
 * ```typescript
 * if (isDateField(field)) {
 *   console.log(field.admin?.date?.pickerAppearance);
 * }
 * ```
 */
export const isDateField = createTypeGuard<DateFieldConfig>("date");

/**
 * Type guard for select field config.
 *
 * @example
 * ```typescript
 * if (isSelectField(field)) {
 *   console.log(field.options, field.hasMany);
 * }
 * ```
 */
export const isSelectField = createTypeGuard<SelectFieldConfig>("select");

/**
 * Type guard for radio field config.
 *
 * @example
 * ```typescript
 * if (isRadioField(field)) {
 *   console.log(field.options, field.admin?.layout);
 * }
 * ```
 */
export const isRadioField = createTypeGuard<RadioFieldConfig>("radio");

// ============================================================
// Individual Type Guards - Media Fields
// ============================================================

/**
 * Type guard for upload field config.
 *
 * @example
 * ```typescript
 * if (isUploadField(field)) {
 *   console.log(field.relationTo, field.hasMany);
 * }
 * ```
 */
export const isUploadField = createTypeGuard<UploadFieldConfig>("upload");

// ============================================================
// Individual Type Guards - Relational Fields
// ============================================================

/**
 * Type guard for relationship field config.
 *
 * @example
 * ```typescript
 * if (isRelationshipField(field)) {
 *   console.log(field.relationTo, field.hasMany, field.maxDepth);
 * }
 * ```
 */
export const isRelationshipField =
  createTypeGuard<RelationshipFieldConfig>("relationship");

// ============================================================
// Individual Type Guards - Structured Fields
// ============================================================

/**
 * Type guard for repeater field config.
 *
 * @example
 * ```typescript
 * if (isRepeaterField(field)) {
 *   console.log(field.fields, field.minRows, field.maxRows);
 * }
 * ```
 */
export function isRepeaterField(
  field: FieldConfig
): field is RepeaterFieldConfig {
  return field.type === "repeater";
}

/**
 * Type guard for group field config.
 *
 * @example
 * ```typescript
 * if (isGroupField(field)) {
 *   console.log(field.fields, field.admin?.hideGutter);
 * }
 * ```
 */
export const isGroupField = createTypeGuard<GroupFieldConfig>("group");

/**
 * Type guard for JSON field config.
 *
 * @example
 * ```typescript
 * if (isJSONField(field)) {
 *   console.log(field.jsonSchema, field.editorOptions);
 * }
 * ```
 */
export const isJSONField = createTypeGuard<JSONFieldConfig>("json");

// ============================================================
// Individual Type Guards - Component Fields
// ============================================================

/**
 * Type guard for component field config.
 *
 * @example
 * ```typescript
 * if (isFieldGroupField(field)) {
 *   console.log(field.component, field.components, field.repeatable);
 * }
 * ```
 */
export function isFieldGroupField(
  field: { type: string }
): field is FieldGroupFieldConfig {
  return isFieldGroupType(field.type);
}

// ============================================================
// Individual Type Guards - Chips Fields
// ============================================================

/**
 * Type guard for chips field config.
 *
 * @example
 * ```typescript
 * if (isChipsField(field)) {
 *   console.log(field.maxChips, field.minChips);
 * }
 * ```
 */
export const isChipsField = createTypeGuard<ChipsFieldConfig>("chips");

// ============================================================
// Category Guards
// ============================================================

/**
 * Type guard for data-storing fields.
 *
 * Returns true if the field stores data in the database.
 *
 * @example
 * ```typescript
 * if (isDataField(field)) {
 *   // Generate database column for this field
 *   generateColumn(field);
 * }
 * ```
 */
export function isDataField(field: { type: string }): field is DataFieldConfig {
  return (DATA_FIELD_TYPES as readonly string[]).includes(field.type);
}

/**
 * Type guard for fields that contain nested fields.
 *
 * Returns true for array and group fields.
 * These field types have a `fields` property containing
 * nested field configurations.
 *
 * @example
 * ```typescript
 * if (hasNestedFields(field)) {
 *   // Recursively process nested fields
 *   const nestedFields = 'fields' in field ? field.fields : [];
 *   nestedFields.forEach(processField);
 * }
 * ```
 */
export const NESTED_FIELD_TYPES = ["repeater", "group"] as const;

/**
 * The same question asked of a field whose `type` is an open string.
 *
 * A contributed field type is not a member of `FieldType`, so it cannot reach
 * {@link hasNestedFields} — and `PluginFieldInput` carries an index signature,
 * so such a field may legally hold a `fields` option of ANY shape as its own
 * private configuration. Reading that as a nested field list runs other types'
 * rules over data that is not a field list, which is why `fields-payload.ts`
 * walks nested fields for the container types only.
 *
 * Sharing the set rather than repeating the two names keeps the answer in one
 * place: a third container type added to the union would otherwise be a nested
 * list here and not there.
 */
export function typeHasNestedFields(type: string): boolean {
  return (NESTED_FIELD_TYPES as readonly string[]).includes(type);
}

export function hasNestedFields(
  field: FieldConfig
): field is RepeaterFieldConfig | GroupFieldConfig {
  // Delegated rather than repeating the membership test. Sharing only the SET
  // leaves two evaluations of one question, and a later change to what counts
  // as a container — a type that carries nested fields conditionally, say —
  // would reach whichever of them the author was editing.
  return typeHasNestedFields(field.type);
}

/**
 * Type guard for relational fields.
 *
 * Returns true for relationship and upload fields.
 * These field types reference other collections via `relationTo`.
 *
 * @example
 * ```typescript
 * if (isRelationalField(field)) {
 *   console.log(field.relationTo, field.hasMany, field.maxDepth);
 * }
 * ```
 */
export function isRelationalField(
  field: FieldConfig
): field is RelationshipFieldConfig | UploadFieldConfig {
  return ["relationship", "upload"].includes(field.type);
}
