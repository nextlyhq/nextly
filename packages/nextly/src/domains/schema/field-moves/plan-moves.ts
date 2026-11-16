/**
 * A save's moves of fields between containers, planned whole for its migration file: each one
 * checked against the definitions before and after (`checkMove`), refused before anything is
 * written where its values could not be kept, and otherwise turned into the statements that keep
 * them (`moveDataStatements`), placed where the file keeps every value:
 *
 * - into a group: the copy runs first, before the file drops the column it leaves;
 * - out of a group: the copy and the clearing of the key run last, after the file adds the column;
 * - from one group to another: copied and cleared first, neither column changing.
 *
 * The file's way down undoes each the same way round. A move into a group the same save creates,
 * or out of one it deletes, has no place in the file between the group's column and the field's,
 * and is refused; saved as two changes, each keeps the values.
 *
 * @module domains/schema/field-moves/plan-moves
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  classifyFieldKind,
  fieldsStoredOnRow,
  getColumnDescriptor,
  toSnakeCase,
} from "../services/field-column-descriptor";

import {
  checkMove,
  type FieldMoveRequest,
  type PlannedMove,
} from "./check-move";
import { moveDataStatements, type MoveColumn } from "./move-statements";

/** Statements for the start and the end of one direction of a migration file. */
interface Placed {
  first: string[];
  last: string[];
}

/** A save's moves as its migration file carries them. */
export interface EntityMoves {
  up: Placed;
  down: Placed;
  /** Each column the save drops because its field moved into a group, and the group it went to. */
  movedColumns: { table: string; column: string; into: string }[];
}

/** The refusal of a move, as the save reports it. */
function refused(request: FieldMoveRequest, message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: request.to.join("."), code: "FIELD_MOVE_REFUSED", message }],
    logContext: { from: request.from, to: request.to },
  });
}

/** The columns a field list keeps on its row. */
function rowColumns(fields: readonly FieldDefinition[]): Set<string> {
  return new Set(
    fieldsStoredOnRow(fields)
      .map(field => (field as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
      .map(toSnakeCase)
  );
}

/** Where a planned move's statements go in the file, in each direction. */
function placed(
  move: PlannedMove,
  target: MoveColumn
): { up: Placed; down: Placed } {
  const up = moveDataStatements(move, target);
  const down = moveDataStatements({ from: move.to, to: move.from }, target);
  if (move.from.kind === "column") {
    // Into a group: copied before the column is dropped; back after the way down adds it again.
    return {
      up: { first: up.copy, last: [] },
      down: { first: [], last: [...down.copy, ...down.clearSource] },
    };
  }
  if (move.to.kind === "column") {
    // Out of a group: copied after the column is added; back before the way down drops it.
    return {
      up: { first: [], last: [...up.copy, ...up.clearSource] },
      down: { first: down.copy, last: [] },
    };
  }
  // Between two groups, whose columns stand throughout.
  return {
    up: { first: [...up.copy, ...up.clearSource], last: [] },
    down: { first: [...down.copy, ...down.clearSource], last: [] },
  };
}

/**
 * The statements a save's `moves` need, or the refusal of the first that cannot keep its values,
 * thrown before anything is written.
 */
export function planEntityMoves(args: {
  before: readonly FieldDefinition[];
  after: readonly FieldDefinition[];
  moves: readonly FieldMoveRequest[];
  /** Whether the entity keeps its values per language. */
  localized: boolean;
  table: string;
  dialect: SupportedDialect;
}): EntityMoves {
  const result: EntityMoves = {
    up: { first: [], last: [] },
    down: { first: [], last: [] },
    movedColumns: [],
  };
  const columnsBefore = rowColumns(args.before);
  const columnsAfter = rowColumns(args.after);
  for (const request of args.moves) {
    const checked = checkMove(args.before, args.after, request, {
      localized: args.localized,
    });
    if (!checked.ok) throw refused(request, checked.message);
    const { move } = checked;
    if (move.to.kind === "json" && !columnsBefore.has(move.to.column)) {
      throw refused(
        request,
        "The group this field moves into is new in this save. Save the new group first, then move the field into it."
      );
    }
    if (move.from.kind === "json" && !columnsAfter.has(move.from.column)) {
      throw refused(
        request,
        "The group this field moves out of is deleted in this save. Move the field out first, then delete the group."
      );
    }
    // A field moving between places on one level (a group with no name) keeps its column.
    if (move.from.kind === "column" && move.to.kind === "column") continue;
    const target: MoveColumn = {
      table: args.table,
      dialect: args.dialect,
      kind: classifyFieldKind(move.field, "collection"),
      columnType:
        getColumnDescriptor(move.field, args.dialect, "collection")
          ?.dialectType ?? "text",
    };
    const statements = placed(move, target);
    result.up.first.push(...statements.up.first);
    result.up.last.push(...statements.up.last);
    result.down.first.push(...statements.down.first);
    result.down.last.push(...statements.down.last);
    if (move.from.kind === "column" && move.to.kind === "json") {
      result.movedColumns.push({
        table: args.table,
        column: move.from.column,
        into: move.to.column,
      });
    }
  }
  return result;
}
