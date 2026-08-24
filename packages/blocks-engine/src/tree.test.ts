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

  it("finishes on a forest nested deeper than the call stack allows", () => {
    // `MAX_DEPTH` is a validation rule, and this walk runs on documents whether
    // or not validation ever passed on them. A recursive walk exited a chain of
    // this size with `RangeError: Maximum call stack size exceeded` — no cycle
    // involved, just depth — and every caller of the shared walk failed with it.
    //
    // Sized well past the measured limit rather than just over it, so the test
    // does not go quiet if a future engine gives the walk a larger stack.
    const DEEP = 50_000;
    let root: BlockNode = { id: "leaf", type: "t", version: 1, props: {} };
    for (let i = 0; i < DEEP; i++) {
      root = {
        id: `n${i}`,
        type: "t",
        version: 1,
        props: {},
        slots: { main: [root] },
      };
    }

    let visited = 0;
    expect(() => walkNodes([root], () => visited++)).not.toThrow();
    expect(visited).toBe(DEEP + 1);
  });

  it("finishes when a slot holds one of its own ancestors", () => {
    // A cycle reachable through `slots` is the shape the walk actually
    // descends. Recursion overflowed on it; an iterative walk without a visited
    // set would spin forever instead, which is why terminating is asserted by a
    // VISIT COUNT rather than by the absence of a throw.
    const cyclic: BlockNode = {
      id: "a",
      type: "t",
      version: 1,
      props: {},
      slots: { main: [] },
    };
    cyclic.slots!.main.push(cyclic);

    const visited: string[] = [];
    walkNodes([cyclic], n => visited.push(n.id));

    expect(visited).toEqual(["a"]);
  });

  it("does not hand an ARRAY to the callback as though it were a node", () => {
    // `typeof [] === "object"`, so a guard written as a type test alone lets an
    // array through. Nothing then throws, which is the difficulty: every caller
    // reads its fields as `undefined` and carries on. The id-uniqueness check
    // behind this compares `undefined` against `undefined` and reports a
    // collision between two malformed entries, or none at all.
    const visited: unknown[] = [];
    walkNodes(
      [
        [{ id: "buried" }],
        { id: "real", type: "t", version: 1, props: {} },
      ] as unknown as BlockNode[],
      n => visited.push(n)
    );

    expect(visited.some(n => Array.isArray(n))).toBe(false);
    expect(visited.map(n => (n as BlockNode).id)).toEqual(["real"]);
  });

  it("still visits a repeated ID that is a DISTINCT object", () => {
    // The control for the cycle guard, and the boundary of what it costs. It
    // skips a node OBJECT already visited, not an id already seen — two sibling
    // nodes that happen to share an id are different nodes and both are walked.
    // A guard keyed on id would silently drop the second, which is how a
    // duplicate-id document would stop being measurable at all.
    const twin = (): BlockNode => ({
      id: "same",
      type: "t",
      version: 1,
      props: {},
    });

    const visited: string[] = [];
    walkNodes([twin(), twin()], n => visited.push(n.id));

    expect(visited).toEqual(["same", "same"]);
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

  it("rejects re-inserting a node whose id already lives in the forest", () => {
    const { nodes, footer, heading } = fixture();
    // Same node object re-inserted, and a fresh node carrying an existing id:
    // both collide and must no-op rather than corrupt id-addressing.
    expect(insertNode(nodes, footer, { index: 0 })).toBe(nodes);
    const clash = { ...makeNode("core/text", 1), id: heading.id };
    expect(
      insertNode(nodes, clash, {
        parentId: footer.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });

  it("rejects inserting a node into itself without overflowing", () => {
    const { nodes, section } = fixture();
    expect(
      insertNode(nodes, section, {
        parentId: section.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });

  it("rejects a fresh subtree that carries an internal duplicate id", () => {
    const { nodes } = fixture();
    // A hand-built subtree whose two children share an id: it does not collide
    // with the forest, but inserting it would still break id uniqueness.
    const dupChild = makeNode("core/text", 1);
    const malformed = makeNode(
      "core/section",
      1,
      {},
      {
        children: [dupChild, { ...makeNode("core/text", 1), id: dupChild.id }],
      }
    );
    expect(insertNode(nodes, malformed, { index: 0 })).toBe(nodes);
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

  it("returns the original forest reference when the id is absent", () => {
    const { nodes } = fixture();
    expect(removeNode(nodes, "missing")).toBe(nodes);
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

  it("never loses a node when a slot position omits its slot", () => {
    const { nodes, footer, section } = fixture();
    // parentId set without a slot: must no-op, not remove-then-fail-to-insert.
    const next = moveNode(nodes, footer.id, { parentId: section.id, index: 0 });
    expect(next).toBe(nodes);
    expect(findNode(next, footer.id)).toBeDefined();
    expect(countNodes(next)).toBe(countNodes(nodes));
  });

  it("leaves an already-malformed subtree in place rather than losing it on move", () => {
    // A document whose moving subtree carries an internal duplicate id: the
    // re-insert would refuse, so the move must be atomic and change nothing.
    const dup = makeNode("core/text", 1);
    const bad = makeNode(
      "core/section",
      1,
      {},
      {
        children: [dup, { ...makeNode("core/text", 1), id: dup.id }],
      }
    );
    const host = makeNode("core/section", 1, {}, { children: [] });
    const nodes = [bad, host];
    const next = moveNode(nodes, bad.id, {
      parentId: host.id,
      slot: "children",
      index: 0,
    });
    expect(next).toBe(nodes);
    expect(findNode(next, bad.id)).toBeDefined();
    expect(countNodes(next)).toBe(countNodes(nodes));
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

  it("drops the DOM id (cssId) when re-iding so copies never collide on it", () => {
    const original = {
      ...makeNode("core/section", 1, {}, { children: [] }),
      cssId: "hero",
    };
    const copy = reidSubtree(original);
    expect(copy.cssId).toBeUndefined();
    // A nested cssId is dropped too.
    const withNested = {
      ...makeNode(
        "core/section",
        1,
        {},
        {
          children: [{ ...makeNode("core/text", 1), cssId: "cta" }],
        }
      ),
      cssId: "wrap",
    };
    const nestedCopy = reidSubtree(withNested);
    expect(nestedCopy.cssId).toBeUndefined();
    expect(nestedCopy.slots?.children?.[0]?.cssId).toBeUndefined();
  });

  it("strips an id from custom attributes (case-insensitively) when re-iding", () => {
    const original = {
      ...makeNode("core/section", 1),
      attributes: { id: "hero", "data-role": "banner" },
    };
    const copy = reidSubtree(original);
    expect(copy.attributes).toEqual({ "data-role": "banner" });

    // A capitalized "ID" is the same DOM-id vector and must also go; when it is
    // the only attribute, the now-empty attributes object is dropped entirely.
    const upper = { ...makeNode("core/text", 1), attributes: { ID: "x" } };
    expect(reidSubtree(upper).attributes).toBeUndefined();
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
