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
 * Returns the type-specific fallback default for a field that has no explicit defaultValue.
 *
 * Keeping this separate from {@link getFieldDefault} keeps each function's cyclomatic
 * complexity below the project threshold.
 */
function getTypeDefault(type: string, subField: FieldConfig): unknown {
  switch (type) {
    case "checkbox":
      return false;
    case "number":
      return null;
    case "repeater":
      return [];
    case "group":
      return "fields" in subField
        ? createDefaultFieldValues(subField.fields as FieldConfig[])
        : {};
    case "component":
      return "repeatable" in subField && subField.repeatable ? [] : null;
    default:
      return (subField as { defaultValue?: unknown }).defaultValue ?? null;
  }
}

/**
 * Computes the default value for an individual field configuration.
 *
 * If the field declares an explicit `defaultValue`, that takes priority (calling it
 * when it is a function). Otherwise delegates to {@link getTypeDefault}.
 */
function getFieldDefault(subField: FieldConfig): unknown {
  if ("defaultValue" in subField && subField.defaultValue !== undefined) {
    return typeof subField.defaultValue === "function"
      ? subField.defaultValue({})
      : subField.defaultValue;
  }
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
