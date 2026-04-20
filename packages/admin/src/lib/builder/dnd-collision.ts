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
