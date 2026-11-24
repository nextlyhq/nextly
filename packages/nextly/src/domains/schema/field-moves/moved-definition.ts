/**
 * The definition a move file's first step leaves: the fields as they were, with each move made and
 * nothing else changed. On MySQL, where each statement stands as it runs, a move is written as two
 * migration files; the first one's registry row and snapshot describe this definition exactly, so a
 * run stopped between the two steps reads each value where the registry places its field.
 *
 * @module domains/schema/field-moves/moved-definition
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";

import { placeOf, type FieldMoveRequest } from "./check-move";

/** The fields named or nested below `field`, as a definition lists them. */
function childrenOf(field: FieldDefinition): FieldDefinition[] {
  const { fields } = field as { fields?: unknown };
  return Array.isArray(fields) ? (fields as FieldDefinition[]) : [];
}

function nameOf(field: FieldDefinition): string | undefined {
  const { name } = field as { name?: unknown };
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/** `field` holding `fields`: the group's own shape is kept, its list replaced. */
const holding = (field: FieldDefinition, fields: FieldDefinition[]) =>
  ({ ...field, fields }) as FieldDefinition;

/**
 * `fields` without the field at `path`, and that field. A group with no name is looked through, as
 * its fields stand on the level it is on.
 */
function take(
  fields: readonly FieldDefinition[],
  path: readonly string[]
): { left: FieldDefinition[]; taken: FieldDefinition | undefined } {
  const [segment, ...rest] = path;
  let taken: FieldDefinition | undefined;
  const left: FieldDefinition[] = [];
  for (const field of fields) {
    if (taken !== undefined) {
      left.push(field);
      continue;
    }
    if (nameOf(field) === undefined && childrenOf(field).length > 0) {
      const inner = take(childrenOf(field), path);
      taken = inner.taken;
      left.push(taken === undefined ? field : holding(field, inner.left));
      continue;
    }
    if (nameOf(field) !== segment) {
      left.push(field);
      continue;
    }
    if (rest.length === 0) {
      taken = field;
      continue;
    }
    const inner = take(childrenOf(field), rest);
    taken = inner.taken;
    left.push(taken === undefined ? field : holding(field, inner.left));
  }
  return { left, taken };
}

/**
 * `list` with `field` after the nearest field before it in `siblings`, the list as the change leaves
 * it, that `list` holds too; first where it has none, and last where `siblings` does not hold it.
 */
function inserted(
  list: readonly FieldDefinition[],
  field: FieldDefinition,
  siblings: readonly FieldDefinition[]
): FieldDefinition[] {
  const at = siblings.findIndex(each => nameOf(each) === nameOf(field));
  if (at === -1) return [...list, field];
  for (const before of siblings.slice(0, at).reverse()) {
    const name = nameOf(before);
    const held = list.findIndex(
      each => name !== undefined && nameOf(each) === name
    );
    if (held !== -1) {
      return [...list.slice(0, held + 1), field, ...list.slice(held + 1)];
    }
  }
  return [field, ...list];
}

/**
 * `fields` with `field` put into the group at `holders`, or on the top level with none, placed as
 * `siblings` has it. A group with no name is looked through: its fields stand on the level it is on.
 */
function put(
  fields: readonly FieldDefinition[],
  holders: readonly string[],
  field: FieldDefinition,
  siblings: readonly FieldDefinition[]
): FieldDefinition[] {
  const [segment, ...rest] = holders;
  if (segment === undefined) return inserted(fields, field, siblings);
  let placed = false;
  return fields.map(each => {
    if (placed) return each;
    const named = nameOf(each);
    const inside = childrenOf(each);
    if (named === undefined && inside.length > 0) {
      if (placeOf(inside, [segment]) === null) return each;
      placed = true;
      return holding(each, put(inside, holders, field, siblings));
    }
    if (named !== segment) return each;
    placed = true;
    return holding(each, put(inside, rest, field, siblings));
  });
}

/** The list of fields `holders` names in `fields`: the group's own, or the top level's. */
function listAt(
  fields: readonly FieldDefinition[],
  holders: readonly string[]
): readonly FieldDefinition[] {
  if (holders.length === 0) return fields;
  const holder = placeOf(fields, holders);
  return holder === null ? [] : childrenOf(holder.field);
}

/**
 * `fields` with each of `holders` it lacks added as the change leaves it (`after`), empty: a move
 * into a group the same change adds stands in that group from the first step on.
 */
function withHolders(
  fields: readonly FieldDefinition[],
  after: readonly FieldDefinition[],
  holders: readonly string[]
): FieldDefinition[] {
  let next = [...fields];
  for (const depth of holders.keys()) {
    const path = holders.slice(0, depth + 1);
    if (placeOf(next, path) !== null) continue;
    const made = placeOf(after, path);
    if (made === null) continue;
    const above = path.slice(0, -1);
    next = put(next, above, holding(made.field, []), listAt(after, above));
  }
  return next;
}

/**
 * The moved field as the first step places it: as it was, under the name it arrives with. One moved
 * onto the row is not Required there yet, as `after` has it otherwise: its column is filled from the
 * group first, and Required is asked on the second step, once the values are in.
 */
function arriving(
  taken: FieldDefinition,
  move: FieldMoveRequest,
  after: readonly FieldDefinition[]
): FieldDefinition {
  const name = move.to[move.to.length - 1] ?? "";
  if (move.to.length > 1) return { ...taken, name };
  const { required: _required, ...rest } = taken as FieldDefinition & {
    required?: boolean;
  };
  const arrived = after.find(field => nameOf(field) === name) as
    | { required?: boolean }
    | undefined;
  const required =
    arrived?.required === undefined ? {} : { required: false as const };
  return { ...rest, name, ...required };
}

/**
 * `before` with each of `moves` made and nothing else changed, placed as `after` places them, so a
 * change that only moves fields leaves exactly `after`, Required aside (`arriving`).
 */
export function fieldsWithMoves(
  before: readonly FieldDefinition[],
  after: readonly FieldDefinition[],
  moves: readonly FieldMoveRequest[]
): FieldDefinition[] {
  let fields = [...before];
  for (const move of moves) {
    const { left, taken } = take(fields, move.from);
    if (taken === undefined) continue;
    const holders = move.to.slice(0, -1);
    fields = put(
      withHolders(left, after, holders),
      holders,
      arriving(taken, move, after),
      listAt(after, holders)
    );
    // The planner refused every move with no place in `after` (`planEntityMoves`), so a field left
    // without one is no move of this change: written so, the first step would delete it.
    if (placeOf(fields, move.to) === null) {
      throw NextlyError.internal({
        logContext: { reason: "move-step-unplaced", move },
      });
    }
  }
  return fields;
}
