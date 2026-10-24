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

/** What {@link reachesLocalizedFieldGroup} reads of a field group by slug. */
export interface FieldGroupReader {
  /** Whether the group's own definition is localized. */
  isComponentLocalized: (slug: string) => Promise<boolean>;
  /** The group's own fields, or `null` for a group that is not defined. */
  getComponentFields: (slug: string) => Promise<readonly FieldShape[] | null>;
}

/**
 * Whether `fieldConfigs` reach a field group whose definition is localized:
 * one they reference, or one inside a group they reference, at any depth. A
 * localized group stores its values per language, in its own table, whatever
 * languages the collection, Single or group around it stores. Each group is
 * read once, so a group that holds itself ends the walk.
 */
export async function reachesLocalizedFieldGroup(
  fieldConfigs: readonly FieldShape[],
  groups: FieldGroupReader
): Promise<boolean> {
  const read = new Set<string>();
  const reaches = async (fields: readonly FieldShape[]): Promise<boolean> => {
    for (const field of fields) {
      if (!isFieldGroupField(field)) continue;
      for (const slug of fieldGroupSlugList(field)) {
        if (read.has(slug)) continue;
        read.add(slug);
        if (await groups.isComponentLocalized(slug)) return true;
        const inner = await groups.getComponentFields(slug);
        if (inner !== null && (await reaches(inner))) return true;
      }
    }
    return false;
  };
  return reaches(fieldConfigs);
}
