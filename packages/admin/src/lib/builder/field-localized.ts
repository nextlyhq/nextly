/**
 * Whether a field keeps a value per language, given that what holds it (the
 * entity, or the field group it belongs to) is translated.
 *
 * The one rule the settings panel's Localized switch and the outline's
 * Translatable badge both read: the field's own setting when it has one, else
 * the server's default for its type (text-like fields translate by default).
 * A field-group field holds no value of its own, so it is never translated
 * itself; the fields inside its field group are.
 *
 * @module lib/builder/field-localized
 */
import { defaultLocalizedForType } from "nextly/config";
import { isFieldGroupFieldType } from "nextly/field-group-type";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

export function fieldLocalized(
  field: Pick<BuilderField, "type" | "advanced">
): boolean {
  if (isFieldGroupFieldType(field.type)) return false;
  return field.advanced?.localized ?? defaultLocalizedForType(field.type);
}
