import type { BuilderField } from "@admin/components/features/schema-builder";

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
