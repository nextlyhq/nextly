import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import "../../render/blocks"; // side-effect: registers the 7 core blocks

import { canDrop, insertionIndex } from "./dropRules";

describe("canDrop", () => {
  it("rejects a child into a non-container block", () => {
    expect(
      canDrop("core/heading", "default", "core/button", defaultBlockRegistry).ok
    ).toBe(false);
  });

  it("allows any block into an unconstrained container slot", () => {
    expect(
      canDrop("core/container", "default", "core/button", defaultBlockRegistry)
        .ok
    ).toBe(true);
  });

  it("rejects an unknown parent", () => {
    expect(
      canDrop("acme/nope", "default", "core/button", defaultBlockRegistry).ok
    ).toBe(false);
  });

  it("rejects an unknown slot on a container", () => {
    expect(
      canDrop("core/container", "sidebar", "core/button", defaultBlockRegistry)
        .ok
    ).toBe(false);
  });

  it("returns a boolean for the grid slot (allowedBlocks decided in Task 7)", () => {
    const r = canDrop(
      "core/grid",
      "default",
      "core/heading",
      defaultBlockRegistry
    );
    expect(typeof r.ok).toBe("boolean");
  });
});

describe("insertionIndex", () => {
  it("returns 0 for an empty list", () => {
    expect(insertionIndex([], 100)).toBe(0);
  });

  it("inserts before the first item whose vertical midpoint is below the pointer", () => {
    const rects = [
      { top: 0, height: 40 }, // mid 20
      { top: 40, height: 40 }, // mid 60
      { top: 80, height: 40 }, // mid 100
    ];
    expect(insertionIndex(rects, 10)).toBe(0);
    expect(insertionIndex(rects, 50)).toBe(1);
    expect(insertionIndex(rects, 90)).toBe(2);
    expect(insertionIndex(rects, 200)).toBe(3);
  });
});
