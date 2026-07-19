/**
 * Field-localization classification: given a collection's master localization switch,
 * decide which fields are translatable, using smart per-type defaults with explicit
 * per-field overrides. Consumed by M3 (storage generation) and the admin.
 *
 * @module domains/i18n/classify-fields
 */

/** Minimal field shape this module needs (avoids importing the full FieldConfig union). */
interface ClassifiableField {
  type: string;
  name: string;
  localized?: boolean;
}

/** Text-like field types that default to localized when a collection opts in. */
const TEXT_LIKE = new Set(["text", "textarea", "richText", "email", "code"]);

/** Field types that can never be localized (security / meaninglessness). */
const NEVER_LOCALIZABLE = new Set(["password"]);

/** Smart default: text-like types localize by default; everything else is shared. */
export function defaultLocalizedForType(type: string): boolean {
  return TEXT_LIKE.has(type);
}

/**
 * Whether a field is localized, given its collection's master switch.
 *
 * Precedence: collection off → false; never-localizable type → false;
 * explicit `localized` flag → honored; else the per-type smart default.
 */
export function isFieldLocalized(
  field: ClassifiableField,
  collectionLocalized: boolean
): boolean {
  if (!collectionLocalized) return false;
  if (NEVER_LOCALIZABLE.has(field.type)) return false;
  if (typeof field.localized === "boolean") return field.localized;
  return defaultLocalizedForType(field.type);
}

/** The names of a collection's localized fields (order-preserving). */
export function resolveLocalizedFieldNames(
  fields: ClassifiableField[],
  collectionLocalized: boolean
): string[] {
  return fields
    .filter(f => isFieldLocalized(f, collectionLocalized))
    .map(f => f.name);
}
