/**
 * Which fields of a collection or Single hold values per language.
 *
 * @module domains/i18n/per-language-fields
 */
import { isFieldGroupField } from "../../collections/fields/guards";
import { fieldGroupSlugList } from "../field-groups/storage/field-group-field-type";

/**
 * What these read of a field: its type, its name, and, for a field group, the
 * group it references. A stored definition and a code-defined config both
 * carry them.
 */
type FieldShape = { readonly type: string; readonly name?: string };

/**
 * The fields judged per language when every language is published: the
 * translated fields, and each field whose component is translated. A dynamic
 * zone counts when any type it permits is translated. References are read
 * through `fieldGroupSlugList`, so a definition stored under the migrated
 * `fieldGroup` / `fieldGroups` keys counts as the field-group saver sees it.
 */
export async function perLanguageFieldNames(
  fieldConfigs: readonly FieldShape[],
  localizedFieldNames: ReadonlySet<string>,
  isComponentLocalized: (slug: string) => Promise<boolean>
): Promise<Set<string>> {
  const names = new Set(localizedFieldNames);
  for (const field of fieldConfigs) {
    if (!isFieldGroupField(field)) continue;
    for (const slug of fieldGroupSlugList(field)) {
      if (await isComponentLocalized(slug)) {
        names.add(field.name);
        break;
      }
    }
  }
  return names;
}

/**
 * Whether any of `fieldConfigs` is a field group whose definition is
 * localized: its values are stored per language, in the group's own table,
 * whatever languages the collection or Single itself stores. Derived from
 * {@link perLanguageFieldNames}, the one answer to which fields hold values
 * per language.
 */
export async function reachesLocalizedFieldGroup(
  fieldConfigs: readonly FieldShape[],
  isComponentLocalized: (slug: string) => Promise<boolean>
): Promise<boolean> {
  const perLanguage = await perLanguageFieldNames(
    fieldConfigs,
    new Set(),
    isComponentLocalized
  );
  return perLanguage.size > 0;
}
