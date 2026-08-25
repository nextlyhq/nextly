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

const SCALAR_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  checkbox: false,
  number: null,
});

/**
 * Normalizes defaults for select and radio fields based on their hasMany configuration,
 * preventing shape mismatches during schema validation.
 */
function getSelectDefault(field: FieldConfig, declared: unknown): unknown {
  const hasMany = (field as { hasMany?: boolean }).hasMany;
  if (hasMany) {
    if (Array.isArray(declared)) return declared;
    return declared !== undefined && declared !== null ? [declared] : [];
  }
  return Array.isArray(declared) ? (declared[0] ?? null) : (declared ?? null);
}

/**
 * Normalizes defaults for text fields based on their hasMany configuration.
 * When hasMany is true, seeds an empty array `[]` rather than empty string `""` to match array schema.
 */
function getTextDefault(field: FieldConfig, declared: unknown): unknown {
  const hasMany = (field as { hasMany?: boolean }).hasMany;
  if (hasMany) {
    if (Array.isArray(declared)) return declared;
    return declared !== undefined && declared !== null && declared !== ""
      ? [declared]
      : [];
  }
  return declared ?? "";
}

/**
 * Returns the type-specific fallback default for a field that has no explicit defaultValue.
 * Uses Object.hasOwn to prevent Object.prototype key collision and allocates mutable collections per field.
 */
function getTypeDefault(type: string, subField: FieldConfig): unknown {
  if (type === "repeater") return [];
  if (Object.hasOwn(SCALAR_DEFAULTS, type)) {
    return SCALAR_DEFAULTS[type];
  }
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
 * Resolves static or functional defaultValue declarations.
 */
function resolveDeclaredValue(declared: unknown): unknown {
  return typeof declared === "function" ? declared({}) : declared;
}

/**
 * Normalizes explicit default values for types requiring shape coercion.
 */
function resolveDeclaredFieldDefault(
  subField: FieldConfig,
  declared: unknown
): unknown {
  if (subField.type === "select" || subField.type === "radio") {
    return getSelectDefault(subField, declared);
  }
  if (subField.type === "text") {
    return getTextDefault(subField, declared);
  }
  return declared;
}

/**
 * Resolves fallback default values when no explicit defaultValue is declared.
 */
function getFallbackFieldDefault(subField: FieldConfig): unknown {
  if (subField.type === "text") {
    return getTextDefault(subField, undefined);
  }
  if (subField.type === "select" || subField.type === "radio") {
    return getSelectDefault(subField, undefined);
  }
  if (STRING_SEED_TYPES.has(subField.type)) return "";
  if ((subField.type as string) === "chips") return [];
  return getTypeDefault(subField.type, subField);
}

/**
 * Computes the default value for an individual field configuration.
 */
function getFieldDefault(subField: FieldConfig): unknown {
  const declared = resolveDeclaredValue(
    (subField as { defaultValue?: unknown }).defaultValue
  );
  if (declared !== undefined) {
    return resolveDeclaredFieldDefault(subField, declared);
  }
  return getFallbackFieldDefault(subField);
}

/**
 * Computes default values for an array of nested sub-fields based on schema configuration.
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
