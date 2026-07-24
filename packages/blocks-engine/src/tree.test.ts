import { describe, expect, it } from "vitest";

import type { BlockNode } from "./document";
import { countNodes, treeDepth } from "./limits";
import {
  duplicateNode,
  findNode,
  insertNode,
  locateNode,
  makeNode,
  moveNode,
  removeNode,
  reidSubtree,
  updateNode,
  walkNodes,
} from "./tree";

/** A small fixed forest: two sections, the first containing two children. */
function fixture(): {
  nodes: BlockNode[];
  section: BlockNode;
  heading: BlockNode;
  text: BlockNode;
  footer: BlockNode;
} {
  const heading = makeNode("core/heading", 1, { text: "Hello" });
  const text = makeNode("core/text", 1, { text: "World" });
  const section = makeNode(
    "core/section",
    1,
    {},
    { children: [heading, text] }
  );
  const footer = makeNode("core/section", 1, {}, { children: [] });
  return { nodes: [section, footer], section, heading, text, footer };
}

describe("walkNodes / findNode / locateNode", () => {
  it("walks depth-first with the correct parent", () => {
    const { nodes, section, heading, text, footer } = fixture();
    const visited: Array<[string, string | undefined]> = [];
    walkNodes(nodes, (n, parent) => visited.push([n.id, parent?.id]));
    expect(visited).toEqual([
      [section.id, undefined],
      [heading.id, section.id],
      [text.id, section.id],
      [footer.id, undefined],
    ]);
  });

  it("finds nested nodes and returns undefined for unknown ids", () => {
    const { nodes, heading } = fixture();
    expect(findNode(nodes, heading.id)?.props).toEqual({ text: "Hello" });
    expect(findNode(nodes, "missing")).toBeUndefined();
  });

  it("locates top-level and nested nodes", () => {
    const { nodes, section, text, footer } = fixture();
    expect(locateNode(nodes, footer.id)).toEqual({ index: 1 });
    const nested = locateNode(nodes, text.id);
    expect(nested?.parent?.id).toBe(section.id);
    expect(nested?.slot).toBe("children");
    expect(nested?.index).toBe(1);
    expect(locateNode(nodes, "missing")).toBeUndefined();
  });
});

describe("insertNode", () => {
  it("inserts at the top level with a clamped index", () => {
    const { nodes } = fixture();
    const extra = makeNode("core/section", 1);
    const next = insertNode(nodes, extra, { index: 99 });
    expect(next.map(n => n.id)).toEqual([...nodes.map(n => n.id), extra.id]);
    // Immutability: the original forest is untouched.
    expect(nodes).toHaveLength(2);
  });

  it("inserts into a parent slot", () => {
    const { nodes, section, heading } = fixture();
    const extra = makeNode("core/text", 1);
    const next = insertNode(nodes, extra, {
      parentId: section.id,
      slot: "children",
      index: 1,
    });
    const children = findNode(next, section.id)?.slots?.children ?? [];
    expect(children.map(n => n.id)[1]).toBe(extra.id);
    expect(children.map(n => n.id)[0]).toBe(heading.id);
  });

  it("creates the slot when inserting into an empty one", () => {
    const { nodes, footer } = fixture();
    const extra = makeNode("core/text", 1);
    const next = insertNode(nodes, extra, {
      parentId: footer.id,
      slot: "children",
      index: 0,
    });
    expect(findNode(next, footer.id)?.slots?.children).toHaveLength(1);
  });

  it("returns the forest unchanged for an unknown parent or missing slot", () => {
    const { nodes } = fixture();
    const extra = makeNode("core/text", 1);
    expect(
      insertNode(nodes, extra, {
        parentId: "missing",
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
    expect(insertNode(nodes, extra, { parentId: nodes[0]!.id, index: 0 })).toBe(
      nodes
    );
  });
});

describe("removeNode", () => {
  it("removes a nested node", () => {
    const { nodes, section, heading } = fixture();
    const next = removeNode(nodes, heading.id);
    expect(findNode(next, heading.id)).toBeUndefined();
    expect(findNode(next, section.id)?.slots?.children).toHaveLength(1);
  });

  it("removes a top-level node with its whole subtree", () => {
    const { nodes, section, heading } = fixture();
    const next = removeNode(nodes, section.id);
    expect(next).toHaveLength(1);
    expect(findNode(next, heading.id)).toBeUndefined();
  });
});

describe("moveNode", () => {
  it("moves a nested node to the top level", () => {
    const { nodes, heading } = fixture();
    const next = moveNode(nodes, heading.id, { index: 0 });
    expect(next[0]!.id).toBe(heading.id);
    expect(countNodes(next)).toBe(countNodes(nodes));
  });

  it("moves a top-level node into a slot", () => {
    const { nodes, footer, section } = fixture();
    const next = moveNode(nodes, footer.id, {
      parentId: section.id,
      slot: "children",
      index: 0,
    });
    expect(next).toHaveLength(1);
    expect(findNode(next, section.id)?.slots?.children?.[0]?.id).toBe(
      footer.id
    );
  });

  it("refuses cycles: a node cannot move into its own subtree", () => {
    const { nodes, section, heading } = fixture();
    expect(
      moveNode(nodes, section.id, {
        parentId: heading.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
    expect(
      moveNode(nodes, section.id, {
        parentId: section.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });

  it("returns the forest unchanged for unknown ids", () => {
    const { nodes } = fixture();
    expect(moveNode(nodes, "missing", { index: 0 })).toBe(nodes);
    expect(
      moveNode(nodes, nodes[0]!.id, {
        parentId: "missing",
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });
});

describe("reidSubtree / duplicateNode", () => {
  it("re-ids every node in the copied subtree and detaches it from the source", () => {
    const { section, heading } = fixture();
    const copy = reidSubtree(section);
    expect(copy.id).not.toBe(section.id);
    expect(copy.slots?.children?.[0]?.id).not.toBe(heading.id);
    expect(copy.slots?.children?.[0]?.props).toEqual(heading.props);
    // structuredClone: mutating the copy's props must not touch the source.
    (copy.slots!.children![0]!.props as Record<string, unknown>).text =
      "changed";
    expect(heading.props.text).toBe("Hello");
  });

  it("duplicates a node immediately after the original", () => {
    const { nodes, section, heading } = fixture();
    const next = duplicateNode(nodes, heading.id);
    const children = findNode(next, section.id)?.slots?.children ?? [];
    expect(children).toHaveLength(3);
    expect(children[0]!.id).toBe(heading.id);
    expect(children[1]!.id).not.toBe(heading.id);
    expect(children[1]!.props).toEqual(heading.props);
  });

  it("duplicates a top-level node in place", () => {
    const { nodes, section } = fixture();
    const next = duplicateNode(nodes, section.id);
    expect(next).toHaveLength(3);
    expect(next[1]!.type).toBe("core/section");
    expect(next[1]!.id).not.toBe(section.id);
  });
});

describe("updateNode", () => {
  it("patches a node's fields immutably", () => {
    const { nodes, heading } = fixture();
    const next = updateNode(nodes, heading.id, {
      props: { text: "Patched" },
      name: "Intro heading",
    });
    expect(findNode(next, heading.id)?.props).toEqual({ text: "Patched" });
    expect(findNode(next, heading.id)?.name).toBe("Intro heading");
    expect(findNode(nodes, heading.id)?.props).toEqual({ text: "Hello" });
  });

  it("returns the forest unchanged for unknown ids", () => {
    const { nodes } = fixture();
    expect(updateNode(nodes, "missing", { name: "x" })).toBe(nodes);
  });
});

describe("id uniqueness by construction", () => {
  it("makeNode mints a unique id every call", () => {
    const ids = new Set(
      Array.from({ length: 1000 }, () => makeNode("core/text", 1).id)
    );
    expect(ids.size).toBe(1000);
  });

  it("reidSubtree re-ids every node so a re-inserted copy cannot collide", () => {
    const { nodes, section } = fixture();
    const copy = reidSubtree(section);
    const copyIds = new Set<string>();
    walkNodes([copy], n => copyIds.add(n.id));
    const originalIds = new Set<string>();
    walkNodes(nodes, n => originalIds.add(n.id));
    // No id in the copy overlaps the original forest.
    for (const id of copyIds) expect(originalIds.has(id)).toBe(false);
  });
});

describe("counting helpers", () => {
  it("counts nodes and measures depth", () => {
    const { nodes } = fixture();
    expect(countNodes(nodes)).toBe(4);
    expect(treeDepth(nodes)).toBe(2);
    expect(countNodes([])).toBe(0);
    expect(treeDepth([])).toBe(0);
  });
});
