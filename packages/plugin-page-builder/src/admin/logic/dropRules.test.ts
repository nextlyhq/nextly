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

  it("accepts any block into a slot that restricts nothing", () => {
    // The catalogue's usual shape: a container declares a slot and takes
    // whatever the canvas offers. Asserted so the refusal below is read as the
    // restriction working rather than as containers being generally strict.
    expect(
      canDrop("core/grid", "default", "core/heading", defaultBlockRegistry).ok
    ).toBe(true);
  });

  it("refuses a block a slot does not list, and says why", () => {
    // The one restriction in the catalogue. Before it existed the
    // `not-allowed-in-slot` reason was unreachable in the shipped product:
    // every container declared a bare slot, so no drop could produce it and
    // nothing downstream could show an author why a release did nothing.
    const refusal = canDrop(
      "core/columns",
      "default",
      "core/heading",
      defaultBlockRegistry
    );

    expect(refusal.ok).toBe(false);
    // The REASON, not just the refusal. It is what an invalid-target state has
    // to render, and it is the field both `planDrop` call sites currently drop.
    expect(refusal.reason).toBe("not-allowed-in-slot");
  });

  it("accepts the block that slot does list", () => {
    // The positive control. Without it a slot restriction that refused
    // EVERYTHING would satisfy the case above.
    expect(
      canDrop("core/columns", "default", "core/column", defaultBlockRegistry).ok
    ).toBe(true);
  });

  it("lets a column hold what a page holds", () => {
    // A column restricting its own contents would be a second rule for authors
    // to learn, so it takes whatever the canvas offers.
    expect(
      canDrop("core/column", "default", "core/heading", defaultBlockRegistry).ok
    ).toBe(true);
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
