import type { BuilderField } from "@admin/components/features/schema-builder/types";

import type { SchemaTemplateKind } from "./schema-templates";

/**
 * Default system fields present in every collection and single.
 * These cannot be deleted or renamed by the user.
 * Used by collection/single create pages (prepopulated) and edit pages (prepended to loaded fields).
 */
export const DEFAULT_SYSTEM_FIELDS: BuilderField[] = [
  {
    id: "system_title",
    name: "title",
    label: "Title",
    type: "text",
    isSystem: true,
    validation: { required: true },
  },
  {
    id: "system_slug",
    name: "slug",
    label: "Slug",
    type: "text",
    isSystem: true,
    validation: { required: true },
  },
];

/**
 * The names the system fields above occupy. Derived rather than restated so a
 * change to that list cannot leave a loader filtering one set and a save
 * filtering another. Which names a field may not take is the save's own
 * field-name rule (`fieldNameProblem` on `nextly/config`), not a list here.
 */
export const SYSTEM_FIELD_NAMES: string[] = DEFAULT_SYSTEM_FIELDS.map(
  f => f.name
);

/**
 * The built-in fields an entity of `kind` holds beside its own: a collection's and a Single's
 * title and slug (`DEFAULT_SYSTEM_FIELDS`). A field group holds none, so a field it names `title`
 * or `slug` is its own, shown, edited and saved as any other. The one table the Builder's loader,
 * its save and the template check all read, so no kind's own field is taken for a built-in one.
 */
function builtInFieldsOf(kind: SchemaTemplateKind): readonly BuilderField[] {
  return kind === "fieldGroup" ? [] : DEFAULT_SYSTEM_FIELDS;
}

/**
 * The built-in fields whose Unique setting the person chooses: a collection's title. Its slug is
 * always unique, through an index every collection table is made with, so its Unique is shown on
 * and is never sent. A Single's built-in fields are not saved by the Builder.
 */
const UNIQUE_CHOSEN_BUILT_INS: readonly string[] = ["title"];

/**
 * Whether `field` is the built-in row every collection table keeps unique through an index of its
 * own (`onCollection` for a collection's Builder): the slug. Its Unique is shown on and cannot be
 * turned off, since the index stays whatever the field says, and it is never sent.
 */
export function isAlwaysUniqueBuiltIn(
  field: BuilderField,
  onCollection: boolean
): boolean {
  return onCollection && field.isSystem === true && field.name === "slug";
}

/**
 * Whether `field` is a built-in row of `kind` whose Unique the person chooses: the one test the
 * save (`builtInFieldsToSave`) and the pending changes both ask, so a toggle is counted as a change
 * exactly where a save sends it.
 */
export function choosesBuiltInUnique(
  kind: SchemaTemplateKind,
  field: BuilderField
): boolean {
  return (
    kind === "collection" &&
    field.isSystem === true &&
    UNIQUE_CHOSEN_BUILT_INS.includes(field.name)
  );
}

/**
 * The built-in rows of `kind` as the entity stored them. One whose Unique the person chooses, where
 * the entity stored a field of its name, is that stored field (`fromStored` converts it), every
 * option of it kept, in the built-in row's place: a save that sends it back
 * (`builtInFieldsToSave`) changes nothing of it but its Unique. Its Unique is shown on where stored
 * on, and left unset otherwise, so a title never made unique is not sent.
 */
export function builtInFieldsAsStored<
  F extends { name?: string; unique?: boolean },
>(
  kind: SchemaTemplateKind,
  stored: readonly F[],
  fromStored: (field: F) => BuilderField
): readonly BuilderField[] {
  return builtInFieldsOf(kind).map(row => {
    const declared = choosesBuiltInUnique(kind, row)
      ? stored.find(field => field.name === row.name)
      : undefined;
    // A title the entity never stored is the shared one kept on the main table: sent, it says so,
    // since a text field declared without `localized` is translated on a translated collection.
    if (declared === undefined) {
      return choosesBuiltInUnique(kind, row)
        ? { ...row, advanced: { ...row.advanced, localized: false } }
        : row;
    }
    const built = fromStored(declared);
    // Unique is set below from what was stored: on, or left unset.
    const advanced = { ...built.advanced };
    delete advanced.unique;
    return {
      ...built,
      id: row.id,
      isSystem: true,
      advanced:
        declared.unique === true ? { ...advanced, unique: true } : advanced,
    };
  });
}

/**
 * The built-in rows a save of `kind` sends: each whose Unique the person chooses and is on now, or
 * was on in `savedBuiltIns` (the rows as loaded or last saved). Sent off as well as on: the server
 * keeps a stored built-in field it is not sent, so turning a stored Unique off has to say so. One
 * neither on nor stored on is left out, as every built-in field was before, so a toggle turned on
 * and back off sends nothing.
 */
export function builtInFieldsToSave(
  kind: SchemaTemplateKind,
  fields: readonly BuilderField[],
  savedBuiltIns: readonly BuilderField[]
): BuilderField[] {
  const savedOn = (field: BuilderField) =>
    savedBuiltIns.some(
      row =>
        row.isSystem === true &&
        row.name === field.name &&
        row.advanced?.unique === true
    );
  return fields.filter(
    field =>
      choosesBuiltInUnique(kind, field) &&
      (field.advanced?.unique === true || savedOn(field))
  );
}

/** The names `builtInFieldsOf(kind)` occupy. */
export function builtInFieldNamesOf(
  kind: SchemaTemplateKind
): readonly string[] {
  return builtInFieldsOf(kind).map(field => field.name);
}
