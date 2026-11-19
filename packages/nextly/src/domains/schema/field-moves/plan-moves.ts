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
import { getPrebuiltHook } from "../../../hooks/prebuilt";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  classifyFieldKind,
  fieldProducesColumn,
  fieldsStoredOnRow,
  getColumnDescriptor,
  systemColumnsForFields,
  toSnakeCase,
} from "../services/field-column-descriptor";

import {
  checkMove,
  placeOf,
  type FieldMoveRequest,
  type PlannedMove,
  type StoragePlace,
} from "./check-move";
import { fieldsThatLeft } from "./move-candidates";
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
  /**
   * Each column the save adds because its field moved out of a group, which the file's last
   * statements fill from the group: added without NOT NULL, and made required once they have.
   */
  refilledColumns: {
    table: string;
    column: string;
    /** The field's name, for a refusal to name it. */
    field: string;
    /** Whether the field is required, so every entry needs a value to move. */
    required: boolean;
    /** The column's kind, which says what a value from the group must be to be read into it. */
    kind: MoveColumn["kind"];
    /** Where the values come from: the group's column and the keys inside it. */
    source: { column: string; keys: readonly string[] };
  }[];
}

/** The refusal of a move, as the save reports it. */
function refused(request: FieldMoveRequest, message: string): NextlyError {
  return NextlyError.validation({
    errors: [
      { path: request.to.join("."), code: "FIELD_MOVE_REFUSED", message },
    ],
    logContext: { from: request.from, to: request.to },
  });
}

/** The columns a field list keeps on its row: a field that makes none (a virtual group) has none. */
function rowColumns(fields: readonly FieldDefinition[]): Set<string> {
  return new Set(
    fieldsStoredOnRow(fields)
      .filter(field => fieldProducesColumn(field))
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
 * Refuses a move with no place in the file: into a group the same save creates, whose column the
 * file adds after it drops the field's, or out of one it deletes, whose column goes first.
 */
/**
 * Refuses a move that is not its field's own: a field keeps its name as it moves, so two moves
 * whose places were swapped, or one whose field the save also renames, would carry one field's
 * values into another's place. Each is a change of its own: the move, then the rename.
 */
function refuseUnbound(request: FieldMoveRequest): void {
  const name = request.from.at(-1) ?? "";
  if (request.to.at(-1) !== name) {
    throw refused(
      request,
      `${request.from.join(".")} moves to ${request.to.join(".")}, a field of another name. A field keeps its name as it moves: move it, then rename it in a later save.`
    );
  }
}

/**
 * Refuses two moves of fields of one name in the same save: with names kept, fields of one name
 * in different groups are told apart only by their paths, so a swap of their places would pass as
 * two moves. Saved one at a time, each move's field is the only one of its name.
 */
function refuseSameNames(moves: readonly FieldMoveRequest[]): void {
  const seen = new Set<string>();
  for (const request of moves) {
    const name = request.from.at(-1) ?? "";
    if (seen.has(name)) {
      throw refused(
        request,
        `Two fields named ${name} move in this save. Move each in a save of its own.`
      );
    }
    seen.add(name);
  }
}

/**
 * Refuses a move whose field's name another field also leaves its place with, or also arrives
 * with, in a save that gives that field no move of its own: which field moved where is not known
 * from the definitions. A rival that left would keep its values at a place nothing reads; a rival
 * that arrived could be handed values that belong to the field the move names.
 */
function refuseUnpairedNames(
  given: {
    before: readonly FieldDefinition[];
    after: readonly FieldDefinition[];
    moves: readonly FieldMoveRequest[];
  },
  renames: readonly { from: string; to: string }[]
): void {
  // A field the save renames leaves its place under one name and arrives under another, at the
  // top of the entity; no move takes either.
  const unrenamed = (side: "from" | "to") => {
    const names = new Set(renames.map(r => toSnakeCase(r[side])));
    return (each: { path: readonly string[] }) =>
      !(each.path.length === 1 && names.has(toSnakeCase(each.path[0])));
  };
  const sides = [
    {
      verb: "leaves its place",
      unpaired: fieldsThatLeft(given.before, given.after).filter(
        unrenamed("from")
      ),
      paired: new Set(given.moves.map(request => request.from.join("."))),
    },
    {
      verb: "arrives",
      unpaired: fieldsThatLeft(given.after, given.before).filter(
        unrenamed("to")
      ),
      paired: new Set(given.moves.map(request => request.to.join("."))),
    },
  ];
  for (const request of given.moves) {
    if (samePath(request.from, request.to)) continue;
    const name = request.from.at(-1) ?? "";
    // A move that changes the name is refused on its own (`refuseUnbound`), with that reason.
    if (request.to.at(-1) !== name) continue;
    for (const side of sides) {
      const rival = side.unpaired.find(
        each =>
          each.path.at(-1) === name && !side.paired.has(each.path.join("."))
      );
      if (rival === undefined) continue;
      throw refused(
        request,
        `Another field named ${name} (${rival.path.join(".")}) also ${side.verb} in this save, so which one moves here is not certain. Move ${name} in a save of its own.`
      );
    }
  }
}

/**
 * Refuses a move whose column the same save also renames: the copy and the rename would act on
 * one column. Renames name columns, so only a move's own columns are matched: a field moving
 * between groups has none.
 */
function refuseRenamedColumns(
  request: FieldMoveRequest,
  move: PlannedMove,
  renames: readonly { from: string; to: string }[]
): void {
  const columns = new Set(
    [move.from, move.to].flatMap(place =>
      place.kind === "column" ? [place.column] : []
    )
  );
  const renamed = renames.find(
    r => columns.has(toSnakeCase(r.from)) || columns.has(toSnakeCase(r.to))
  );
  if (renamed !== undefined) {
    throw refused(
      request,
      `${request.from.at(-1) ?? ""} is moved in this save and also renamed (${renamed.from} to ${renamed.to}). Move it first, then rename it in a later save.`
    );
  }
}

/**
 * Refuses an optional field made required as it moves into a group: the move carries each empty
 * value as a null the required field refuses, so the change waits for a save of its own.
 */
function refuseMadeRequired(
  request: FieldMoveRequest,
  move: PlannedMove,
  before: readonly FieldDefinition[]
): void {
  const required = (field: FieldDefinition | undefined) =>
    (field as { required?: unknown } | undefined)?.required === true;
  if (
    move.to.kind === "json" &&
    required(move.field) &&
    !required(placeOf(before, request.from)?.field)
  ) {
    throw refused(
      request,
      `${request.from.at(-1) ?? ""} is made required as it moves into a group. Move it first, then make it required in a later save.`
    );
  }
}

/**
 * Refuses a move whose group was another kind of field on the other side of the save: a JSON field
 * or a repeater of the same name keeps a value of its own there, which the group's statements
 * would leave or overwrite rather than carry.
 */
function refuseHoldersNotGroups(
  request: FieldMoveRequest,
  move: PlannedMove,
  fields: {
    before: readonly FieldDefinition[];
    after: readonly FieldDefinition[];
  }
): void {
  // A name with no field on that side is a group the save makes or deletes, refused with its own
  // reason (`refuseUnplaceable`); here only one another kind of field holds.
  // Every container on the path, not only the outermost: a nested one changes kind as well.
  const otherKind = (
    list: readonly FieldDefinition[],
    path: readonly string[],
    column: string
  ): string | undefined =>
    path
      .slice(0, -1)
      .map((_, at) => path.slice(0, at + 1))
      .find(prefix => {
        const placed = placeOf(list, prefix);
        return placed !== null && placed.field.type !== "group";
      })
      ?.join(".") ??
    // A field of another kind on the group's column under another spelling (`seoMeta` beside
    // `seo_meta`): its JSON value stays in the column the group's statements write to.
    (columnHeldByOtherKind(list, column) ? path[0] : undefined);
  const into =
    move.to.kind === "json"
      ? otherKind(fields.before, request.to, move.to.column)
      : undefined;
  if (into !== undefined) {
    throw refused(
      request,
      `${into} was not a group before this save. Save it as a group first, then move the field into it.`
    );
  }
  const outOf =
    move.from.kind === "json"
      ? otherKind(fields.after, request.from, move.from.column)
      : undefined;
  if (outOf !== undefined) {
    throw refused(
      request,
      `${outOf} is not a group after this save. Move the field out first, then change ${outOf}.`
    );
  }
}

/** The admin settings that name a top-level field, as the definition file holds them. */
interface AdminReferences {
  useAsTitle?: string;
  defaultColumns?: readonly string[];
}

/**
 * Refuses moving into a group a top-level field the admin settings name: the definition file
 * holds them beside the fields and is read only where each names a top-level field, so the save
 * would leave it unreadable.
 */
function refuseNamedByAdmin(
  request: FieldMoveRequest,
  admin: AdminReferences | undefined
): void {
  if (request.from.length !== 1 || request.to.length === 1) return;
  const name = request.from[0] ?? "";
  const setting =
    admin?.useAsTitle === name
      ? "useAsTitle"
      : admin?.defaultColumns?.includes(name) === true
        ? "defaultColumns"
        : undefined;
  if (setting === undefined) return;
  throw refused(
    request,
    `${name} is named in the admin settings (${setting}), which name only top-level fields. Choose another field there first, then move ${name}.`
  );
}

/** A hook the entity's definition stores, as the stored-hook executor reads it. */
interface StoredHookReference {
  hookId: string;
  enabled: boolean;
  config: Readonly<Record<string, unknown>>;
}

/**
 * Refuses moving into a group a top-level field an enabled stored hook names, as the admin
 * settings' refusal does: the executor hands each hook its stored config as it stands, and the
 * hook reads and writes the entry's top-level keys by those names (auto-slug's `sourceField`), so
 * it would stop finding the field without saying so. A hook the executor does not know is skipped
 * there, and here.
 */
function refuseNamedByHook(
  request: FieldMoveRequest,
  hooks: readonly StoredHookReference[] | undefined
): void {
  if (request.from.length !== 1 || request.to.length === 1) return;
  const name = request.from[0] ?? "";
  for (const stored of hooks ?? []) {
    const hook = stored.enabled ? getPrebuiltHook(stored.hookId) : undefined;
    if (hook === undefined) continue;
    const setting = Object.keys(stored.config).find(
      key => stored.config[key] === name
    );
    if (setting === undefined) continue;
    throw refused(
      request,
      `${name} is named by the ${hook.name} hook (${setting}), which reads and writes only top-level fields. Update the hook first, then move ${name}.`
    );
  }
}

/** Whether a field on the row that is not a group keeps its values in `column`. */
function columnHeldByOtherKind(
  fields: readonly FieldDefinition[],
  column: string
): boolean {
  return fieldsStoredOnRow(fields).some(field => {
    const { name } = field as { name?: unknown };
    return (
      field.type !== "group" &&
      typeof name === "string" &&
      fieldProducesColumn(field) &&
      toSnakeCase(name) === column
    );
  });
}

/**
 * Refuses a move whose values are kept for each language: this save's statements carry one value
 * for every language, so such a move waits for the saves that move each language's row.
 */
function refusePerLanguage(request: FieldMoveRequest, move: PlannedMove): void {
  if (!move.perLanguage) return;
  throw refused(
    request,
    `${request.from.at(-1) ?? "This field"}'s values are kept for each language, and moving it with them is not available yet for this kind of entity.`
  );
}

function refuseUnplaceable(
  request: FieldMoveRequest,
  move: PlannedMove,
  columns: { before: Set<string>; after: Set<string> }
): void {
  if (move.to.kind === "json" && !columns.before.has(move.to.column)) {
    throw refused(
      request,
      "The group this field moves into is new in this save. Save the new group first, then move the field into it."
    );
  }
  // A column another field holds on the far side: the field deleted beside a move out onto its
  // column, whose values the copy would leave on every entry without one to carry, or one added
  // beside a move in, which would show the moved field's values as its own.
  if (move.to.kind === "column" && columns.before.has(move.to.column)) {
    throw refused(
      request,
      "The column this field moves to still holds another field before this save. Save that change first, then move the field."
    );
  }
  if (move.from.kind === "column" && columns.after.has(move.from.column)) {
    throw refused(
      request,
      "The column this field moves from is taken by another field in this save. Move the field first, then add the other one."
    );
  }
  if (move.from.kind === "json" && !columns.after.has(move.from.column)) {
    throw refused(
      request,
      "The group this field moves out of is deleted in this save. Move the field out first, then delete the group."
    );
  }
}

const samePath = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((segment, at) => segment === b[at]);

/** Whether `outer` is `inner` or a group above it. */
const reaches = (outer: readonly string[], inner: readonly string[]): boolean =>
  outer.length <= inner.length &&
  outer.every((segment, at) => segment === inner[at]);

/**
 * Refuses moves that reach the same field: a group and a field inside it, or one field twice.
 * Each move's statements copy and then clear, so one clearing a place another still copies from
 * would strand that value; saved apart, each keeps its values.
 */
function refuseOverlapping(moves: readonly FieldMoveRequest[]): void {
  for (const [at, one] of moves.entries()) {
    for (const other of moves.slice(at + 1)) {
      const overlaps =
        reaches(one.from, other.from) ||
        reaches(other.from, one.from) ||
        reaches(one.to, other.to) ||
        reaches(other.to, one.to);
      if (overlaps) {
        throw refused(
          other,
          "This save moves a group and a field inside it, or one field twice. Save each move on its own."
        );
      }
    }
  }
}

/**
 * Refuses a field moved inside its own place, one path holding the other (`g.a` to `g.a.a`, or
 * back): the group made there, or taken away, would replace the value in the group's JSON before
 * the copy reads it. Asked before the paths are matched, so the person is told what to do.
 */
function refuseInsideOwnPlace(request: FieldMoveRequest): void {
  if (
    !reaches(request.from, request.to) &&
    !reaches(request.to, request.from)
  ) {
    return;
  }
  const name = request.from.at(-1) ?? request.from.join(".");
  throw refused(
    request,
    `${name} cannot be moved from ${request.from.join(".")} to ${request.to.join(".")}, inside its own place: the group there would replace its value before the value is copied. Move ${name} somewhere else first, then into its new place in a later save.`
  );
}

/**
 * Refuses a move the save's fields do not show: a field still at the place it moves from, or one
 * already at the place it moves to. A move is the request's word for which field went where, so
 * one naming another field would copy that field's values over the wrong place.
 */
function refuseUnmatched(
  before: readonly FieldDefinition[],
  after: readonly FieldDefinition[],
  request: FieldMoveRequest
): void {
  if (
    placeOf(after, request.from) !== null ||
    placeOf(before, request.to) !== null
  ) {
    throw refused(
      request,
      `The move from ${request.from.join(".")} to ${request.to.join(".")} does not match the save's fields: a field is still at the first place, or was already at the second.`
    );
  }
}

/** The moved field's column on `table`: its kind, and its type as the dialect declares it. */
function moveColumn(
  move: PlannedMove,
  table: string,
  dialect: SupportedDialect
): MoveColumn {
  return {
    table,
    dialect,
    kind: classifyFieldKind(move.field, "collection"),
    columnType:
      getColumnDescriptor(move.field, dialect, "collection")?.dialectType ??
      "text",
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
  /** The fields the save renames, by name: a moved field may not be one of them. */
  renames?: readonly { from: string; to: string }[];
  /** Whether the entity keeps its values per language. */
  localized: boolean;
  table: string;
  dialect: SupportedDialect;
  /** The entity's admin settings after the save, which name top-level fields. */
  admin?: AdminReferences;
  /** The hooks the entity's definition stores after the save, whose settings name fields. */
  hooks?: readonly StoredHookReference[];
}): EntityMoves {
  const result: EntityMoves = {
    up: { first: [], last: [] },
    down: { first: [], last: [] },
    movedColumns: [],
    refilledColumns: [],
  };
  const columns = {
    before: rowColumns(args.before),
    after: rowColumns(args.after),
  };
  // The system columns the table holds before the save, `title` and `slug` among them while no
  // field takes their name.
  const systemBefore = new Set(
    systemColumnsForFields(args.before, args.dialect, {
      builtBy: "collection",
    }).map(column => column.name)
  );
  refuseOverlapping(args.moves);
  refuseSameNames(args.moves);
  refuseUnpairedNames(args, args.renames ?? []);
  for (const request of args.moves) {
    // A field that keeps its path (moved into or out of a group with no name) keeps its place.
    if (samePath(request.from, request.to)) continue;
    refuseInsideOwnPlace(request);
    refuseUnbound(request);
    refuseNamedByAdmin(request, args.admin);
    refuseNamedByHook(request, args.hooks);
    refuseUnmatched(args.before, args.after, request);
    const checked = checkMove(args.before, args.after, request, {
      localized: args.localized,
    });
    if (!checked.ok) throw refused(request, checked.message);
    const { move } = checked;
    refusePerLanguage(request, move);
    refuseHoldersNotGroups(request, move, args);
    refuseRenamedColumns(request, move, args.renames ?? []);
    refuseMadeRequired(request, move, args.before);
    refuseUnplaceable(request, move, columns);
    refuseSystemColumn(request, move, systemBefore);
    // A field moving between places on one level (a group with no name) keeps its column, and
    // one whose group only changes its spelling (`seoMeta` to `seo_meta`) keeps its column and
    // key: a copy onto itself, then the clear of the place it left, would delete every value.
    if (move.from.kind === "column" && move.to.kind === "column") continue;
    if (sameJsonPlace(move.from, move.to)) continue;
    const target = moveColumn(move, args.table, args.dialect);
    const statements = placed(move, target);
    for (const way of ["up", "down"] as const) {
      result[way].first.push(...statements[way].first);
      result[way].last.push(...statements[way].last);
    }
    recordColumns(result, move, request, target);
  }
  return result;
}

/**
 * Refuses a move out of a group onto a column the table keeps for itself while no field takes its
 * name, such as `title` or `slug`: every entry already holds its own value there, which the copy
 * would write over, and an entry without the moved value would show its old one as the field's.
 */
function refuseSystemColumn(
  request: FieldMoveRequest,
  move: PlannedMove,
  systemBefore: ReadonlySet<string>
): void {
  if (move.to.kind !== "column" || !systemBefore.has(move.to.column)) return;
  const name = request.from.at(-1) ?? "This field";
  throw refused(
    request,
    `Every entry already keeps its own ${move.to.column} while no field is named ${move.to.column}, and moving ${name} there would write over it. Rename ${name} inside the group first, then move it out.`
  );
}

/** Whether two places are one key of one JSON column, each read as the database stores it. */
function sameJsonPlace(a: StoragePlace, b: StoragePlace): boolean {
  return (
    a.kind === "json" &&
    b.kind === "json" &&
    a.column === b.column &&
    a.keys.length === b.keys.length &&
    a.keys.every((key, at) => key === b.keys[at])
  );
}

/** The column a move adds and fills from its group, or the one it drops into a group, recorded. */
function recordColumns(
  result: EntityMoves,
  move: PlannedMove,
  request: FieldMoveRequest,
  target: MoveColumn
): void {
  const { table } = target;
  const { from, to } = move;
  if (from.kind === "json" && to.kind === "column") {
    result.refilledColumns.push({
      table,
      column: to.column,
      field: request.to.join("."),
      required: (move.field as { required?: unknown }).required === true,
      kind: target.kind,
      source: { column: from.column, keys: from.keys },
    });
  }
  if (from.kind === "column" && to.kind === "json") {
    result.movedColumns.push({ table, column: from.column, into: to.column });
  }
}
