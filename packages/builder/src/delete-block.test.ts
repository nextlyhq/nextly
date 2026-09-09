/**
 * What deleting the selected block takes with it, and where it leaves the
 * author.
 *
 * Selection is what these mostly assert. Removing the node is one op and the
 * store already covers it; deciding what an author is looking at afterwards is
 * a judgement with four outcomes, and every one of them renders as "a canvas
 * with one fewer block" — so none of it is separable in a component test.
 *
 * @module delete-block.test
 */
import { describe, expect, it } from "vitest";

import { MAX_VALUE_PARTS } from "@nextlyhq/blocks-engine";
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { blockDeletion } from "./delete-block";

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

describe("blockDeletion", () => {
  it("names the block and its type", () => {
    const deletion = blockDeletion(documentOf([leaf("a"), leaf("b")]), "b");

    expect(deletion?.id).toBe("b");
    // The type travels so a caller can say WHAT was deleted. Recovering it
    // afterwards is impossible: the node is gone by then.
    expect(deletion?.type).toBe("acme/text");
  });

  it("selects the next sibling, so a repeated delete moves forward", () => {
    // THE case. Selecting the previous sibling here would answer "a" — a block
    // the author has already passed and approved — so a second press would
    // destroy work behind them. Forward is what every list-deletion surface
    // does, and it is what makes a run of presses clear a section.
    const deletion = blockDeletion(
      documentOf([leaf("a"), leaf("b"), leaf("c")]),
      "b"
    );

    expect(deletion?.nextSelection).toBe("c");
  });

  it("falls back to the previous sibling when the block was last", () => {
    // The separating case for the rule above: with nothing after it, the
    // author stays in the same container rather than losing their place.
    const deletion = blockDeletion(documentOf([leaf("a"), leaf("b")]), "b");

    expect(deletion?.nextSelection).toBe("a");
  });

  it("falls to the parent when the block was an only child", () => {
    // The container is where the author was working, and it is the nearest
    // thing that still exists.
    const deletion = blockDeletion(
      documentOf([box("wrap", [leaf("only")])]),
      "only"
    );

    expect(deletion?.nextSelection).toBe("wrap");
  });

  it("clears the selection only when nothing is left", () => {
    // The one case with genuinely nowhere to be. Asserting the other three
    // above is what stops this becoming the answer for all of them.
    const deletion = blockDeletion(documentOf([leaf("only")]), "only");

    expect(deletion?.nextSelection).toBeNull();
  });

  it("names the slot it may empty, so an undo can restore it", () => {
    const deletion = blockDeletion(
      documentOf([box("wrap", [leaf("only")])]),
      "only"
    );

    expect(deletion?.dropSlotIfEmpty).toEqual({
      parentId: "wrap",
      slot: "children",
    });
  });

  it("names no slot for a top-level block", () => {
    // The control: a deletion that always carried a slot address would ask the
    // store to tidy a container that does not exist.
    const deletion = blockDeletion(documentOf([leaf("a"), leaf("b")]), "a");

    expect(deletion?.dropSlotIfEmpty).toBeUndefined();
  });

  it("counts what goes with a container, at every depth", () => {
    // A collapsed section looks exactly like an empty one, so the count is the
    // only thing telling an author what they are about to lose. Nested rather
    // than flat on purpose: counting immediate children alone would answer 1
    // here and be wrong by two.
    const deletion = blockDeletion(
      documentOf([box("wrap", [leaf("x"), box("inner", [leaf("y")])])]),
      "wrap"
    );

    expect(deletion?.descendantCount).toBe(3);
  });

  it("counts nothing for a leaf", () => {
    const deletion = blockDeletion(documentOf([leaf("a")]), "a");

    expect(deletion?.descendantCount).toBe(0);
  });

  it("refuses when nothing is selected", () => {
    expect(blockDeletion(documentOf([leaf("a")]), null)).toBeNull();
  });

  it("refuses an id the document no longer holds", () => {
    // A stale selection after an undo, or one made against a document that has
    // since been replaced.
    expect(blockDeletion(documentOf([leaf("a")]), "gone")).toBeNull();
  });

  it("is empty-document safe", () => {
    expect(blockDeletion(documentOf([]), "a")).toBeNull();
  });
});

describe("a subtree the engine cannot count", () => {
  /**
   * A chain of distinct node objects where each holds the NEXT one twice, so
   * entries double at every level while the object count stays linear. The
   * engine refuses to count past its machine ceiling rather than answering from
   * a partial walk.
   *
   * DERIVED from the ceiling rather than written beside it. `sharedChain(w)`
   * builds one leaf plus `w` wrappers, so its entries are `2 ** (w + 1) - 1`;
   * stating that number by hand got it wrong by a factor of two, and a fixture
   * with that much slack keeps passing while the ceiling moves underneath it.
   *
   * The smallest chain that exceeds the ceiling is the sensitive one: raise the
   * ceiling and this stops being refused, which is the drift worth catching.
   */
  /** Entries a chain of `wrappers` doublings walks, over one leaf. */
  function chainEntries(wrappers: number): number {
    return 2 ** (wrappers + 1) - 1;
  }

  /** The smallest chain whose entries exceed the engine's ceiling. */
  function overCeiling(): number {
    let wrappers = 1;
    while (chainEntries(wrappers) <= MAX_VALUE_PARTS) wrappers += 1;
    return wrappers;
  }

  function sharedChain(objects: number): BlockNode {
    let node: BlockNode = leaf("deep-leaf");
    for (let i = objects - 1; i >= 0; i--) {
      node = {
        id: `d${String(i)}`,
        type: "acme/box",
        version: 1,
        props: {},
        slots: { children: [node, node] },
      } as BlockNode;
    }
    return node;
  }

  it("still offers the deletion instead of throwing out of the editor", () => {
    /*
     * `blockDeletion` is called to decide whether the toolbar's Delete button
     * is ENABLED, so a refusal escaping here throws during toolbar construction
     * and takes the editor down at the moment the node is selected. Being able
     * to remove a block must not depend on being able to describe it.
     */
    const doc = documentOf([sharedChain(overCeiling()), leaf("after")]);

    const deletion = blockDeletion(doc, "d0");

    expect(deletion).not.toBeNull();
    expect(deletion?.id).toBe("d0");
    // Selection still lands somewhere real, which is the other half of what
    // this function owes its caller.
    expect(deletion?.nextSelection).toBe("after");
  });

  it("claims nothing about the contents it could not count", () => {
    // Zero is the same value a childless node reports, and that is deliberate:
    // the announcement says "<name> deleted" at zero and adds "with N blocks
    // inside" above it, so zero states nothing rather than stating none.
    const doc = documentOf([sharedChain(overCeiling())]);

    expect(blockDeletion(doc, "d0")?.descendantCount).toBe(0);
  });

  it("still counts a subtree it CAN measure", () => {
    // The control. Without it, a `blockDeletion` that reported zero for every
    // node — or never counted at all — passes both tests above.
    const doc = documentOf([sharedChain(4)]);

    expect(blockDeletion(doc, "d0")?.descendantCount).toBe(2 ** 5 - 2);
  });
});
