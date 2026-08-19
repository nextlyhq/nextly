/**
 * Moving a selection that holds more than one block.
 *
 * Nearly every assertion here APPLIES the planned ops and reads the resulting
 * document, rather than inspecting the ops themselves. A plan that looks right
 * and lands wrong is the whole failure mode: `move` is remove-then-reinsert, so
 * an index is interpreted against a list the earlier ops have already changed,
 * and an op array can be perfectly shaped while the order it applies in puts
 * the blocks somewhere nobody asked for.
 *
 * @module selection-move.test
 */
import { describe, expect, it } from "vitest";

import { type BlockDocument, type BlockNode } from "@nextlyhq/blocks-engine";

import { applyOp } from "./ops";
import { isRefusal, selectionMove } from "./selection-ops";

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function leaf(id: string): BlockNode {
  return { id, type: "acme/text", version: 1, props: {} } as BlockNode;
}

function box(id: string, children: BlockNode[]): BlockNode {
  return {
    id,
    type: "acme/box",
    version: 1,
    props: {},
    slots: { children },
  } as BlockNode;
}

/** The document a plan produces, by applying every op in the order given. */
function afterMoving(
  document: BlockDocument,
  ids: string[],
  direction: "up" | "down"
): BlockDocument {
  const plan = selectionMove(document, ids, direction);
  if (plan === null || isRefusal(plan)) {
    throw new Error("expected a plan, got a refusal");
  }
  let current = document;
  for (const op of plan.ops) current = applyOp(current, op).document;
  return current;
}

/** Top-level ids, in order, so an assertion reads like the canvas. */
function order(document: BlockDocument): string[] {
  return document.nodes.map(node => node.id);
}

/** The ids inside a container's `children` slot, in order. */
function childrenOf(document: BlockDocument, id: string): string[] {
  const parent = document.nodes.find(node => node.id === id);
  return (parent?.slots?.children ?? []).map(child => child.id);
}

describe("selectionMove", () => {
  it("moves a contiguous run up, keeping the blocks in their own order", () => {
    const document = documentOf([leaf("a"), leaf("b"), leaf("c"), leaf("d")]);

    expect(order(afterMoving(document, ["b", "c"], "up"))).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("moves a contiguous run down", () => {
    const document = documentOf([leaf("a"), leaf("b"), leaf("c"), leaf("d")]);

    expect(order(afterMoving(document, ["b", "c"], "down"))).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("moves a NON-contiguous selection, each block one step", () => {
    // THE ordering case. Both selected blocks step one place, and the gap
    // between them is preserved — which is what makes the move reversible.
    const document = documentOf([leaf("a"), leaf("b"), leaf("c"), leaf("d")]);

    expect(order(afterMoving(document, ["b", "d"], "up"))).toEqual([
      "b",
      "a",
      "d",
      "c",
    ]);
  });

  it("is undone by the opposite direction, which is why an edge refuses", () => {
    // The inverse is the property the whole-group refusal exists to protect,
    // so it is asserted rather than argued.
    const document = documentOf([leaf("a"), leaf("b"), leaf("c"), leaf("d")]);
    const moved = afterMoving(document, ["b", "d"], "up");

    expect(order(afterMoving(moved, ["b", "d"], "down"))).toEqual(
      order(document)
    );
  });

  it("accepts the order the plan gives, not merely the ops it names", () => {
    // A guard on the guard: applying the SAME ops in the reverse order must
    // produce something different, or these tests would pass on a planner that
    // ignored ordering entirely.
    const document = documentOf([leaf("a"), leaf("b"), leaf("c"), leaf("d")]);
    const plan = selectionMove(document, ["b", "c"], "up");
    if (plan === null || isRefusal(plan)) throw new Error("expected a plan");

    let current = document;
    for (const op of [...plan.ops].reverse()) {
      current = applyOp(current, op).document;
    }

    expect(order(current)).not.toEqual(["b", "c", "a", "d"]);
  });

  it("refuses the whole group when one block is at the edge", () => {
    // Silent rather than phrased: a set that cannot go further has said so by
    // not going, exactly as one block at the end of a list does.
    const document = documentOf([leaf("a"), leaf("b"), leaf("c")]);

    expect(selectionMove(document, ["a", "c"], "up")).toBeNull();
  });

  it("refuses a selection spread across two containers, with a reason", () => {
    // Phrased, because nothing on the page shows that the selection straddles
    // a boundary — unlike an edge, which the author can see.
    const document = documentOf([
      box("outer", [leaf("inside")]),
      leaf("beside"),
    ]);

    const plan = selectionMove(document, ["inside", "beside"], "down");

    expect(isRefusal(plan)).toBe(true);
    expect(isRefusal(plan) ? plan.reason : "").toContain(
      "different containers"
    );
  });

  it("moves siblings INSIDE a slot, not only at the top level", () => {
    const document = documentOf([
      box("outer", [leaf("one"), leaf("two"), leaf("three")]),
    ]);

    const moved = afterMoving(document, ["two", "three"], "up");

    expect(childrenOf(moved, "outer")).toEqual(["two", "three", "one"]);
  });

  it("refuses when a selected block is locked, naming it", () => {
    const locked = { ...leaf("b"), locked: true } as BlockNode;
    const document = documentOf([leaf("a"), locked, leaf("c")]);

    const plan = selectionMove(document, ["b", "c"], "up");

    expect(isRefusal(plan)).toBe(true);
    expect(isRefusal(plan) ? plan.reason : "").toContain("locked");
  });

  it("collapses a container and its own child to the container", () => {
    // The outermost rule, applied before anything is planned: selecting a box
    // and something inside it is a selection of the box, so this is an
    // ordinary single-block move rather than a split-container refusal.
    const document = documentOf([
      leaf("first"),
      box("outer", [leaf("inside")]),
    ]);

    const moved = afterMoving(document, ["outer", "inside"], "up");

    expect(order(moved)).toEqual(["outer", "first"]);
    expect(childrenOf(moved, "outer")).toEqual(["inside"]);
  });

  it("counts the blocks and names them for an announcement", () => {
    const document = documentOf([leaf("a"), leaf("b"), leaf("c")]);

    const plan = selectionMove(document, ["b", "c"], "up");
    if (plan === null || isRefusal(plan)) throw new Error("expected a plan");

    expect(plan.count).toBe(2);
    expect(plan.subject).toBe("2 blocks");
  });

  it("answers null for a selection the document no longer holds", () => {
    const document = documentOf([leaf("a"), leaf("b")]);

    expect(selectionMove(document, ["gone", "missing"], "up")).toBeNull();
  });
});
