/**
 * The fields new to a Single's table, and the value its one row takes for each.
 *
 * A Single holds one row. A field a save adds to its table takes, in that row, the default the
 * field states, as the application would write it (`singleRowFillValue`): the PATCH road fills it
 * in its alter, and the Schema Builder dialog's save hands the same values to the file it writes.
 * One walk decides which fields are new, for both roads and for the judgement of whether a save's
 * push carries values (`pushCarriesValues`), so they cannot disagree about a field.
 *
 * @module domains/schema/builder-save/single-row-fills
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  fieldsStoredOnRow,
  toSnakeCase,
} from "../services/field-column-descriptor";

/**
 * The named fields a row stores: the top-level ones and those a group with no name lays out
 * (`fieldsStoredOnRow`), which holds no value and has no column of its own.
 */
export function namedOnRow(
  fields: readonly FieldDefinition[]
): (FieldDefinition & { name: string })[] {
  return fieldsStoredOnRow(fields).filter(
    (field): field is FieldDefinition & { name: string } =>
      typeof field.name === "string" && field.name !== ""
  );
}

/**
 * The fields a save adds to a Single's table: stored on its row after the save, and neither there
 * before it nor renamed onto (a rename keeps the value the column holds).
 */
export function fieldsNewToSingleTable(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  /** The columns the save renames onto. */
  renamedTo: readonly string[];
}): (FieldDefinition & { name: string })[] {
  const kept = new Set([
    ...namedOnRow(args.oldFields).map(field => toSnakeCase(field.name)),
    ...args.renamedTo,
  ]);
  return namedOnRow(args.newFields).filter(
    field => !kept.has(toSnakeCase(field.name))
  );
}

/**
 * The value a Single's row takes for each field the save adds to its table, by field name: the
 * default the field states, where `fillValue` (`singleRowFillValue`) takes one. A field it takes
 * none for is left out, and its row keeps no value, as before.
 */
export function singleRowFills(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  renamedTo: readonly string[];
  fillValue: (field: FieldDefinition) => unknown;
}): { field: string; value: unknown }[] {
  return fieldsNewToSingleTable(args).flatMap(field => {
    const value = args.fillValue(field);
    return value === undefined ? [] : [{ field: field.name, value }];
  });
}
