/**
 * The selection grammar.
 *
 * Three properties carry the module and each has a control beside it, because
 * each has a plausible implementation that satisfies the obvious case and fails
 * the real one:
 *
 * - **outermost normalisation** — a set holding a container and its child must
 *   collapse, or deleting it removes the child twice;
 * - **document order** — asserted to agree with `layersOf`, so there is one
 *   VERIFIED definition of order rather than two implementations of it;
 * - **the range at the shared level** — a run must never span two slots or two
 *   containers, however close the indices look.
 *
 * @module selection.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { layersOf, type LayerNode } from "./layers";
import {
  EMPTY_SELECTION,
  applySelection,
  documentOrder,
  normalizeSelection,
  pruneSelection,
  rangeBetween,
  type Selection,
} from "./selection";

function node(id: string, slots?: Record<string, BlockNode[]>): BlockNode {
  return {
    id,
    type: slots ? "acme/box" : "acme/leaf",
    version: 1,
    props: {},
    ...(slots ? { slots } : {}),
  } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/**
 * Two sections, each holding three leaves, plus a two-slot container.
 *
 * The two-slot container is the fixture that separates "same parent" from "same
 * LIST": `x1` and `y1` share a parent and are in different slots, so no run
 * spans them.
 */
function tree(): BlockDocument {
  return documentOf([
    node("s1", { children: [node("a"), node("b"), node("c")] }),
    node("s2", { children: [node("d"), node("e"), node("f")] }),
    node("two", { left: [node("x1"), node("x2")], right: [node("y1")] }),
  ]);
}

function selection(ids: string[], primary: string | null): Selection {
  return { ids, primary };
}

describe("documentOrder", () => {
  it("reads parents before children and slots in declaration order", () => {
    expect(documentOrder(tree())).toEqual([
      "s1",
      "a",
      "b",
      "c",
      "s2",
      "d",
      "e",
      "f",
      "two",
      "x1",
      "x2",
      "y1",
    ]);
  });

  it("agrees with the layers panel's order", () => {
    // The two are separate walks on purpose — this one skips the label and
    // badge work the panel does — so the guarantee that they cannot disagree
    // has to be asserted rather than assumed.
    const flatten = (rows: readonly LayerNode[]): string[] =>
      rows.flatMap(row => [row.id, ...flatten(row.children)]);

    expect(documentOrder(tree())).toEqual(flatten(layersOf(tree())));
  });
});

describe("normalizeSelection", () => {
  it("drops a child whose ancestor is also selected", () => {
    // THE case. Deleting a set holding both would remove `a` with `s1` and then
    // again from a document that no longer has it.
    expect(normalizeSelection(tree(), ["s1", "a"])).toEqual(["s1"]);
  });

  it("drops a DEEP descendant, not merely a direct child", () => {
    const deep = documentOf([
      node("outer", { children: [node("mid", { children: [node("leaf")] })] }),
    ]);

    expect(normalizeSelection(deep, ["outer", "leaf"])).toEqual(["outer"]);
  });

  it("keeps siblings, which is the control", () => {
    // Without this, "collapse everything to one id" would pass every case
    // above.
    expect(normalizeSelection(tree(), ["b", "a"])).toEqual(["a", "b"]);
  });

  it("returns document order however the ids arrive", () => {
    expect(normalizeSelection(tree(), ["f", "a", "d"])).toEqual([
      "a",
      "d",
      "f",
    ]);
  });

  it("drops ids the document no longer holds", () => {
    // An undo that removes selected blocks is routine, not exotic.
    expect(normalizeSelection(tree(), ["a", "gone"])).toEqual(["a"]);
  });
});

describe("rangeBetween", () => {
  it("selects the run between two siblings, in either direction", () => {
    expect(rangeBetween(tree(), "a", "c")).toEqual(["a", "b", "c"]);
    expect(rangeBetween(tree(), "c", "a")).toEqual(["a", "b", "c"]);
  });

  it("selects at the level where the two paths diverge", () => {
    // `a` is in s1 and `e` is in s2, so there is no run of siblings spanning
    // them. The answer is the run at the level that does contain both.
    expect(rangeBetween(tree(), "a", "e")).toEqual(["s1", "s2"]);
  });

  it("never spans two SLOTS of one parent", () => {
    // `x1` and `y1` share a parent and are in different slots. A run across
    // them is not contiguous however close the indices look, and a rule keyed
    // on "same parent" rather than "same list" would return one.
    expect(rangeBetween(tree(), "x1", "y1")).toEqual([]);
  });

  it("answers with the OUTER block when one contains the other", () => {
    expect(rangeBetween(tree(), "s1", "b")).toEqual(["s1"]);
    expect(rangeBetween(tree(), "b", "s1")).toEqual(["s1"]);
  });

  it("answers with nothing for an id the document lost", () => {
    expect(rangeBetween(tree(), "a", "gone")).toEqual([]);
  });
});

describe("applySelection", () => {
  it("replaces on a plain click", () => {
    expect(applySelection(tree(), selection(["a", "b"], "a"), "e")).toEqual({
      ids: ["e"],
      primary: "e",
    });
  });

  it("clears on a click that hit no block", () => {
    expect(
      applySelection(tree(), selection(["a"], "a"), null, "toggle")
    ).toEqual(EMPTY_SELECTION);
  });

  it("ignores a target the document does not hold", () => {
    // Rather than clearing. A stale id is not an instruction to deselect, and
    // treating it as one loses a selection for a reason the author cannot see.
    const current = selection(["a"], "a");
    expect(applySelection(tree(), current, "gone")).toBe(current);
  });

  it("toggles a block in, and makes it primary", () => {
    // Primary follows the block just pointed at: it is the one the author
    // expects the inspector to describe.
    expect(
      applySelection(tree(), selection(["a"], "a"), "c", "toggle")
    ).toEqual({ ids: ["a", "c"], primary: "c" });
  });

  it("toggles a block out, and hands primary to what is left", () => {
    // A set with members but no primary would leave the inspector blank while
    // the canvas still drew outlines.
    const next = applySelection(
      tree(),
      selection(["a", "c"], "c"),
      "c",
      "toggle"
    );

    expect(next.ids).toEqual(["a"]);
    expect(next.primary).toBe("a");
  });

  it("hands primary to the FIRST survivor when more than one remains", () => {
    /*
     * The case that pins an otherwise arbitrary choice. With one survivor every
     * rule agrees, so a test using two is the only one that can distinguish
     * "first in document order" from "nearest to what was removed" — and an
     * earlier version chose the latter with nothing able to tell.
     */
    const next = applySelection(
      tree(),
      selection(["a", "b", "c"], "b"),
      "b",
      "toggle"
    );

    expect(next.ids).toEqual(["a", "c"]);
    expect(next.primary).toBe("a");
  });

  it("toggling the last block out empties the selection", () => {
    expect(
      applySelection(tree(), selection(["a"], "a"), "a", "toggle")
    ).toEqual(EMPTY_SELECTION);
  });

  it("toggling a container in absorbs its selected children", () => {
    const next = applySelection(
      tree(),
      selection(["a", "b"], "b"),
      "s1",
      "toggle"
    );

    expect(next.ids).toEqual(["s1"]);
    // Primary was `s1` — the block pointed at — and it survives normalisation.
    expect(next.primary).toBe("s1");
  });

  it("extends from the primary, replacing rather than growing", () => {
    // Shift-click means "the selection is now anchor-to-here" in every list
    // this grammar comes from. Growing would make a corrected aim additive.
    const next = applySelection(tree(), selection(["a"], "a"), "c", "extend");

    expect(next.ids).toEqual(["a", "b", "c"]);
    // The anchor stays primary, so a run of shift-clicks re-aims from one end.
    expect(next.primary).toBe("a");
  });

  it("a second extend re-aims from the same anchor", () => {
    const first = applySelection(tree(), selection(["a"], "a"), "c", "extend");
    const second = applySelection(tree(), first, "b", "extend");

    expect(second.ids).toEqual(["a", "b"]);
    expect(second.primary).toBe("a");
  });

  it("extending with nothing selected behaves as a plain click", () => {
    expect(applySelection(tree(), EMPTY_SELECTION, "b", "extend")).toEqual({
      ids: ["b"],
      primary: "b",
    });
  });

  it("extending across slots selects the target alone rather than nothing", () => {
    // `rangeBetween` answers `[]` here, and a selection that emptied itself on
    // a shift-click would read as the gesture being broken.
    const next = applySelection(
      tree(),
      selection(["x1"], "x1"),
      "y1",
      "extend"
    );

    expect(next.ids).toEqual(["y1"]);
    expect(next.primary).toBe("y1");
  });
});

describe("pruneSelection", () => {
  it("drops what an edit removed and keeps a valid primary", () => {
    const after = documentOf([node("s1", { children: [node("a")] })]);

    expect(pruneSelection(after, selection(["a", "e"], "e"))).toEqual({
      ids: ["a"],
      primary: "a",
    });
  });

  it("empties when nothing survives", () => {
    expect(
      pruneSelection(documentOf([node("z")]), selection(["a"], "a"))
    ).toEqual(EMPTY_SELECTION);
  });
});
