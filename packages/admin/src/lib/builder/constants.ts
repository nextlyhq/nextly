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
function builtInFieldsOf(
  kind: SchemaTemplateKind
): readonly BuilderField[] {
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

/** Whether `field` is a built-in row of `kind` whose Unique the person chooses. */
function choosesUnique(kind: SchemaTemplateKind, field: BuilderField): boolean {
  return (
    kind === "collection" &&
    field.isSystem === true &&
    UNIQUE_CHOSEN_BUILT_INS.includes(field.name)
  );
}

/**
 * The built-in rows of `kind` as the entity stored them: one whose Unique the person chooses shows
 * it on where the entity stored that field unique. A save sends such a row back
 * (`builtInFieldsToSave`), so the setting survives a reload, and turning it off sends that.
 */
export function builtInFieldsAsStored(
  kind: SchemaTemplateKind,
  stored: readonly { name?: string; unique?: boolean }[]
): readonly BuilderField[] {
  return builtInFieldsOf(kind).map(row => {
    const storedUnique =
      choosesUnique(kind, row) &&
      stored.some(field => field.name === row.name && field.unique === true);
    return storedUnique
      ? { ...row, advanced: { ...row.advanced, unique: true } }
      : row;
  });
}

/**
 * The built-in rows a save of `kind` sends: each whose Unique the person chooses and has set,
 * on or off (by a toggle, or as stored). Sent off as well as on: the server keeps a stored
 * built-in field it is not sent, so turning Unique off has to say so. One never set is left out,
 * as every built-in field was before.
 */
export function builtInFieldsToSave(
  kind: SchemaTemplateKind,
  fields: readonly BuilderField[]
): BuilderField[] {
  return fields.filter(
    field => choosesUnique(kind, field) && field.advanced?.unique !== undefined
  );
}

/** The names `builtInFieldsOf(kind)` occupy. */
export function builtInFieldNamesOf(
  kind: SchemaTemplateKind
): readonly string[] {
  return builtInFieldsOf(kind).map(field => field.name);
}
