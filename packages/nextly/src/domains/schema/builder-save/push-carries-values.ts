/**
 * Whether a Single's or field group's Schema Builder save is one only its dialog's push applies,
 * rather than the migration file the save writes.
 *
 * @module domains/schema/builder-save/push-carries-values
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isFieldLocalized } from "../../i18n/classify-fields";
import { fieldsLeavingTranslationUnder } from "../../i18n/migration/archive-preflight";
import { fieldsJoiningTranslation } from "../../i18n/migration/field-joins-translation";
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
 * written from the newest snapshot, does not yet: translation turned on or off for the entity's
 * values, or its per-language Draft/Published turned on or off, each seeding or restoring
 * columns from the ones they replace; a field joining translation or leaving it, its values moved
 * between the main table and the companion (judged under `renamed`, the companion rename the save
 * makes, as the preflights judge it); a translated field renamed or removed, its companion column
 * judged against the companion as it stands; a field whose column changes type or size, whose
 * stored values the push judges before it alters the column; a field new to a Single's table that
 * its row is filled in; and a change reaching a relation's storage
 * (`reachesRelationStorage`), which the push plans from the live table.
 *
 * Any other save moves no value, and its file applies it, in tries over a busy table and on SQLite
 * as a migration file runs, with the companion brought in step after it.
 */
export async function pushCarriesValues(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  /** Whether the values are stored per language before and after the save. */
  wasStored: boolean;
  isStored: boolean;
  /** Per-language Draft/Published before and after the save. A field group has neither. */
  wasStatus?: boolean;
  status?: boolean;
  /** The companion rename the save makes, if any. */
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
  /**
   * The fields the save moves into or out of a group (`hints.moves`), each by its path before and
   * after. Their values move through the file's own statements, so a field leaving the row for a
   * group is not removed, and one arriving on it from a group is not new to it.
   */
  moved?: readonly MovedField[];
}): Promise<boolean> {
  if (args.wasStored !== args.isStored) return true;
  if (args.isStored && args.wasStatus !== args.status) return true;
  if (
    args.isStored &&
    fieldsJoiningTranslation(args.oldFields, args.newFields).length > 0
  ) {
    return true;
  }
  if (
    args.wasStored &&
    fieldsLeavingTranslationUnder(args.oldFields, args.newFields, args.renamed)
      .length > 0
  ) {
    return true;
  }
  // A translated field renamed or removed: its companion column is renamed or dropped, judged by
  // the push against the companion as it stands, so a save made again after one that stopped part
  // way finishes it. The file, planned from the companion's history, would rename or drop it again.
  if (args.wasStored && translatedFieldRenamedOrRemoved(args)) return true;
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

/** A field the save moves, by its path before and after. */
interface MovedField {
  from: readonly string[];
  to: readonly string[];
}

/** The names of the fields a move takes off the row, into a group. */
function movedOffRow(moved: readonly MovedField[] | undefined): Set<string> {
  return new Set(
    (moved ?? []).flatMap(m => (m.from.length === 1 ? [m.from[0] ?? ""] : []))
  );
}

/** The columns of the fields a move brings onto the row, out of a group. */
function movedOntoRow(moved: readonly MovedField[] | undefined): Set<string> {
  return new Set(
    (moved ?? []).flatMap(m =>
      m.to.length === 1 ? [toSnakeCase(m.to[0] ?? "")] : []
    )
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
    moved?: readonly MovedField[];
  },
  row: NonNullable<Parameters<typeof pushCarriesValues>[0]["singleRow"]>
): Promise<boolean> {
  // A field a move brings out of a group takes its values from there, not a fill.
  const movedOn = movedOntoRow(args.moved);
  const filled = fieldsNewToSingleTable({
    oldFields: args.oldFields,
    newFields: args.newFields,
    renamedTo: row.renamedTo,
  })
    .filter(field => !movedOn.has(toSnakeCase(field.name)))
    .some(row.fills);
  return filled && (await row.holdsRow());
}

/** Whether a field translated before the save is renamed, or is gone from the fields after it. */
function translatedFieldRenamedOrRemoved(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  renamed: FieldRename | null | undefined;
  moved?: readonly MovedField[];
}): boolean {
  if (args.renamed) return true;
  // A field a move takes into a group keeps its values there, through the file's statements.
  const kept = new Set([
    ...namedOnRow(args.newFields).map(field => field.name),
    ...movedOffRow(args.moved),
  ]);
  return namedOnRow(args.oldFields).some(
    field => isFieldLocalized(field, true) && !kept.has(field.name)
  );
}
