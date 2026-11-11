import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "nextly/field-group-type";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

export interface FieldBuilderValidationResult {
  valid: boolean;
  errorMessage?: string;
}

/** What is wrong with a field, in the order a save reports them. */
type FieldErrorKind = "unnamed" | "no-field-group" | "no-options";

/** One field's error: what kind it is, and what to tell the person. */
export interface BuilderFieldError {
  kind: FieldErrorKind;
  message: string;
}

/** The order a save names the kinds in: the first kind found is reported. */
const REPORT_ORDER: readonly FieldErrorKind[] = [
  "unnamed",
  "no-field-group",
  "no-options",
];

/** The one error a field has, or null; a field reports its first. */
function errorOf(field: BuilderField): BuilderFieldError | null {
  if (!field.name) {
    return { kind: "unnamed", message: "All fields must have a name" };
  }
  // Either spelling of the stored field type: a migrated definition whose
  // references were cleared must fail HERE, with the actionable message,
  // rather than at the API boundary after submission.
  if (isFieldGroupFieldType(field.type)) {
    const refs = extractFieldGroupReferences(field);
    const hasSingle = refs.single !== undefined;
    const hasMulti = (refs.many?.length ?? 0) > 0;
    if (!hasSingle && !hasMulti) {
      return {
        kind: "no-field-group",
        message: `Field "${field.name}" must have a field group selected`,
      };
    }
  }
  if (field.type === "select" || field.type === "radio") {
    const hasOptions = Array.isArray(field.options) && field.options.length > 0;
    if (!hasOptions) {
      return {
        kind: "no-options",
        message: `Select/Radio field "${field.name}" must have at least one option`,
      };
    }
  }
  return null;
}

/**
 * Every field's error, by field id, at every depth.
 *
 * The one place the Builder decides what is wrong with a field: the outline
 * marks each row from this map, and the save's refusal is read from it too, so
 * a row can never look fine while the save refuses it, or the reverse.
 */
export function builderFieldErrors(
  fields: readonly BuilderField[]
): Map<string, BuilderFieldError> {
  const errors = new Map<string, BuilderFieldError>();
  const walk = (list: readonly BuilderField[]): void => {
    for (const field of list) {
      const error = errorOf(field);
      if (error) errors.set(field.id, error);
      if (Array.isArray(field.fields)) walk(field.fields);
    }
  };
  walk(fields);
  return errors;
}

/**
 * Run the schema-save preflight checks against the user-defined fields: every
 * field named, every field-group field pointing at a field group, every select
 * or radio given an option. The refusal names the first kind of error found,
 * in that order, and the first field of that kind.
 *
 * An empty field list is a legitimate state. The auto-create flow creates
 * schemas with empty user fields (system columns id/title/slug/timestamps/
 * status are auto-injected), so blocking save on `userFields.length === 0`
 * would prevent users from removing all custom fields and saving the result.
 */
export function validateBuilderFields(
  userFields: BuilderField[]
): FieldBuilderValidationResult {
  const errors = [...builderFieldErrors(userFields).values()];
  for (const kind of REPORT_ORDER) {
    const first = errors.find(error => error.kind === kind);
    if (first) return { valid: false, errorMessage: first.message };
  }
  return { valid: true };
}
