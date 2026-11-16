/**
 * A field's stored name: the key its answers are kept under, so it reads like
 * a key a developer would have chosen and is unique within the form.
 *
 * Its own module so the provider and the field identity it holds can both use
 * it without importing each other.
 *
 * @module admin/context/field-names
 */
import type { FormFieldTypeId } from "../../types";

/**
 * Generate a readable unique field name: the type itself for the first
 * field of that type, then a numeric suffix (`email`, `email_2`, ...).
 * Names key submission data, so they should read like keys a developer
 * would have chosen, not timestamps.
 */
export function generateFieldName(
  type: FormFieldTypeId,
  existingNames: readonly string[] = []
): string {
  // A plugin type id can be hyphenated (`star-rating`) or start with a digit,
  // but a field name must match ^[a-zA-Z][a-zA-Z0-9_]*$ (it keys submission
  // data). Normalize to a safe key; built-in type ids are already valid and
  // pass through unchanged.
  const base =
    type
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+/, "")
      .replace(/^([0-9])/, "field_$1")
      .replace(/_+$/, "") || "field";
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
