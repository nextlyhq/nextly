import { describe, expect, it } from "vitest";

import { createBlockRegistry, defaultBlockRegistry } from "../../core/registry";
import type { BlockDefinition } from "../../core/types";
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
    // The one restriction in the catalogue, and so the only thing that makes
    // `not-allowed-in-slot` reachable in the shipped product at all: a
    // container declaring a bare slot cannot produce that reason from any drop,
    // and a reason nothing produces is one no surface can be shown to render.
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

describe("a child's own restriction on where it may sit", () => {
  it("refuses a block whose parent list does not name this container", () => {
    // The half `allowedBlocks` cannot express: a container's slot accepting everything is not the
    // same as every block being at home in it.
    const refusal = canDrop(
      "core/column",
      "default",
      "core/column",
      defaultBlockRegistry
    );
    expect(refusal.ok).toBe(false);
    expect(refusal.reason).toBe("wrong-parent");
  });

  it("accepts it in the container its parent list names", () => {
    expect(
      canDrop("core/columns", "default", "core/column", defaultBlockRegistry).ok
    ).toBe(true);
  });

  it("leaves a block that restricts nothing placeable in that same container", () => {
    // The positive control. `core/column`'s slot must still take ordinary blocks, or the refusal
    // above would be a statement about the container rather than about the child.
    expect(
      canDrop("core/column", "default", "core/heading", defaultBlockRegistry).ok
    ).toBe(true);
  });
});

describe("a PLUGIN block's parent restriction", () => {
  /**
   * The capability has to be reachable from a `BlockDefinition`, not only from this package's
   * private structure table. A core block states it on its structure and it arrives on the
   * definition by the spread; a plugin block has only the definition, so if the rule were read
   * from structure alone the field would be advertised and inert.
   */
  const own = createBlockRegistry();
  const def = (type: string, extra: Partial<BlockDefinition> = {}) => ({
    type,
    version: 1,
    label: type,
    icon: "Square",
    category: "layout" as const,
    defaultProps: {},
    render: () => null,
    ...extra,
  });
  own.register(
    def("ext/board", { isContainer: true, slots: [{ name: "default" }] })
  );
  own.register(
    def("ext/lane", {
      isContainer: true,
      slots: [{ name: "default" }],
      parent: ["ext/board"],
    })
  );
  own.register(def("ext/note"));

  it("refuses the plugin block outside the parent its DEFINITION names", () => {
    const refusal = canDrop("ext/lane", "default", "ext/lane", own);
    expect(refusal.ok).toBe(false);
    expect(refusal.reason).toBe("wrong-parent");
  });

  it("accepts it inside that parent", () => {
    expect(canDrop("ext/board", "default", "ext/lane", own).ok).toBe(true);
  });

  it("leaves a plugin block that restricts nothing placeable anywhere", () => {
    // The control. A rule that refused every plugin block would pass the first case alone.
    expect(canDrop("ext/lane", "default", "ext/note", own).ok).toBe(true);
  });
});
