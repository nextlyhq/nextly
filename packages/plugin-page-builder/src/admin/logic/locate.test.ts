import { describe, expect, it } from "vitest";

import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";

import { locateNode } from "./locate";

function tree(): BlockNode {
  const a = makeNode("core/heading", { text: "A" });
  const b = makeNode("core/paragraph", { text: "B" });
  const inner = makeNode("core/container", {}, undefined, { default: [b] });
  return makeNode("core/container", {}, undefined, { default: [a, inner] });
}

describe("locateNode", () => {
  it("locates a direct child", () => {
    const root = tree();
    const a = root.slots!.default![0];
    expect(locateNode(root, a.id)).toEqual({
      parentId: root.id,
      slot: "default",
      index: 0,
      count: 2,
    });
  });

  it("locates a nested child under its real parent", () => {
    const root = tree();
    const inner = root.slots!.default![1];
    const b = inner.slots!.default![0];
    expect(locateNode(root, b.id)).toEqual({
      parentId: inner.id,
      slot: "default",
      index: 0,
      count: 1,
    });
  });

  it("returns null for the root and for a missing id", () => {
    const root = tree();
    expect(locateNode(root, root.id)).toBeNull();
    expect(locateNode(root, "nope")).toBeNull();
  });
});
