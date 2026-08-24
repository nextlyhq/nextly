/**
 * The node selection every reader of a stored document shares.
 *
 * The reason this is tested at all, rather than left implicit in the compiler:
 * two readers stopping in different places is invisible until it is expensive.
 * The style compiler decides which nodes get rules; the page-builder's
 * class-usage record decides which classes a page counts as referencing, and a
 * safe-delete check treats absence from that record as "not used". A selection
 * that differs between them deletes a class off a page still rendering it.
 *
 * So the properties asserted here are ORDER and BOUNDS, not the shape of the
 * result. Both readers agreeing on a list is what the module is for.
 *
 * @module select-nodes.test
 */
import { describe, expect, it } from "vitest";

import type { BlockNode } from "./document";
import { DEFAULT_LIMITS } from "./limits";
import { selectNodes } from "./select-nodes";

/** A node carrying the given id and slot children. */
function node(id: string, slots?: Record<string, BlockNode[]>): BlockNode {
  const built: BlockNode = { id, type: "core/text", version: 1, props: {} };
  if (slots) built.slots = slots;
  return built;
}

/** Limits with one field overridden, so a test names only what it varies. */
function limits(over: Partial<typeof DEFAULT_LIMITS>) {
  return { ...DEFAULT_LIMITS, ...over };
}

describe("selectNodes", () => {
  it("selects LEVEL by level, so a deep branch cannot precede a shallow one", () => {
    // The property the whole module exists for, and the one a reader cannot
    // recover afterwards. Under a depth-first selection the first root's whole
    // subtree is selected before the second root is reached, so a budget spent
    // inside that subtree never reaches the second root at all — while the page
    // still renders it.
    //
    // Asserted as the exact order rather than as membership: with no budget in
    // play every node is selected either way, so only the ORDER distinguishes
    // the two walks.
    const selection = selectNodes({
      nodes: [
        node("a", { s: [node("a1", { s: [node("a1x")] })] }),
        node("b", { s: [node("b1")] }),
      ],
    });

    expect(selection.nodes.map(entry => entry.node.id)).toEqual([
      "a",
      "b",
      "a1",
      "b1",
      "a1x",
    ]);
  });

  it("spends a budget on the shallowest nodes, not the first branch", () => {
    // What level order buys once a bound is in play. A depth-first walk with
    // this same budget returns `a`, `a1`, `a1x` and never reaches `b`.
    const selection = selectNodes(
      {
        nodes: [
          node("a", { s: [node("a1", { s: [node("a1x")] })] }),
          node("b"),
        ],
      },
      limits({ maxNodes: 2 })
    );

    expect(selection.nodes.map(entry => entry.node.id)).toEqual(["a", "b"]);
  });

  it("reports WHY it stopped, and says nothing when it did not", () => {
    // A selection that truncated silently would make every absence ambiguous,
    // and absence is exactly what a safe-delete check reads. The absent
    // `stopped` is the half that carries the meaning: it is the only signal
    // that a missing node is genuinely missing rather than merely unread.
    const whole = selectNodes({ nodes: [node("a"), node("b")] });
    expect(whole.stopped).toBeUndefined();

    const capped = selectNodes(
      { nodes: [node("a"), node("b")] },
      limits({ maxNodes: 1 })
    );
    expect(capped.stopped).toEqual({
      path: "/nodes",
      reason: "count",
      limit: 1,
    });

    const deep = selectNodes(
      { nodes: [node("a", { s: [node("a1")] })] },
      limits({ maxDepth: 1 })
    );
    expect(deep.stopped?.reason).toBe("depth");
  });

  it("spends the budget on entries READ, not on entries that were usable", () => {
    // Reading is the work being bounded, so an array made entirely of malformed
    // entries must not pass a cap without tripping it. Three junk entries and
    // one real node against a budget of three: the real node is never reached.
    const selection = selectNodes(
      { nodes: [null, 7, "x", node("real")] as unknown as BlockNode[] },
      limits({ maxNodes: 3 })
    );

    expect(selection.nodes).toEqual([]);
    expect(selection.stopped?.reason).toBe("count");
  });

  it("names each node's parent by index, and the top level as -1", () => {
    // What lets a caller inherit a decision down the tree in one forward pass.
    // Level order guarantees a parent is selected before its children, so the
    // index always resolves to an entry already seen.
    const selection = selectNodes({
      nodes: [node("a", { s: [node("a1")] }), node("b")],
    });

    expect(
      selection.nodes.map(entry => [entry.node.id, entry.parent, entry.depth])
    ).toEqual([
      ["a", -1, 1],
      ["b", -1, 1],
      ["a1", 0, 2],
    ]);
  });

  it("reads slots in sorted order, so write order cannot change the result", () => {
    // Two documents holding the same nodes must select identically, or a page
    // saved by a different editor build compiles to different bytes and counts
    // different classes.
    const forwards = selectNodes({
      nodes: [node("a", { alpha: [node("x")], beta: [node("y")] })],
    });
    const backwards = selectNodes({
      nodes: [node("a", { beta: [node("y")], alpha: [node("x")] })],
    });

    expect(forwards.nodes.map(entry => entry.node.id)).toEqual(["a", "x", "y"]);
    expect(backwards.nodes.map(entry => entry.node.id)).toEqual(
      forwards.nodes.map(entry => entry.node.id)
    );
  });

  it("answers for a document nothing validated, rather than throwing", () => {
    // It runs on stored data whether or not validation ever passed on it, and
    // one caller is a write hook where throwing fails an author's save.
    for (const nodes of [null, 5, "x", undefined, {}]) {
      expect(() =>
        selectNodes({ nodes } as unknown as { nodes?: unknown })
      ).not.toThrow();
      expect(
        selectNodes({ nodes } as unknown as { nodes?: unknown }).nodes
      ).toEqual([]);
    }
  });

  it("finishes on a forest nested deeper than the call stack allows", () => {
    // Iterative for the same reason the tree walk is: `maxDepth` is a
    // validation rule, and a document arrives whether or not validation ran.
    // With the depth bound raised past the nesting, a recursive selection would
    // exit with a RangeError instead of a list.
    let root = node("leaf");
    for (let i = 0; i < 20_000; i++) root = node(`n${i}`, { s: [root] });

    // Both bounds raised: the node budget would otherwise stop the walk at its
    // default long before the depth being tested is reached.
    const selection = selectNodes(
      { nodes: [root] },
      limits({ maxDepth: 30_000, maxNodes: 30_000 })
    );

    expect(selection.nodes).toHaveLength(20_001);
    expect(selection.stopped).toBeUndefined();
  });
});
