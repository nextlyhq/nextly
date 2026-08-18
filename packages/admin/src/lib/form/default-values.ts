/**
 * form-default-values — what a form holds before anyone edits it.
 *
 * The entry editor and the single editor both needed this and each carried its
 * own copy: 152 lines and 198 lines that agreed on most field types and
 * disagreed on six. The disagreements were not deliberate, and users could see
 * them — a `chips` field's declared default was honoured in one editor and
 * discarded in the other; a `code` field opened empty in one and null in the
 * other.
 *
 * Each divergence was resolved on its merits rather than by keeping whichever
 * copy was longer. The entry editor's behaviour won every one:
 *
 * - `chips` honours the schema author's `defaultValue` instead of forcing `[]`.
 * - `code` and `json` are named rather than left to the generic fallthrough,
 *   which gave a code input `null` where it wants an empty string.
 * - `relationship` and `upload` decide multiplicity from `hasMany` alone. The
 *   other copy also read a `multiple` key; no field config in this repository
 *   sets one, and both inputs read `hasMany`.
 * - a single-value `select`/`radio` seeds `null` rather than `""`. Both inputs
 *   render `value || ""`, so nothing looks different; `null` is what the other
 *   absent-value cases use and what belongs in the database.
 *
 * The work is split across two functions because a STORED value and a DECLARED
 * default are different questions. One reconciles what the database returned
 * with what the input expects; the other reads what the schema author asked
 * for. Answering both inside one switch made a function with a cyclomatic
 * complexity of 61.
 *
 * @module lib/form/default-values
 */

import type { FieldConfig } from "nextly/config";

/** Convert camelCase to snake_case, for the DB column-name fallback below. */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

/** A checkbox may come back as `true`, `"true"` or `1` depending on the driver. */
function coerceStoredBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

/** Chips may arrive as a JSON string from a database with no JSONB, or from a legacy row. */
function coerceStoredChips(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Component data arrives as an array even for a non-repeatable component (from
 * `FieldGroupDataService.populateComponentData`), while the form's dynamic-zone
 * mode expects a single object carrying `_componentType`.
 */
function unwrapStoredComponent(value: unknown, field: FieldConfig): unknown {
  const isRepeatable = (field as { repeatable?: boolean }).repeatable;
  if (!isRepeatable && Array.isArray(value) && value.length === 1) {
    return value[0];
  }
  return value;
}

/**
 * How each field type reconciles what the database returned with what its input
 * expects. A type with no entry takes the stored value unchanged, which is the
 * common case and the right default for a contributed type nobody has taught
 * this module about.
 */
const FROM_STORED: Record<
  string,
  (value: unknown, field: FieldConfig) => unknown
> = {
  checkbox: coerceStoredBoolean,
  boolean: coerceStoredBoolean,
  chips: coerceStoredChips,
  component: unwrapStoredComponent,
};

/** The value a STORED field takes in the form. */
function fromStoredValue(field: FieldConfig, existingValue: unknown): unknown {
  const coerce = FROM_STORED[field.type as string];
  return coerce ? coerce(existingValue, field) : existingValue;
}

/** A select or radio's seed, which depends on whether it holds one value or many. */
function fromSelectDefault(field: FieldConfig): unknown {
  // The declared default may be a single value or, for hasMany, an array
  // (`defaultValue: ["technology", "design"]`). Treating an array default as a
  // scalar would wrap it again and hand the field [["technology", "design"]],
  // which renders as one nonsense badge and fails array validation.
  const selectField = field as {
    defaultValue?: string | string[];
    hasMany?: boolean;
  };
  const { defaultValue } = selectField;

  if (selectField.hasMany) {
    if (Array.isArray(defaultValue)) return defaultValue;
    return defaultValue ? [defaultValue] : [];
  }
  // A single-value select given an array default takes its first entry rather
  // than stringifying the whole array into the control.
  return Array.isArray(defaultValue)
    ? (defaultValue[0] ?? null)
    : (defaultValue ?? null);
}

/** A component's seed: a list when repeatable, its nested defaults when not. */
function fromComponentDefault(field: FieldConfig): unknown {
  const componentField = field as {
    componentFields?: FieldConfig[];
    repeatable?: boolean;
  };
  if (componentField.repeatable) return [];
  if (componentField.componentFields) {
    return getDefaultValues(componentField.componentFields);
  }
  return null;
}

/**
 * How each field type seeds itself when the document has nothing stored.
 *
 * A table rather than a `switch`, for the reason `derived-checks.md` gives: a
 * switch reaches its `default` arm for a type nobody wrote a case for, which is
 * indistinguishable from a type deliberately left to the fallback. Here the
 * fallback IS deliberate — a plugin-contributed type takes its declared default
 * — so the two have to be told apart by whether a key exists, not by which arm
 * ran.
 *
 * Each entry takes the field and its declared `defaultValue`.
 */
const DECLARED_DEFAULT: Record<
  string,
  (field: FieldConfig, declared: unknown) => unknown
> = {
  text: (_f, d) => d ?? "",
  textarea: (_f, d) => d ?? "",
  email: (_f, d) => d ?? "",
  password: (_f, d) => d ?? "",
  code: (_f, d) => d ?? "",
  checkbox: (_f, d) => d ?? false,
  select: f => fromSelectDefault(f),
  radio: f => fromSelectDefault(f),
  relationship: f => ((f as { hasMany?: boolean }).hasMany ? [] : null),
  upload: f => ((f as { hasMany?: boolean }).hasMany ? [] : null),
  repeater: () => [],
  chips: (_f, d) => d ?? [],
  group: f => getDefaultValues((f as { fields: FieldConfig[] }).fields),
  component: f => fromComponentDefault(f),
};

/**
 * The value a field takes when the document has nothing stored for it — a
 * create form, or a field added to the schema after this document was written.
 *
 * A type with no entry above takes its declared default and falls back to null.
 * That covers `number`, `date`, `richText` and `json`, and every field type a
 * plugin contributes: reading the declared value rather than forcing null is
 * what lets a plugin field open a create form with the value its schema author
 * chose.
 */
function fromDeclaredDefault(field: FieldConfig): unknown {
  const declared = (field as { defaultValue?: unknown }).defaultValue;
  const seed = DECLARED_DEFAULT[field.type as string];
  return seed ? seed(field, declared) : (declared ?? null);
}

/**
 * Build a form's default values from a field schema and, optionally, the
 * document being edited.
 *
 * Recursive: `group` and non-repeatable `component` fields seed themselves from
 * their own nested fields.
 */
export function getDefaultValues(
  fields: FieldConfig[],
  existingData?: Record<string, unknown>
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const field of fields) {
    if (!("name" in field) || !field.name) continue;
    const fieldName = field.name;

    // The entry API may return DB column names (snake_case) while field configs
    // use camelCase. Try camelCase first, then the snake_case column.
    const existingValue =
      existingData?.[fieldName] ?? existingData?.[toSnakeCase(fieldName)];

    // A STORED NULL for a structural field is not a value to keep. The field's
    // own inputs materialise the shape as they register — `seo: null` becomes
    // `{ metaTitle: null, ... }` the moment its sub-fields mount — so taking the
    // null verbatim guarantees the form's values can never equal its defaults,
    // and the document reports itself edited before anyone has typed.
    const isStructural = field.type === "component" || field.type === "group";
    const isRepeatable =
      (field as { repeatable?: boolean }).repeatable === true;
    const nullStructural =
      existingValue === null && isStructural && !isRepeatable;

    defaults[fieldName] =
      existingValue !== undefined && !nullStructural
        ? fromStoredValue(field, existingValue)
        : fromDeclaredDefault(field);
  }

  return defaults;
}
