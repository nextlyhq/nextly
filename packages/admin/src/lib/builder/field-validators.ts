import type { BuilderField } from "@admin/components/features/schema-builder";

export interface FieldBuilderValidationResult {
  valid: boolean;
  errorMessage?: string;
}

/**
 * Run the schema-save preflight checks against the user-defined fields:
 * unnamed-field guard, component-reference guard, and select-options guard.
 *
 * legitimate state. The auto-create flow creates schemas with empty user
 * fields (system columns id/title/slug/timestamps/status are auto-injected),
 * so blocking save on `userFields.length === 0` paternalistically prevents
 * users from removing all custom fields and saving the result. This used to
 * fail the second save in the reported reproduction (07-admin-bugs-feedback
 * item 3): create → add field → save → remove field → save → "Please add at
 * least one field". The validation never had a real invariant to enforce.
 */
export function validateBuilderFields(
  userFields: BuilderField[]
): FieldBuilderValidationResult {
  const unnamedField = userFields.find(f => !f.name);
  if (unnamedField) {
    return { valid: false, errorMessage: "All fields must have a name" };
  }

  const missingRef = findComponentFieldMissingReference(userFields);
  if (missingRef) {
    return {
      valid: false,
      errorMessage: `Component field "${missingRef}" must have a component selected`,
    };
  }

  const missingOptions = findSelectFieldMissingOptions(userFields);
  if (missingOptions) {
    return {
      valid: false,
      errorMessage: `Select/Radio field "${missingOptions}" must have at least one option`,
    };
  }

  return { valid: true };
}

/**
 * Recursively validate that all component-type fields have a component reference.
 * Returns the name of the first field missing a reference, or null if all valid.
 */
export function findComponentFieldMissingReference(
  fields: BuilderField[]
): string | null {
  for (const field of fields) {
    if (field.type === "component") {
      const hasSingle = Boolean(field.component);
      const hasMulti =
        Array.isArray(field.components) && field.components.length > 0;
      if (!hasSingle && !hasMulti) {
        return field.name || field.label || "unnamed";
      }
    }
    if (Array.isArray(field.fields)) {
      const nested = findComponentFieldMissingReference(field.fields);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Recursively validate that all select/radio fields have at least one option.
 * Returns the name of the first field missing options, or null if all valid.
 */
export function findSelectFieldMissingOptions(
  fields: BuilderField[]
): string | null {
  for (const field of fields) {
    if (field.type === "select" || field.type === "radio") {
      const hasOptions =
        Array.isArray(field.options) && field.options.length > 0;
      if (!hasOptions) {
        return field.name || field.label || "unnamed";
      }
    }
    if (Array.isArray(field.fields)) {
      const nested = findSelectFieldMissingOptions(field.fields);
      if (nested) return nested;
    }
  }
  return null;
}
