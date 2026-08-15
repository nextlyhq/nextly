import { CollisionPriority } from "@dnd-kit/abstract";
import { describe, expect, it } from "vitest";

import { canvasPriority } from "./DropZone";

/**
 * The canvas ranks every droppable it registers on ONE scale, and that scale
 * must not overlap the collision detector's own.
 *
 * `collisionPriority` OVERRIDES what the detector decided rather than filling a
 * gap, so a droppable that never sets it still carries a priority — `High` when
 * the pointer is inside it, `Normal` otherwise. Two scales sharing numbers make
 * "which target claims the pointer" depend on how deeply the document nests,
 * and that is not a question the canvas means to ask.
 *
 * Read from `CollisionPriority` rather than written as 2 and 3: the numbers are
 * the library's to choose, and a copy here would keep passing after it changed
 * them.
 */
describe("the canvas collision scale", () => {
  const DETECTOR_ASSIGNS = [
    CollisionPriority.Lowest,
    CollisionPriority.Low,
    CollisionPriority.Normal,
    CollisionPriority.High,
    CollisionPriority.Highest,
  ];

  it("puts the shallowest canvas droppable above every detector priority", () => {
    // Depth 0 is the root's own level, so this is the whole scale's floor: if
    // it clears the detector, every deeper droppable does too.
    for (const assigned of DETECTOR_ASSIGNS) {
      expect(canvasPriority(0)).toBeGreaterThan(assigned);
    }
  });

  it("ranks a deeper droppable above a shallower one", () => {
    // What makes the innermost container win. Asserted across a span rather
    // than one pair, because a scale that inverted or saturated somewhere
    // further down would satisfy a single comparison.
    for (let depth = 0; depth < 12; depth++) {
      expect(canvasPriority(depth + 1)).toBeGreaterThan(canvasPriority(depth));
    }
  });

  it("gives one depth exactly one priority", () => {
    // Two droppables at the same depth must tie, so that geometry decides
    // between siblings. A scale that varied per call would make sibling
    // ordering depend on registration order instead.
    expect(canvasPriority(3)).toBe(canvasPriority(3));
  });
});
