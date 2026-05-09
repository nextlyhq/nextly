import {
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from "@dnd-kit/core";

/**
 * Custom collision detection that prioritizes nested drop zones (blocks, arrays, groups).
 * When dragging, if the pointer is within a nested drop zone, that zone takes priority.
 * If hovering over a specific field item, prioritize it for sorting.
 */
export const nestedFieldPriorityCollision: CollisionDetection = args => {
  const pointerCollisions = pointerWithin(args);

  // If over a specific field item, prioritize it for sorting
  const overField = pointerCollisions.find(c =>
    String(c.id).startsWith("field_")
  );
  if (overField) {
    return [overField];
  }

  // Check for nested drop zones (block, array, group)
  const nestedDropZone = pointerCollisions.find(
    collision =>
      String(collision.id).startsWith("block-drop-") ||
      String(collision.id).startsWith("array-drop-") ||
      String(collision.id).startsWith("group-drop-")
  );
  if (nestedDropZone) {
    return [nestedDropZone];
  }

  // Fall back to rectIntersection
  const rectCollisions = rectIntersection(args);

  const nestedInRect = rectCollisions.find(
    collision =>
      String(collision.id).startsWith("block-drop-") ||
      String(collision.id).startsWith("array-drop-") ||
      String(collision.id).startsWith("group-drop-")
  );
  if (nestedInRect) {
    return [nestedInRect];
  }

  return pointerCollisions.length > 0 ? pointerCollisions : rectCollisions;
};

/**
 * Why: classify the active drag's drop target so the BuilderFieldList can show
 * the correct indicator (vertical / horizontal / edge / red-rejected) and route
 * the drop to the right reducer. This is a pure router — dnd-kit's collision
 * detector picks the target id; this function says what it MEANS.
 *
 * `rowSumIfDropped` is computed by the caller as the new total width of the
 * destination row IF this drop completes (excluding the active field's old slot
 * if it was already in that row). > 100 means the drop is rejected.
 */
export type DropClassification =
  | { kind: "inside-row" }
  | { kind: "between-rows" }
  | { kind: "edge" }
  | { kind: "rejected"; reason: "doesnt-fit" };

export type ClassifyDropTargetArgs = {
  overId: string;
  overType: "field" | "row-gap" | "edge";
  activeRowId?: string;
  overRowId?: string;
  activeWidth?: number;
  rowSumIfDropped?: number;
};

export function classifyDropTarget(
  args: ClassifyDropTargetArgs
): DropClassification {
  if (args.overType === "edge") return { kind: "edge" };
  if (args.overType === "row-gap") return { kind: "between-rows" };
  if (args.rowSumIfDropped !== undefined && args.rowSumIfDropped > 100) {
    return { kind: "rejected", reason: "doesnt-fit" };
  }
  return { kind: "inside-row" };
}
