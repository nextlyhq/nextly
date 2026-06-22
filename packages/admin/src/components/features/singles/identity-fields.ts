import type { FieldConfig } from "nextly/config";

/**
 * A Single's "identity" fields. These are auto-injected by `defineSingle`
 * (or, for visual singles, by the system schema) and are fixed by the
 * single's config — they are rendered read-only in the admin and must not be
 * required-validated.
 */
const IDENTITY_FIELD_NAMES = new Set(["title", "slug"]);

/**
 * Return a copy of `fields` with the Single identity fields (`title`, `slug`)
 * marked not-required, at both the flat (`field.required`) and nested
 * (`field.validation.required`) shapes that `generateClientSchema` reads.
 *
 * Singles render title/slug read-only from config, so the client validation
 * schema must accept a submission that doesn't carry them. All other fields
 * pass through unchanged.
 */
export function relaxIdentityRequired(fields: FieldConfig[]): FieldConfig[] {
  return fields.map(field => {
    if (!("name" in field) || !IDENTITY_FIELD_NAMES.has(field.name as string)) {
      return field;
    }
    const validation = (field as { validation?: Record<string, unknown> })
      .validation;
    return {
      ...field,
      required: false,
      ...(validation ? { validation: { ...validation, required: false } } : {}),
    } as FieldConfig;
  });
}
