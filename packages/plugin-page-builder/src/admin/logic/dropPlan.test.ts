import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import "../../render/blocks"; // register core blocks

import { planDrop } from "./dropPlan";

function tree(): BlockNode {
  const a = makeNode("core/heading", { text: "A" });
  const b = makeNode("core/paragraph", { text: "B" });
  const c = makeNode("core/button", { text: "C" });
  return makeNode("core/container", {}, undefined, { default: [a, b, c] });
}

const reg = defaultBlockRegistry;

describe("planDrop", () => {
  it("plans an ADD from the library at the target index", () => {
    const root = tree();
    const action = planDrop(
      { kind: "library", blockType: "core/heading" },
      { kind: "dropzone", parentId: root.id, slot: "default", index: 1 },
      root,
      reg
    );
    expect(action).toEqual({
      type: "ADD",
      parentId: root.id,
      slot: "default",
      nodeType: "core/heading",
      index: 1,
    });
  });

  it("rejects an ADD into a non-container", () => {
    const root = tree();
    const heading = root.slots!.default![0];
    expect(
      planDrop(
        { kind: "library", blockType: "core/paragraph" },
        { kind: "dropzone", parentId: heading.id, slot: "default", index: 0 },
        root,
        reg
      )
    ).toBeNull();
  });

  it("plans a MOVE and adjusts the index for a downward same-slot move", () => {
    const root = tree();
    const a = root.slots!.default![0]; // index 0
    // drop A into gap index 3 (after C) → after removal, target becomes 2
    const action = planDrop(
      { kind: "node", nodeId: a.id },
      { kind: "dropzone", parentId: root.id, slot: "default", index: 3 },
      root,
      reg
    );
    expect(action).toEqual({
      type: "MOVE",
      id: a.id,
      parentId: root.id,
      slot: "default",
      index: 2,
    });
  });

  it("does not adjust the index for an upward same-slot move", () => {
    const root = tree();
    const c = root.slots!.default![2]; // index 2
    // drop C into gap index 0 (before A)
    const action = planDrop(
      { kind: "node", nodeId: c.id },
      { kind: "dropzone", parentId: root.id, slot: "default", index: 0 },
      root,
      reg
    );
    expect(action).toEqual({
      type: "MOVE",
      id: c.id,
      parentId: root.id,
      slot: "default",
      index: 0,
    });
  });

  it("treats a drop adjacent to the source as a no-op", () => {
    const root = tree();
    const b = root.slots!.default![1]; // index 1
    // gap index 1 (before B) and gap index 2 (after B) are both no-ops
    expect(
      planDrop(
        { kind: "node", nodeId: b.id },
        { kind: "dropzone", parentId: root.id, slot: "default", index: 1 },
        root,
        reg
      )
    ).toBeNull();
    expect(
      planDrop(
        { kind: "node", nodeId: b.id },
        { kind: "dropzone", parentId: root.id, slot: "default", index: 2 },
        root,
        reg
      )
    ).toBeNull();
  });

  it("rejects dropping a container into its own descendant", () => {
    const inner = makeNode("core/heading", { text: "x" });
    const outer = makeNode("core/container", {}, undefined, {
      default: [inner],
    });
    const root = makeNode("core/container", {}, undefined, {
      default: [outer],
    });
    // try to move `outer` into its own child container? use a nested container
    const innerC = makeNode("core/container", {}, undefined, { default: [] });
    const outer2 = makeNode("core/container", {}, undefined, {
      default: [innerC],
    });
    const root2 = makeNode("core/container", {}, undefined, {
      default: [outer2],
    });
    expect(
      planDrop(
        { kind: "node", nodeId: outer2.id },
        { kind: "dropzone", parentId: innerC.id, slot: "default", index: 0 },
        root2,
        reg
      )
    ).toBeNull();
  });
});
