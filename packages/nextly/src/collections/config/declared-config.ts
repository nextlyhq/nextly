/**
 * What `defineCollection` and `defineSingle` both make of the config an
 * author writes: a label read from a slug, and the authored fields as the
 * rest of the system reads them. One module, so the two definitions cannot
 * drift apart.
 *
 * @module collections/config/declared-config
 */
import {
  columnsDeclaredBy,
  fieldsStoredOnRow,
} from "../../domains/schema/services/field-column-descriptor";
import type { AuthorableFieldConfig, FieldConfig } from "../fields/types";

/**
 * Converts a slug to title case for display.
 *
 * @param str - The string to convert
 * @returns Title-cased string
 *
 * @example
 * ```typescript
 * toTitleCase('blog-posts') // 'Blog Posts'
 * toTitleCase('header_nav') // 'Header Nav'
 * toTitleCase('users') // 'Users'
 * ```
 */
export function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * The authored fields as the rest of the system reads them.
 *
 * A contributed declaration is structurally a field — a name, a type, and the
 * options its own type reads — and every internal consumer dispatches on
 * `type` as a string. The authoring widening exists so a plugin type can be
 * written down; it is dropped at this boundary, after validation, rather than
 * carried into the union every reader shares, where an index-signature member
 * would widen property access for all of them.
 */
export function asDeclaredFields(
  fields: readonly AuthorableFieldConfig[]
): FieldConfig[] {
  return fields as FieldConfig[];
}

/**
 * The system fields (`title`, `slug`) a collection or a Single has beside its author's fields:
 * each one whose column those fields do not already own. Every such table carries both columns,
 * and an author's own definition of one takes priority.
 *
 * Keyed by the COLUMN each field becomes, not by its declared name. A field named `Title` owns
 * the `title` column, so adding the system one beside it declares that column twice and the
 * table cannot be created; this asks the same question the generators do.
 *
 * Both are SHARED (`localized: false`): localizing the title or slug is a deliberate opt-in
 * through a field the author declares, not a side effect of text fields localizing by default,
 * which would move the identity columns into the companion `_locales` table.
 *
 * The `define*` function records the ones it added on the entity (`markDeclaredByDefine`), so
 * the configuration's check can tell an entity that declares no field of its own from one whose
 * plugin added a field of that name.
 */
export function systemFieldsBeside(
  fields: readonly AuthorableFieldConfig[]
): Array<FieldConfig & { name: string }> {
  const owned = columnsDeclaredBy(fields);
  const systemFields: Array<FieldConfig & { name: string }> = [];
  if (!owned.has("title")) {
    systemFields.push(
      markedAsSystem({
        type: "text",
        name: "title",
        label: "Title",
        required: true,
        localized: false,
      })
    );
  }
  if (!owned.has("slug")) {
    systemFields.push(
      markedAsSystem({
        type: "text",
        name: "slug",
        label: "Slug",
        required: true,
        unique: true,
        localized: false,
      })
    );
  }
  return systemFields;
}

/**
 * The mark `systemFieldsBeside` leaves on each field it makes. A registered symbol, so a second
 * copy of this module (the configuration's bundle beside the runtime's) reads the same one;
 * enumerable, so the copies the boot makes of the configuration for plugins (`copyPlainValues`)
 * and an object spread keep it. Symbol keys are outside `Object.keys`, JSON and the schema hash,
 * so no stored definition, comparison of settings or migration sees it.
 */
const SYSTEM_FIELD = Symbol.for("nextly.config.systemField");

/** `field`, marked as one `systemFieldsBeside` added rather than one an author declared. */
function markedAsSystem<T extends object>(field: T): T {
  Object.defineProperty(field, SYSTEM_FIELD, {
    value: true,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return field;
}

/** Whether `field` is one `systemFieldsBeside` added (`markedAsSystem`). */
function isMarkedSystemField(field: unknown): boolean {
  return (
    typeof field === "object" &&
    field !== null &&
    (field as Record<symbol, unknown>)[SYSTEM_FIELD] === true
  );
}

/**
 * The identity fields (`title`, `slug`) a Single's author declared as fields of their own, read
 * from its live definition (`fields`): each top-level field of either name that
 * `systemFieldsBeside` did not add. Such a field is content: Nextly added none of its own in its
 * place, so nothing may fill it with the Single's label or slug, and the admin edits and saves it
 * as any other field. The others are Nextly's, fixed by the Single's config.
 *
 * Asked of the live definition because only it carries the mark: a stored definition is the same
 * JSON either way. A Schema Builder Single has no live definition, and its identity is always
 * Nextly's, so undefined `fields` names none. Should something rebuild a system field without the
 * mark (a copy of its string keys alone), it is read as the author's: its value is then kept as
 * stored rather than replaced, the direction that loses nothing.
 */
export function ownIdentityFieldNames(
  fields: readonly unknown[] | undefined
): Array<"title" | "slug"> {
  if (fields === undefined) return [];
  // At the row's level: a field inside a group with no name is a column of the row, as the
  // system field would have been.
  const onRow = fieldsStoredOnRow(fields);
  const own: Array<"title" | "slug"> = [];
  for (const name of ["title", "slug"] as const) {
    // A field the author declared that holds the column itself, asked as
    // `systemFieldsBeside` asks it (`columnsDeclaredBy`): one of the name that
    // takes no column (a component named `title`) leaves the system field
    // beside it, and that field, the label and all, stays Nextly's.
    const declared = onRow.some(
      field =>
        (field as { name?: unknown } | null)?.name === name &&
        !isMarkedSystemField(field) &&
        columnsDeclaredBy([field as { name?: unknown }]).has(name)
    );
    if (declared) own.push(name);
  }
  return own;
}
