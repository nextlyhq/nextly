import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { toSnakeCase } from "../../schema/services/field-column-descriptor";

/**
 * The name each incoming field is saved under, given the fields already
 * stored for the same collection.
 *
 * A field keeps the name it was sent with, and its column is
 * `toSnakeCase(name)`, as on every other road. One exception keeps stored data
 * where it is: an incoming field that names the same column as a stored field,
 * or differs from one only in case, is saved under the stored name. Fields saved before names kept their case
 * were stored lowercased (`metatitle`, column `metatitle`); a caller sending
 * the field back as `metaTitle` would otherwise ask for a new `meta_title`
 * column and have the old one, and its values, dropped.
 */
export function namesKeptFromStored(
  incoming: FieldDefinition[],
  stored: readonly FieldDefinition[]
): FieldDefinition[] {
  // One stored field per question, asked in order: the same name, then the
  // same column, then a name differing only in case. The exact match first
  // keeps two stored fields that fold together (`metaTitle`, `metatitle`) each
  // its own; the column next keeps `metaTitle` sent for a stored `meta_title`
  // from asking for a column that already exists.
  const storedNames = new Set(stored.map(field => field.name));
  const storedByColumn = new Map(
    stored.map(field => [toSnakeCase(field.name), field.name])
  );
  const storedByFoldedName = new Map(
    stored.map(field => [field.name.toLowerCase(), field.name])
  );
  return incoming.map(field => {
    if (storedNames.has(field.name)) return field;
    const storedName =
      storedByColumn.get(toSnakeCase(field.name)) ??
      storedByFoldedName.get(field.name.toLowerCase());
    return storedName !== undefined ? { ...field, name: storedName } : field;
  });
}
