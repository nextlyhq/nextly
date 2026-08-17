import { moveNode, type BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  keyboardMovePosition,
  type MoveDirection,
  type MoveEffect,
} from "./keyboard-move";

/** A leaf block. `version` and `props` are required by the node shape. */
function leaf(id: string): BlockNode {
  return { id, type: "core/paragraph", version: 1, props: {} };
}

/** A container holding `children` in its default slot. */
function box(id: string, children: BlockNode[]): BlockNode {
  return {
    id,
    type: "core/group",
    version: 1,
    props: {},
    slots: { default: children },
  };
}

/**
 * Every id in the forest, with a container's children in parentheses, so a move
 * that changes NESTING is visible and not only a reordering.
 */
function shape(nodes: BlockNode[]): string {
  return nodes
    .map(node => {
      const children = node.slots?.default;
      if (children === undefined) return node.id;
      return `${node.id}(${children.map(c => c.id).join(" ")})`;
    })
    .join(" ");
}

/**
 * Asks for a move and APPLIES it through the engine, returning the resulting
 * shape.
 *
 * The application is the point. Asserting the returned index would compare this
 * module's arithmetic against the same arithmetic restated in the test, which
 * agrees with itself whether or not it agrees with the store — and the store
 * removes before it inserts, which is exactly where an index is easy to get
 * wrong. Moving the node for real and reading the tree back cannot pass on an
 * off-by-one.
 */
function afterMove(
  nodes: BlockNode[],
  id: string,
  direction: MoveDirection
): string {
  const move = keyboardMovePosition(nodes, id, direction);
  if (move === null) return shape(nodes);
  return shape(moveNode(nodes, id, move.to));
}

describe("up and down reorder among siblings", () => {
  it("swaps with the next sibling on the way down", () => {
    expect(afterMove([leaf("a"), leaf("b"), leaf("c")], "a", "down")).toBe(
      "b a c"
    );
  });

  it("swaps with the previous sibling on the way up", () => {
    expect(afterMove([leaf("a"), leaf("b"), leaf("c")], "c", "up")).toBe(
      "a c b"
    );
  });

  it("moves ONE place, not two, on the way down", () => {
    // The direction-specific failure the store's remove-then-insert order
    // invites. An implementation that forgot the removal shifts later siblings
    // back would land `a` after `c` while behaving correctly on the way up, so a
    // suite asserting only "it moved" passes on it.
    expect(
      afterMove([leaf("a"), leaf("b"), leaf("c"), leaf("d")], "a", "down")
    ).toBe("b a c d");
  });

  it("reorders inside a slot without leaving it", () => {
    expect(afterMove([box("box", [leaf("x"), leaf("y")])], "x", "down")).toBe(
      "box(y x)"
    );
  });

  it("never changes the parent, even at the end of a container", () => {
    // The whole reason this axis refuses here. Stepping out on `down` is the
    // design that has no inverse, and it is the other axis's job.
    expect(
      afterMove([leaf("a"), box("box", [leaf("x"), leaf("y")])], "y", "down")
    ).toBe("a box(x y)");
  });
});

describe("indent and outdent change the parent", () => {
  it("indents into the sibling above, at the end of its children", () => {
    expect(afterMove([box("box", [leaf("x")]), leaf("b")], "b", "indent")).toBe(
      "box(x b)"
    );
  });

  it("outdents to become the parent's next sibling", () => {
    expect(
      afterMove(
        [leaf("a"), box("box", [leaf("x"), leaf("y")]), leaf("b")],
        "x",
        "outdent"
      )
    ).toBe("a box(y) x b");
  });

  it("indents into a leaf, which becomes its parent", () => {
    // A leaf has no slots yet; the engine creates the slot the position names.
    // Refusing here would make depth unreachable for any document that is not
    // already nested, which is every new page.
    expect(afterMove([leaf("a"), leaf("b")], "b", "indent")).toBe("a(b)");
  });
});

describe("when a move is not available", () => {
  it.each<[string, BlockNode[], string, MoveDirection]>([
    ["first block, up", [leaf("a"), leaf("b")], "a", "up"],
    ["last block, down", [leaf("a"), leaf("b")], "b", "down"],
    ["first block, indent", [leaf("a"), leaf("b")], "a", "indent"],
    ["top level, outdent", [leaf("a"), leaf("b")], "a", "outdent"],
    ["an id the document does not hold", [leaf("a")], "ghost", "down"],
  ])("refuses: %s", (_name, nodes, id, direction) => {
    expect(keyboardMovePosition(nodes, id, direction)).toBeNull();
  });
});

describe("every press is undone by the opposite press", () => {
  /**
   * The property that makes a keyboard path usable without sight of the result,
   * and the one that refuted the first design: a single up/down that stepped out
   * of a container at its ends had no inverse, because `up` passed the container
   * rather than re-entering it.
   *
   * Asserted per axis, and the intermediate state is required to DIFFER — a pair
   * of moves that both refused would satisfy "the document is unchanged"
   * perfectly while proving nothing happened at all.
   */
  it.each<[string, BlockNode[], string, MoveDirection, MoveDirection]>([
    ["reorder, flat", [leaf("a"), leaf("b"), leaf("c")], "b", "down", "up"],
    [
      "reorder, in a slot",
      [box("box", [leaf("x"), leaf("y")])],
      "x",
      "down",
      "up",
    ],
    [
      "depth, into a container",
      [box("box", [leaf("x")]), leaf("b")],
      "b",
      "indent",
      "outdent",
    ],
    // The LAST child, deliberately. `indent` appends, so it can only return a
    // block to where it started if that was the end of the container — see the
    // asymmetry asserted below.
    [
      "depth, out of a container",
      [leaf("a"), box("box", [leaf("x"), leaf("y")])],
      "y",
      "outdent",
      "indent",
    ],
  ])("%s", (_name, nodes, id, forward, back) => {
    const before = shape(nodes);

    const out = keyboardMovePosition(nodes, id, forward);
    expect(
      out,
      "the fixture must be able to make the first move"
    ).not.toBeNull();
    const moved = out === null ? nodes : moveNode(nodes, id, out.to);
    expect(
      shape(moved),
      "the first move must actually change the document, or the round trip is vacuous"
    ).not.toBe(before);

    const home = keyboardMovePosition(moved, id, back);
    expect(home, "the block must be able to come back").not.toBeNull();
    const returned = home === null ? moved : moveNode(moved, id, home.to);

    expect(shape(returned)).toBe(before);
  });
});

describe("the one asymmetry, asserted rather than left to be discovered", () => {
  /**
   * `indent` appends to the end of the container above, so it cannot know where
   * in that container a previously-outdented block came from. Outdenting a block
   * that was NOT the last child therefore loses its position within the slot,
   * and a single indent brings it back at the end instead.
   *
   * This is what every outliner does and it is a real limit rather than a defect
   * to fix here: recovering the original index would mean the rule carrying
   * state across presses, which a pure position function cannot do and which
   * would make each key's effect depend on invisible history.
   *
   * Pinned so the limit is a decision on the record. Anyone who later makes the
   * pair symmetric will have to change this test deliberately, rather than
   * discovering the behaviour from a bug report.
   */
  it("loses the slot position when outdenting a block that was not last", () => {
    const nodes = [leaf("a"), box("box", [leaf("x"), leaf("y")])];

    const out = keyboardMovePosition(nodes, "x", "outdent");
    expect(out).not.toBeNull();
    const moved = out === null ? nodes : moveNode(nodes, "x", out.to);
    expect(shape(moved)).toBe("a box(y) x");

    const back = keyboardMovePosition(moved, "x", "indent");
    expect(back).not.toBeNull();
    const returned = back === null ? moved : moveNode(moved, "x", back.to);

    // Back inside the container, at the END rather than at index 0.
    expect(shape(returned)).toBe("a box(y x)");
  });
});

describe("what the move reports beyond where it lands", () => {
  /**
   * A keyboard author cannot see the result, so "moved down" and "moved into
   * Group" have to be announced differently — and the wiring can only say which
   * happened if this function tells it. Re-deriving it there by comparing
   * parents before and after would be a second implementation of a decision
   * already made here.
   */
  it.each<[MoveDirection, string, MoveEffect]>([
    ["down", "x", "reorder"],
    ["up", "y", "reorder"],
    ["outdent", "x", "outdent"],
  ])("reports %s of a nested block as %s", (direction, id, effect) => {
    const nodes = [leaf("a"), box("box", [leaf("x"), leaf("y")])];
    expect(keyboardMovePosition(nodes, id, direction)?.effect).toBe(effect);
  });

  it("reports an indent as indent", () => {
    expect(
      keyboardMovePosition([box("box", [leaf("x")]), leaf("b")], "b", "indent")
        ?.effect
    ).toBe("indent");
  });
});

describe("the slot a departing block leaves behind", () => {
  /**
   * A keyboard author moves ONE block at a time, so emptying a container is the
   * common case rather than the rare one — and the page-builder validator
   * rejects a slot left behind empty and undeclared.
   */
  it("names the vacated slot when outdenting out of a container", () => {
    const nodes = [leaf("a"), box("box", [leaf("x")])];
    expect(
      keyboardMovePosition(nodes, "x", "outdent")?.dropSlotIfEmpty
    ).toEqual({ parentId: "box", slot: "default" });
  });

  it("names nothing when reordering, because nothing is vacated", () => {
    // Asserted rather than assumed: naming a slot the block has NOT left is
    // refused by the store, so a blanket value here would turn every reorder
    // inside a container into an error.
    const nodes = [box("box", [leaf("x"), leaf("y")])];
    expect(
      keyboardMovePosition(nodes, "x", "down")?.dropSlotIfEmpty
    ).toBeUndefined();
  });

  it("names nothing when the block was at the top level", () => {
    // Top level is not a slot, so there is nothing to clean up.
    expect(
      keyboardMovePosition([box("box", [leaf("x")]), leaf("b")], "b", "indent")
        ?.dropSlotIfEmpty
    ).toBeUndefined();
  });
});
