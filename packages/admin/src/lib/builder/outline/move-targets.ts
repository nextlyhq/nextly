/**
 * Where each way of moving a field asks to put it, as a place the move rule
 * judges: a step up or down, out of its container or into the one above it,
 * and a drop on another row, whose sideways offset sets the level.
 *
 * Read from the outline's rows rather than the Builder's fields, because the
 * rows are what a person sees and points at: a field group's own fields and a
 * pending delete are rows the Builder does not hold. A place is still named by
 * the Builder's own fields, so the rule can judge it: a field group's field
 * stands for the field using the group, and a pending delete is never an
 * anchor, since the Builder no longer holds it.
 *
 * Nothing here decides whether a move is allowed; `move-rule` does, for every
 * one of these alike.
 *
 * @module lib/builder/outline/move-targets
 */
import type { FieldInsertPosition } from "../insert-field";

import type { OutlineNode } from "./outline-model";
import { isPendingDelete } from "./pending-rows";

/** A step a key or the menu asks for. */
export type MoveStep = "up" | "down" | "out" | "in";

/** The rows an outline is drawn from, looked up by id. */
export interface OutlineRows {
  nodes: readonly OutlineNode[];
  byId: ReadonlyMap<string, OutlineNode>;
}

/** A row the Builder holds as one of the entity's own fields, as it is now. */
function held(node: OutlineNode): boolean {
  return node.own && !isPendingDelete(node);
}

/** The rows a row sits among: its container's, or the top level's. */
function siblingsOf(
  rows: OutlineRows,
  node: OutlineNode
): readonly OutlineNode[] {
  const parent = node.parentId ? rows.byId.get(node.parentId) : undefined;
  return parent ? parent.children : rows.nodes;
}

/**
 * The entity's own field a row stands for in a place: itself, or for a field
 * group's field, the field using the group, so a move there is judged as a
 * move into that field.
 */
function ownRow(rows: OutlineRows, node: OutlineNode): OutlineNode | null {
  let at: OutlineNode | undefined = node;
  while (at && !at.own) {
    at = at.parentId ? rows.byId.get(at.parentId) : undefined;
  }
  return at ?? null;
}

/**
 * For a field group's own row, the entity's field using the group, which the
 * move rule judges a move of that row as; undefined for any other row, a
 * registered block's or prop's among them, which no field group holds.
 */
export function fieldGroupFieldHolding(
  byId: ReadonlyMap<string, OutlineNode>,
  rowId: string
): OutlineNode["field"] | undefined {
  const row = byId.get(rowId);
  if (row?.readOnly?.kind !== "field-group") return undefined;
  const own = ownRow({ nodes: [], byId }, row);
  return own && own !== row ? own.field : undefined;
}

/** The container a row's siblings belong to, as a place names it. */
function containerOf(
  rows: OutlineRows,
  node: OutlineNode
): Pick<FieldInsertPosition, "parentFieldId"> {
  const parent = node.parentId ? rows.byId.get(node.parentId) : undefined;
  const own = parent ? ownRow(rows, parent) : null;
  return own ? { parentFieldId: own.id } : {};
}

/** The first row after `node` among its siblings the Builder holds, as an anchor. */
function heldAfter(
  rows: OutlineRows,
  node: OutlineNode
): Pick<FieldInsertPosition, "beforeFieldId"> {
  const siblings = siblingsOf(rows, node);
  const next = siblings.slice(siblings.indexOf(node) + 1).find(held);
  return next ? { beforeFieldId: next.id } : {};
}

/** Right before `node`, in its container. */
function before(rows: OutlineRows, node: OutlineNode): FieldInsertPosition {
  return { ...containerOf(rows, node), beforeFieldId: node.id };
}

/** Right after `node`, in its container. */
function after(rows: OutlineRows, node: OutlineNode): FieldInsertPosition {
  return { ...containerOf(rows, node), ...heldAfter(rows, node) };
}

/** At the end of the container `node` is, or stands for. */
function inside(rows: OutlineRows, node: OutlineNode): FieldInsertPosition {
  const own = ownRow(rows, node);
  return own ? { parentFieldId: own.id } : {};
}

/** A row's parent, when it has one. */
function parentOf(rows: OutlineRows, node: OutlineNode): OutlineNode | null {
  return (node.parentId ? rows.byId.get(node.parentId) : undefined) ?? null;
}

/**
 * Where a step takes a field, or null where there is nowhere to go: up or
 * down past the row beside it, out of its container at either end (up goes
 * before the container, down after it), out to just after its container, or
 * into the end of the container right above it.
 *
 * A step past a pending delete, or into one, is null: nothing moves into or
 * out of a deleted row's place, which the Builder no longer holds.
 */
export function stepTarget(
  rows: OutlineRows,
  fieldId: string,
  step: MoveStep
): FieldInsertPosition | null {
  const node = rows.byId.get(fieldId);
  if (!node) return null;
  const siblings = siblingsOf(rows, node);
  const at = siblings.indexOf(node);
  const neighbour = siblings[at + (step === "up" || step === "in" ? -1 : 1)];
  if (neighbour && isPendingDelete(neighbour)) return null;
  return STEPS[step](rows, neighbour, parentOf(rows, node));
}

/** Where each step goes, from the row beside the field that way and its container's row. */
const STEPS: Record<
  MoveStep,
  (
    rows: OutlineRows,
    neighbour: OutlineNode | undefined,
    parent: OutlineNode | null
  ) => FieldInsertPosition | null
> = {
  up: (rows, neighbour, parent) => {
    const past = neighbour ?? parent;
    return past ? before(rows, past) : null;
  },
  down: (rows, neighbour, parent) => {
    const past = neighbour ?? parent;
    return past ? after(rows, past) : null;
  },
  out: (rows, _, parent) => (parent ? after(rows, parent) : null),
  in: (rows, neighbour) =>
    neighbour?.container ? inside(rows, neighbour) : null,
};

/**
 * Where a drop puts the dragged field: on a row, before it when dragged up
 * and after it when dragged down, in that row's container; with the pointer
 * moved a level or more to the right of a container's row, into its end; a
 * level or more to the left, out to just after the container the row is in.
 *
 * `levels` is the sideways offset in levels of indent, negative to the left.
 * Null when the drop changes nothing (on itself, with no sideways offset) or
 * lands on a pending delete, whose place the Builder no longer holds.
 */
export function dropTarget(
  rows: OutlineRows,
  activeId: string,
  overId: string,
  levels: number
): FieldInsertPosition | null {
  const active = rows.byId.get(activeId);
  const over = rows.byId.get(overId);
  if (!active || !over || isPendingDelete(over)) return null;
  if (levels >= 1 && over !== active && over.container) {
    return inside(rows, over);
  }
  const parent = parentOf(rows, over);
  if (levels <= -1 && parent) return after(rows, parent);
  if (over === active) {
    return levels >= 1 ? stepTarget(rows, activeId, "in") : null;
  }
  return draggedDown(rows, active, over)
    ? after(rows, over)
    : before(rows, over);
}

/** Whether `active` comes before `over` in the outline, top to bottom. */
function draggedDown(
  rows: OutlineRows,
  active: OutlineNode,
  over: OutlineNode
): boolean {
  let seenActive = false;
  const walk = (list: readonly OutlineNode[]): boolean | null => {
    for (const node of list) {
      if (node === over) return seenActive;
      if (node === active) seenActive = true;
      const below = walk(node.children);
      if (below !== null) return below;
    }
    return null;
  };
  return walk(rows.nodes) ?? false;
}
