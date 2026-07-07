import { describe, it, expect } from "vitest";

import type { BlockNode } from "./types";
import {
  newId,
  makeNode,
  findNode,
  insertNode,
  removeNode,
  moveNode,
  duplicateNode,
  updateNode,
  walk,
} from "./tree";

const container = (id: string, children: BlockNode[] = []): BlockNode => ({
  id,
  type: "core/container",
  props: {},
  slots: { default: children },
});

describe("newId", () => {
  it("returns unique string ids", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe("string");
  });
});

describe("tree ops (slot-aware, immutable)", () => {
  it("makeNode sets a fresh id + type + props", () => {
    const n = makeNode("core/heading", { text: "hi" });
    expect(n.type).toBe("core/heading");
    expect(n.id).toMatch(/.+/);
    expect(n.props.text).toBe("hi");
  });

  it("insertNode appends into a named slot at index", () => {
    const root = container("root");
    const child = makeNode("core/paragraph");
    const next = insertNode(root, "root", "default", child, 0);
    expect(next.slots?.default?.[0]?.id).toBe(child.id);
    expect(root.slots?.default?.length).toBe(0); // original unchanged
  });

  it("findNode locates a nested node", () => {
    const child = makeNode("core/heading");
    const root = container("root", [container("c1", [child])]);
    expect(findNode(root, child.id)?.id).toBe(child.id);
    expect(findNode(root, "nope")).toBeUndefined();
  });

  it("removeNode deletes a nested node immutably", () => {
    const child = makeNode("core/heading");
    const root = container("root", [container("c1", [child])]);
    const next = removeNode(root, child.id);
    expect(findNode(next, child.id)).toBeUndefined();
    expect(findNode(root, child.id)).toBeDefined();
  });

  it("moveNode relocates across slots", () => {
    const child = makeNode("core/heading");
    const root = container("root", [container("a", [child]), container("b")]);
    const next = moveNode(root, child.id, "b", "default", 0);
    expect(findNode(next, "a")?.slots?.default?.length).toBe(0);
    expect(findNode(next, "b")?.slots?.default?.[0]?.id).toBe(child.id);
  });

  it("moveNode refuses to move a node into itself or a descendant", () => {
    const inner = container("inner");
    const outer = container("outer", [inner]);
    const root = container("root", [outer]);
    expect(moveNode(root, "outer", "inner", "default", 0)).toBe(root); // would create a cycle
    expect(moveNode(root, "outer", "outer", "default", 0)).toBe(root); // into self
  });

  it("duplicateNode clones a subtree with fresh ids next to the original", () => {
    const child = makeNode("core/heading");
    const root = container("root", [child]);
    const next = duplicateNode(root, child.id);
    const kids = findNode(next, "root")!.slots!.default!;
    expect(kids.length).toBe(2);
    expect(kids[1].id).not.toBe(kids[0].id);
    expect(kids[1].type).toBe("core/heading");
  });

  it("updateNode shallow-merges a patch", () => {
    const n = makeNode("core/heading", { text: "a" });
    const root = container("root", [n]);
    const next = updateNode(root, n.id, { props: { text: "b" } });
    expect(findNode(next, n.id)?.props.text).toBe("b");
  });

  it("walk visits every node once (node + all slots)", () => {
    const root = container("root", [
      makeNode("core/paragraph"),
      container("c", [makeNode("core/image")]),
    ]);
    const seen: string[] = [];
    walk(root, n => seen.push(n.type));
    expect(seen.sort()).toEqual(
      [
        "core/container",
        "core/container",
        "core/image",
        "core/paragraph",
      ].sort()
    );
  });
});
