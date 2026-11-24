/**
 * A migration that moves fields, written for MySQL as two files. MySQL commits each schema statement
 * as it runs, so a move's copy of the values, the column it adds or drops and the registry row that
 * says where the field is cannot all be one step there, as they are on PostgreSQL and SQLite: a run
 * stopped between them would read the field where its values are not.
 *
 * The first file makes the moves and nothing else, and its last transaction commits the values
 * copied, the registry row and the file's record together:
 *
 * - out of a group: the column is added, optional, then filled, the group's key cleared;
 * - into a group: the values are copied, and the column they leave stays, optional and unread;
 * - between groups: copied and cleared, no column changing.
 *
 * The second file is every other change of the run, from the first one's snapshot: the column a move
 * left dropped, one it filled made required, and whatever else the change makes. A run stopped
 * anywhere in either file, or between them, leaves every value where the registry places its field.
 *
 * This module holds what the first file's snapshot records; `generate.ts` writes the files.
 *
 * @module domains/schema/migrate-create/move-step
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { FieldMoveRequest } from "../field-moves/check-move";
import { fieldsWithMoves } from "../field-moves/moved-definition";
import type { TableSpec } from "../pipeline/diff/types";

import {
  recordedSettingsOf,
  withRecordedSettings,
  type EntitySettingsRecord,
  type SettingsEntityKind,
  type SettingsValue,
} from "./entity-settings";
import type { AddedStatements } from "./generate";

/** An entity whose fields a run moves, with the moves, for its definition after them. */
export interface MovedEntity {
  kind: SettingsEntityKind;
  slug: string;
  /** Its fields before the run, where the snapshot the run starts from records none. */
  before: readonly FieldDefinition[];
  moves: readonly FieldMoveRequest[];
}

/** What a run's moves add to its migration, in the generator's own terms, and the moves themselves. */
export interface RunMoves {
  /** The statements that carry the values, each side's first and last (`planEntityMoves`). */
  appended: { up: AddedStatements; down: AddedStatements };
  /** Each column a move into a group drops, named as the move it is. */
  valueMoves: readonly { table: string; column: string; reason: string }[];
  /** Each column a move out of a group adds and fills. */
  refilledColumns: readonly { table: string; column: string }[];
  /** The tables whose rows the statements change. */
  valuesMovedIn: readonly string[];
  entities: readonly MovedEntity[];
}

/**
 * `tables` as the moves alone leave them: a column a move into a group leaves stays, now optional, so
 * a new entry needs no value there, and one a move out of a group fills is there as `desired` declares
 * it, optional until every entry has its value. Every other column, index and key stays as it is.
 */
export function tablesAfterMoves(
  tables: readonly TableSpec[],
  desired: readonly TableSpec[],
  moves: Pick<RunMoves, "valueMoves" | "refilledColumns">
): TableSpec[] {
  return tables.map(table => {
    const left = new Set(
      moves.valueMoves
        .filter(move => move.table === table.name)
        .map(move => move.column)
    );
    const declared = desired.find(each => each.name === table.name);
    const filled = moves.refilledColumns
      .filter(column => column.table === table.name)
      .flatMap(
        ({ column }) =>
          declared?.columns.filter(each => each.name === column) ?? []
      );
    if (left.size + filled.length === 0) return table;
    return {
      ...table,
      columns: [
        ...table.columns.map(column =>
          left.has(column.name) ? { ...column, nullable: true } : column
        ),
        ...filled.map(column => ({ ...column, nullable: true })),
      ],
    };
  });
}

/**
 * The declarations the moves alone leave: each moved entity's as `previous` records it, else as
 * `desired` does, with its fields moved (`fieldsWithMoves`). `moved` holds the moved entities alone;
 * `recorded` is the whole record, or undefined where `previous` records none: a record of some
 * entities would read as the removal of the rest.
 */
export function declarationsAfterMoves(
  previous: EntitySettingsRecord | undefined,
  desired: EntitySettingsRecord | undefined,
  entities: readonly MovedEntity[]
): { recorded: EntitySettingsRecord | undefined; moved: EntitySettingsRecord } {
  let moved: EntitySettingsRecord = {
    collections: {},
    singles: {},
    fieldGroups: {},
  };
  let recorded = previous;
  for (const { kind, slug, before, moves } of entities) {
    const was = recordedSettingsOf(previous, kind, slug);
    const becomes = recordedSettingsOf(desired, kind, slug);
    const entry = was ?? becomes;
    if (entry === undefined) continue;
    const declared = {
      ...entry,
      settings: {
        ...entry.settings,
        fields: fieldsWithMoves(
          fieldsOf(was?.settings.fields) ?? before,
          fieldsOf(becomes?.settings.fields) ?? [],
          moves
        ) as unknown as SettingsValue[],
      },
    };
    moved = withRecordedSettings(moved, kind, slug, declared);
    if (recorded !== undefined) {
      recorded = withRecordedSettings(recorded, kind, slug, declared);
    }
  }
  return { recorded, moved };
}

/** A declaration's fields as the record holds them, where it holds a list of them. */
function fieldsOf(
  value: SettingsValue | undefined
): FieldDefinition[] | undefined {
  return Array.isArray(value)
    ? (value as unknown as FieldDefinition[])
    : undefined;
}
