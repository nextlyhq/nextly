/**
 * Whether a Single's or field group's Schema Builder save is one only its dialog's push applies,
 * rather than the migration file the save writes.
 *
 * @module domains/schema/builder-save/push-carries-values
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { fieldsWithLeavingSettingsDeferred } from "../../i18n/migration/archive-preflight";
import type { FieldRename } from "../../i18n/migration/reconcile-companion";
import type { TableSpec } from "../pipeline/diff/types";
import { reachesRelationStorage } from "../pipeline/recorded-shapes";
import {
  toSnakeCase,
  type ColumnDescriptor,
} from "../services/field-column-descriptor";

import { fieldsNewToSingleTable, namedOnRow } from "./single-row-fills";

/**
 * Whether the save carries values across its change, which the dialog's push does and the file,
 * written from the newest snapshot, does not yet: translation turned off in a save that changes the
 * entity's table in other ways too, which `migrate:create` refuses to write as files; a Required or
 * Unique field leaving translation while the entity stays translated,
 * whose setting the push applies once the default language's values are in its shared column
 * (`fieldsWithLeavingSettingsDeferred`); a field whose column changes type or size, whose stored
 * values the push judges before it alters the column; a field new to a Single's table that its row
 * is filled in; and a change reaching a relation's storage (`reachesRelationStorage`), which the
 * push plans from the live table.
 *
 * Any other save, translation turned on or off and a field joining or leaving it included, is
 * applied by its file, in tries over a busy table and on SQLite as a migration file runs, with the
 * companion brought in step after it.
 */
export async function pushCarriesValues(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  /** Whether the values are stored per language before and after the save. */
  wasStored: boolean;
  isStored: boolean;
  /** Whether the save turns Draft/Published on or off, which adds or drops a column of the table. */
  statusChanges?: boolean;
  /** The companion rename the save makes, if any, under which a field leaving translation is named. */
  renamed: FieldRename | null | undefined;
  /** The entity's main table as the database holds it. */
  liveTable: () => Promise<TableSpec | undefined>;
  /** A field's column on this dialect, from the one field-to-column descriptor, or none. */
  columnOf: (field: FieldDefinition) => ColumnDescriptor | null;
  /** The main table's renames the save makes, by column. */
  renames: ReadonlyArray<{ from: string; to: string }>;
  /**
   * A Single's one row, which a field new to its table is filled in where the field is required
   * or states a default the row takes (`singleRowFillValue`). A field group has none.
   */
  singleRow?: {
    /** The columns the save renames onto, which keep their values rather than being filled. */
    renamedTo: readonly string[];
    /** Whether the row is filled in for `field`, new to the table. */
    fills: (field: FieldDefinition) => boolean;
    /** Whether the table holds its row. */
    holdsRow: () => Promise<boolean>;
  };
}): Promise<boolean> {
  // Translation turned off: its file puts each column back as the main table's snapshot records
  // it, Required and Unique settings included, and the main file that follows is recorded as
  // applied over that table. A save that changes the table in other ways too would leave the main
  // file at neither end, so `migrate:create` refuses it, and the push applies it.
  if (args.wasStored && !args.isStored) {
    return (
      args.statusChanges === true ||
      !sameFieldsBesideTranslation(args.oldFields, args.newFields)
    );
  }
  // A Required or Unique field leaving translation: the push adds its shared column without the
  // setting, copies the default language's values in, then sets it. The file adds the column with
  // the setting before any value is there, refused for every table that has rows.
  if (
    fieldsWithLeavingSettingsDeferred({
      oldFields: args.oldFields,
      newFields: args.newFields,
      wasLocalized: args.wasStored,
      isLocalized: args.isStored,
      renamed: args.renamed,
    }) !== undefined
  ) {
    return true;
  }
  // A field whose column changes type or size: the push judges every stored value against the new
  // column before it alters it, refusing one it would cut short; the file's statements have no
  // such judgement yet, and a server refuses them with its own error, or cuts the value.
  if (columnTypeChanges(args)) return true;
  // A Single's row filled in for a field new to its table: the push writes the value with the
  // column, where the file adds the column alone, refused when required and empty otherwise.
  if (
    args.singleRow !== undefined &&
    (await fillsSingleRow(args, args.singleRow))
  ) {
    return true;
  }
  return reachesRelationStorage({
    before: args.oldFields,
    after: args.newFields,
    liveTable: args.liveTable,
  });
}

/**
 * Whether the save's fields are its old ones but for whether each is translated: every name, type
 * and setting the same, in the same order, with `localized` left out at every depth. Anything
 * else, a field added, removed, renamed or reordered, a setting changed, or the same field written
 * with its keys in another order, reads as a change, which keeps the push.
 */
function sameFieldsBesideTranslation(
  oldFields: readonly FieldDefinition[],
  newFields: readonly FieldDefinition[]
): boolean {
  const withoutTranslation = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutTranslation);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, v]) => key !== "localized" && v !== undefined)
        .map(([key, v]) => [key, withoutTranslation(v)] as const)
    );
  };
  return (
    JSON.stringify(withoutTranslation(oldFields)) ===
    JSON.stringify(withoutTranslation(newFields))
  );
}

/** Whether a field kept by the save, under its name or its rename, gets a column of another type. */
function columnTypeChanges(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  columnOf: (field: FieldDefinition) => ColumnDescriptor | null;
  renames: ReadonlyArray<{ from: string; to: string }>;
}): boolean {
  const before = new Map(
    namedOnRow(args.oldFields).map(
      field => [toSnakeCase(field.name), field] as const
    )
  );
  // The type as the database declares it, sizes included (`varchar(255)`, `numeric(10, 2)`): a
  // field whose column keeps it (a Unique text on PostgreSQL stays `text`) changes nothing there.
  const shape = (field: FieldDefinition) =>
    args.columnOf(field)?.dialectType ?? null;
  return namedOnRow(args.newFields).some(field => {
    const column = toSnakeCase(field.name);
    const from =
      args.renames.find(rename => rename.to === column)?.from ?? column;
    const old = before.get(from);
    if (old === undefined) return false;
    // A field gaining or losing a column of its own (a many-to-many, kept in a junction table, made
    // one-to-one) changes no column's type: the column is added or dropped, as the file writes it.
    const was = shape(old);
    const is = shape(field);
    return was !== null && is !== null && was !== is;
  });
}

/** Whether a field new to a Single's table is filled in its row, which the table holds. */
async function fillsSingleRow(
  args: {
    oldFields: readonly FieldDefinition[];
    newFields: readonly FieldDefinition[];
  },
  row: NonNullable<Parameters<typeof pushCarriesValues>[0]["singleRow"]>
): Promise<boolean> {
  const filled = fieldsNewToSingleTable({
    oldFields: args.oldFields,
    newFields: args.newFields,
    renamedTo: row.renamedTo,
  }).some(row.fills);
  return filled && (await row.holdsRow());
}
