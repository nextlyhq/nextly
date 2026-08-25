/**
 * Nested Field Defaults Helper
 *
 * Provides a single unified implementation for computing default values for nested sub-fields
 * within structured admin components (such as ComponentInput and RepeaterInput).
 *
 * @module components/entries/fields/structured/nested-field-defaults
 */

import type { FieldConfig } from "nextly/config";
import { writeFieldGroupType } from "nextly/field-group-type";

export interface CreateDefaultFieldValuesOptions {
  /**
   * Optional component type slug (for multi-component / dynamic zone instances).
   * When provided, writes the field group type discriminator onto the returned object.
   */
  componentType?: string;
}

/**
 * Text-like field types whose unset form input expects an empty string rather
 * than null. Mirrors the `DECLARED_DEFAULT` table in `lib/form/default-values`
 * so that newly-appended component/repeater rows seed the same values that the
 * entry editor uses on the initial create form.
 */
const STRING_SEED_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "email",
  "password",
  "code",
]);

const SCALAR_DEFAULTS: Record<string, unknown> = {
  checkbox: false,
  number: null,
  repeater: [],
};

/**
 * Returns the type-specific fallback default for a field that has no explicit defaultValue.
 *
 * Keeping this separate from {@link getFieldDefault} keeps each function's cyclomatic
 * complexity below the project threshold.
 */
function getTypeDefault(type: string, subField: FieldConfig): unknown {
  if (type in SCALAR_DEFAULTS) return SCALAR_DEFAULTS[type];
  if (type === "group") {
    const fields = (subField as { fields?: FieldConfig[] }).fields;
    return fields ? createDefaultFieldValues(fields) : {};
  }
  if (type === "component") {
    return (subField as { repeatable?: boolean }).repeatable ? [] : null;
  }
  return (subField as { defaultValue?: unknown }).defaultValue ?? null;
}

/**
 * Computes the default value for an individual field configuration.
 *
 * If the field declares an explicit `defaultValue`, that takes priority (calling it
 * when it is a function). Otherwise delegates to {@link getTypeDefault}, with two
 * overrides that align with {@link getDefaultValues} in `lib/form/default-values`:
 * - String-like fields (`text`, `textarea`, etc.) seed `""` rather than `null`.
 * - `chips` seeds `[]` rather than `null`.
 */
function getFieldDefault(subField: FieldConfig): unknown {
  const declared = (subField as { defaultValue?: unknown }).defaultValue;
  if ("defaultValue" in subField && declared !== undefined) {
    return typeof declared === "function" ? declared({}) : declared;
  }
  // Align with getDefaultValues: string-like fields seed "" and chips seed [].
  if (STRING_SEED_TYPES.has(subField.type)) return "";
  if ((subField.type as string) === "chips") return [];
  return getTypeDefault(subField.type, subField);
}

/**
 * Computes default values for an array of nested sub-fields based on schema configuration.
 *
 * Evaluation rules per sub-field:
 * 1. Fields without a `name` are skipped (layout-only elements).
 * 2. If `defaultValue` is explicitly defined:
 *    - Function defaultValue is invoked with `{}`.
 *    - Literal defaultValue is used as-is.
 * 3. Otherwise, sensible fallbacks are applied by field type:
 *    - `checkbox` -> `false`
 *    - `number` -> `null`
 *    - `repeater` -> `[]`
 *    - `group` -> recursively creates default values for `subField.fields` (or `{}` if empty)
 *    - `component` -> `[]` if repeatable, else `null`
 *    - fallback (text, textarea, select, custom plugin fields, etc.) -> `subField.defaultValue ?? null`
 *
 * @param fields - Array of sub-field configurations from the schema
 * @param options - Optional configuration options including componentType discriminator
 * @returns An object containing default field values mapped by field name
 */
export function createDefaultFieldValues(
  fields: FieldConfig[] | undefined,
  options?: CreateDefaultFieldValuesOptions
): Record<string, unknown> {
  const defaultValues: Record<string, unknown> = {};

  // In multi-component mode, record the field group discriminator
  if (options?.componentType) {
    writeFieldGroupType(defaultValues, options.componentType);
  }

  if (!fields) return defaultValues;

  for (const subField of fields) {
    // Only process fields with valid names
    if (!("name" in subField) || !subField.name) continue;

    const fieldName = (subField as { name: string }).name;
    defaultValues[fieldName] = getFieldDefault(subField);
  }

  return defaultValues;
}
