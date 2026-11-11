/**
 * Which fields of a collection or Single hold values per language.
 *
 * @module domains/i18n/per-language-fields
 */
import { isFieldGroupField } from "../../collections/fields/guards";
import { directComponentFields } from "../field-groups/direct-component-fields";
import { fieldGroupSlugList } from "../field-groups/storage/field-group-field-type";

/**
 * What these read of a field: its type, its name, and, for a field group, the
 * group it references. A stored definition and a code-defined config both
 * carry them.
 */
type FieldShape = { readonly type: string; readonly name?: string };

/**
 * The fields judged per language when every language is published: the
 * translated fields, and each field whose component is translated, or holds,
 * placed directly in it at any depth, a component that is: such a component's
 * values are rows of its own, stored per language. A dynamic zone counts when
 * any type it permits does. References are read through `fieldGroupSlugList`,
 * so a definition stored under the migrated `fieldGroup` / `fieldGroups` keys
 * counts as the field-group saver sees it. Without `fieldsOf`, only the
 * components a field names are asked.
 */
export async function perLanguageFieldNames(
  fieldConfigs: readonly FieldShape[],
  localizedFieldNames: ReadonlySet<string>,
  isComponentLocalized: (slug: string) => Promise<boolean>,
  fieldsOf?: (slug: string) => Promise<readonly FieldShape[] | null>
): Promise<Set<string>> {
  const names = new Set(localizedFieldNames);
  // Through groups with no name, which only lay fields out: the field groups in one are stored
  // where it sits, as those beside it are.
  for (const field of directComponentFields(fieldConfigs)) {
    if (field.name === undefined) continue;
    if (
      await holdsPerLanguageComponent(
        fieldGroupSlugList(field),
        isComponentLocalized,
        fieldsOf
      )
    ) {
      names.add(field.name);
    }
  }
  return names;
}

/**
 * Whether any of `slugs`, or a component placed directly in one of them at any depth, stores its
 * values per language. Each component is asked once, so one that holds itself ends the walk.
 */
async function holdsPerLanguageComponent(
  slugs: readonly string[],
  isComponentLocalized: (slug: string) => Promise<boolean>,
  fieldsOf:
    | ((slug: string) => Promise<readonly FieldShape[] | null>)
    | undefined
): Promise<boolean> {
  const reached = [...slugs];
  const asked = new Set<string>();
  for (const slug of reached) {
    if (asked.has(slug)) continue;
    asked.add(slug);
    if (await isComponentLocalized(slug)) return true;
    // Those placed directly in it, a group with no name included, are rows of their own.
    const placed = directComponentFields(
      (fieldsOf ? await fieldsOf(slug) : null) ?? []
    );
    for (const field of placed) reached.push(...fieldGroupSlugList(field));
  }
  return false;
}

/** A field group's definition, as {@link reachesLocalizedFieldGroupIn} reads it. */
export interface FieldGroupDefinition {
  readonly localized?: boolean;
  readonly fields?: readonly FieldShape[] | null;
}

/**
 * Whether `fieldConfigs` reach a field group whose definition is localized:
 * one they reference, or one inside a group they reference, at any depth. A
 * localized group stores its values per language, in its own table, whatever
 * languages the collection, Single or group around it stores.
 *
 * Each group's definition comes from `groupOf`: `null` for a group that is
 * not defined, and `undefined` for one not read yet, which is answered as
 * `{ unread: slug }` so a caller reading definitions as it goes reads that
 * one and asks again. Each group is looked at once, so a group that holds
 * itself ends the walk. The one walk for this question, on the registered
 * configuration and on the stored definitions alike.
 */
export function reachesLocalizedFieldGroupIn(
  fieldConfigs: readonly FieldShape[],
  groupOf: (slug: string) => FieldGroupDefinition | null | undefined
): boolean | { unread: string } {
  const groupsIn = (fields: readonly FieldShape[]): string[] =>
    fields.flatMap(field =>
      isFieldGroupField(field) ? fieldGroupSlugList(field) : []
    );
  // Every group reached so far, in the order it was reached; the ones a group
  // holds join the end as it is looked at.
  const reached = groupsIn(fieldConfigs);
  const looked = new Set<string>();
  for (const slug of reached) {
    if (looked.has(slug)) continue;
    const group = groupOf(slug);
    if (group === undefined) return { unread: slug };
    looked.add(slug);
    if (group?.localized === true) return true;
    reached.push(...groupsIn(group?.fields ?? []));
  }
  return false;
}

/**
 * {@link reachesLocalizedFieldGroupIn}, reading each group it reaches through
 * `readGroup` once, as the walk first needs it.
 */
export async function reachesLocalizedFieldGroup(
  fieldConfigs: readonly FieldShape[],
  readGroup: (slug: string) => Promise<FieldGroupDefinition | null>
): Promise<boolean> {
  const read = new Map<string, FieldGroupDefinition | null>();
  for (;;) {
    const answer = reachesLocalizedFieldGroupIn(fieldConfigs, slug =>
      read.get(slug)
    );
    if (typeof answer === "boolean") return answer;
    read.set(answer.unread, await readGroup(answer.unread));
  }
}
