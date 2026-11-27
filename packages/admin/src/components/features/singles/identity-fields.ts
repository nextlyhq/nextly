import type { FieldConfig } from "nextly/config";

import { fieldAdminGates } from "../entries/fields/field-admin-gates";

/**
 * A Single's "identity" fields. Nextly gives every Single a `title` and a
 * `slug` (`defineSingle` adds them, and the system schema does for a visual
 * Single), fixed by the Single's config: they are rendered read-only in the
 * admin, saved as the Single's label and slug, and must not be
 * required-validated.
 */
const IDENTITY_FIELD_NAMES = ["title", "slug"] as const;

/** One of a Single's identity field names. */
export type SingleIdentityName = (typeof IDENTITY_FIELD_NAMES)[number];

/**
 * The identity fields the Single's config fixes: each of `title` and `slug`
 * except those the server reports as the author's own (`ownIdentityFields`).
 * A Single that declares its own field of either name has none of Nextly's in
 * its place, so that field is content, edited and saved like any other; pinning
 * it to the config would overwrite what the author stored on every save.
 *
 * An answer that names neither (an older server) fixes both, as the editor
 * always did.
 */
export function fixedIdentityNames(schema: {
  ownIdentityFields?: readonly string[] | undefined;
}): ReadonlySet<SingleIdentityName> {
  const own = new Set(schema.ownIdentityFields ?? []);
  return new Set(IDENTITY_FIELD_NAMES.filter(name => !own.has(name)));
}

/**
 * Return a copy of `fields` with the identity fields the Single's config fixes
 * (`fixed`, from `fixedIdentityNames`) marked not-required, at both the flat
 * (`field.required`) and nested (`field.validation.required`) shapes that
 * `generateClientSchema` reads.
 *
 * Singles render those read-only from config, so the client validation schema
 * must accept a submission that doesn't carry them. All other fields, an
 * author's own `title` or `slug` among them, pass through unchanged and keep
 * their own required rule.
 */
export function relaxIdentityRequired(
  fields: FieldConfig[],
  fixed: ReadonlySet<string>
): FieldConfig[] {
  return fields.map(field => {
    if (!("name" in field) || !fixed.has(field.name as string)) {
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

/**
 * Whether an author's own `title` is drawn in the document's heading, the
 * single-line text input at its head: a plain text field that is always shown.
 * Any other (a number, a field hidden or shown by a condition) is drawn
 * through its own field control instead, which knows its type and its gates;
 * the heading would send a number as a string and show a hidden value.
 */
export function ownTitleInHeading(field: FieldConfig): boolean {
  const gates = fieldAdminGates(field);
  return (
    field.type === "text" && !gates.hidden && gates.condition === undefined
  );
}
