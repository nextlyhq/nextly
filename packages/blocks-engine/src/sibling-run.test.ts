/**
 * Whether a selection is one run of siblings.
 *
 * Two failures are worth more than the rest and most of these assertions exist
 * for them. A rule that keys the list on the parent ALONE reads a card's header
 * and its footer as one list, so a reorder swaps a block between two regions it
 * was never in. And a rule that reports "an id I cannot find" as "these are in
 * different containers" tells an author to fix their selection when what is
 * actually wrong is that the caller is out of step with the document.
 */
import { describe, expect, it } from "vitest";

import type { BlockNode } from "./document";
import { contiguousRun, siblingRun } from "./sibling-run";

/** A node, optionally holding named slots of children. */
function node(id: string, slots?: Record<string, BlockNode[]>): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(slots === undefined ? {} : { slots }),
  };
}

/** Three top-level siblings. */
const flat = (): BlockNode[] => [node("a"), node("b"), node("c")];

describe("a selection that shares one list", () => {
  it("reports each block's index, at the top level", () => {
    const found = siblingRun(flat(), ["a", "b"]);
    expect(found.run).toEqual({
      places: [
        { id: "a", index: 0 },
        { id: "b", index: 1 },
      ],
    });
  });

  it("names the parent and slot when the run is nested", () => {
    const nodes = [node("card", { body: [node("a"), node("b")] })];
    const found = siblingRun(nodes, ["a", "b"]);
    expect(found.run?.parentId).toBe("card");
    expect(found.run?.slot).toBe("body");
  });

  it("sorts by index however the ids arrived", () => {
    const found = siblingRun(flat(), ["c", "a", "b"]);
    expect(found.run?.places.map(place => place.id)).toEqual(["a", "b", "c"]);
  });

  it("allows a gap, because a reorder does not care about one", () => {
    const found = siblingRun(flat(), ["a", "c"]);
    expect(found.run?.places.map(place => place.index)).toEqual([0, 2]);
  });
});

describe("a selection that does not share one list", () => {
  it("refuses blocks in two different parents", () => {
    const nodes = [
      node("one", { body: [node("a")] }),
      node("two", { body: [node("b")] }),
    ];
    expect(siblingRun(nodes, ["a", "b"]).problem).toBe("split");
  });

  it("refuses two SLOTS of one parent, which share a parent id", () => {
    const nodes = [node("card", { header: [node("a")], footer: [node("b")] })];
    expect(siblingRun(nodes, ["a", "b"]).problem).toBe("split");
  });

  it("refuses one parent's slot and one root, which share a slot of nothing", () => {
    const nodes = [node("a"), node("card", { body: [node("b")] })];
    expect(siblingRun(nodes, ["a", "b"]).problem).toBe("split");
  });

  it("refuses a pair whose parent and slot JOIN to the same text", () => {
    // The list was once identified by `parentId + " " + slot`, on the stated
    // ground that an id cannot contain a space. Validation asks a node id only
    // to be a non-empty string, and these primitives read stored documents that
    // nothing validated, so both halves are arbitrary text. Here `"a"` + `"b c"`
    // and `"a b"` + `"c"` both spell `"a b c"`, and the two containers merged:
    // the run was accepted, the contiguity check passed, and a pattern saved
    // from it took the first container's second block instead of the one the
    // author had actually selected in the second.
    const nodes = [
      node("a", { "b c": [node("p"), node("q")] }),
      node("a b", { c: [node("y0"), node("y1")] }),
    ];

    expect(siblingRun(nodes, ["p", "y1"]).problem).toBe("split");
    expect(contiguousRun(nodes, ["p", "y1"]).problem).toBe("split");
  });

  it("tells an unknown id apart from a split", () => {
    expect(siblingRun(flat(), ["a", "nowhere"]).problem).toBe("unknown");
  });

  it("refuses an empty selection rather than answering with an empty run", () => {
    const found = siblingRun(flat(), []);
    expect(found.problem).toBe("empty");
    expect(found.run).toBeUndefined();
  });
});

describe("contiguity", () => {
  it("accepts a consecutive run", () => {
    expect(contiguousRun(flat(), ["a", "b"]).run?.places).toHaveLength(2);
  });

  it("accepts it whatever order the ids arrived in", () => {
    expect(contiguousRun(flat(), ["b", "a"]).run?.places).toEqual([
      { id: "a", index: 0 },
      { id: "b", index: 1 },
    ]);
  });

  it("accepts a single block", () => {
    expect(contiguousRun(flat(), ["b"]).run?.places).toEqual([
      { id: "b", index: 1 },
    ]);
  });

  it("refuses a run with a block left out of the middle", () => {
    expect(contiguousRun(flat(), ["a", "c"]).problem).toBe("gap");
  });

  it("keeps the cause when the selection was not one list at all", () => {
    const nodes = [node("card", { header: [node("a")], footer: [node("b")] })];
    // "split", not "gap": the run never got far enough to have indexes to
    // compare, and an author told to close a gap would be looking for one that
    // is not there.
    expect(contiguousRun(nodes, ["a", "b"]).problem).toBe("split");
  });

  it("accepts a nested run, so the rule is not a top-level one", () => {
    const nodes = [node("card", { body: [node("a"), node("b"), node("c")] })];
    expect(contiguousRun(nodes, ["b", "c"]).run?.parentId).toBe("card");
    expect(contiguousRun(nodes, ["a", "c"]).problem).toBe("gap");
  });
});
