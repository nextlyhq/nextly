/**
 * A list of words typed on the canvas item by item: each item a line of its
 * own, Enter splitting one into two, Backspace in an empty one removing it.
 *
 * Driven through the real registry, because "the block declares it" is the
 * rule under test: an array declared `inline` offers its items, one that is
 * not offers nothing.
 */
import {
  clearBlocks,
  itemPropName,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it } from "vitest";

import { firstInlineProp } from "./inline-target";
import {
  inlineTarget,
  inlineTargets,
  inlineTextOp,
  removeItemOp,
  splitItemOp,
} from "./inline-text";
import { inlinePropKindAt } from "./inline-prop-kind";

afterEach(clearBlocks);

/** A list block, its items typed on the canvas unless `inline` is off. */
function list(
  items: unknown,
  { inline = true, locked = false } = {}
): BlockDocument {
  // Registered afresh for each document, as a test may ask for two.
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/list",
        version: 1,
        description: "A list.",
        example: { props: {} },
        props: {
          items: { type: "array", of: "text", ...(inline ? { inline } : {}) },
          start: { type: "number" },
        },
        render: () => null,
      },
    ] as never,
    { source: "inline-items-test" }
  );
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "l",
        type: "acme/list",
        version: 1,
        props: { items },
        ...(locked ? { locked: true } : {}),
      } as BlockNode,
    ],
  } as BlockDocument;
}

const item = (index: number) => itemPropName("items", index);

/** The items an op would leave the list holding. */
function itemsAfter(op: unknown): unknown {
  return (op as { patch: { props: { items: unknown } } }).patch.props.items;
}

describe("a list's items as canvas values", () => {
  it("offers each item as a line of its own, in order", () => {
    const targets = inlineTargets(list(["One", "Two"]), "l");
    expect(targets.map(t => [t.prop, t.value, t.multiline])).toEqual([
      [item(0), "One", false],
      [item(1), "Two", false],
    ]);
  });

  it("starts the keyboard's edit in the first item", () => {
    expect(firstInlineProp(list(["One", "Two"]), "l")).toEqual({
      prop: item(0),
      kind: "plain",
    });
  });

  it("is a line of plain text to the surface that routes an edit", () => {
    const props = { items: { type: "array", of: "text", inline: true } };
    expect(inlinePropKindAt(props, item(3))).toBe("plain");
    // The array as a whole is not a line anyone can type.
    expect(inlinePropKindAt(props, "items")).toBeNull();
  });

  it("offers nothing for an array the block left out, or a locked list", () => {
    expect(inlineTargets(list(["One"], { inline: false }), "l")).toEqual([]);
    expect(inlineTargets(list(["One"], { locked: true }), "l")).toEqual([]);
    expect(inlineTarget(list(["One"]), "l", item(1))).toBeNull();
  });

  it("writes an item back as the whole list, the others kept", () => {
    const op = inlineTextOp(list(["One", "Two"]), "l", item(1), "Deux");
    expect(itemsAfter(op)).toEqual(["One", "Deux"]);
    expect(inlineTextOp(list(["One", "Two"]), "l", item(1), "Two")).toBeNull();
  });
});

describe("Enter in an item", () => {
  it("splits it at the caret, the words after it starting the next item", () => {
    const split = splitItemOp(list(["One", "Two"]), "l", item(0), "O", "ne");
    expect(itemsAfter(split?.op)).toEqual(["O", "ne", "Two"]);
    expect(split?.next).toBe(item(1));
  });

  it("adds an empty item after the last one, at its end", () => {
    const split = splitItemOp(list(["One", "Two"]), "l", item(1), "Two", "");
    expect(itemsAfter(split?.op)).toEqual(["One", "Two", ""]);
    expect(split?.next).toBe(item(2));
  });

  it("writes nothing to a list that is locked or an item that is gone", () => {
    expect(
      splitItemOp(list(["One"], { locked: true }), "l", item(0), "One", "")
    ).toBeNull();
    expect(splitItemOp(list(["One"]), "l", item(4), "", "")).toBeNull();
  });
});

describe("Backspace in an empty item", () => {
  it("removes it, the caret going to the end of the item before", () => {
    const removed = removeItemOp(list(["One", "", "Three"]), "l", item(1));
    expect(itemsAfter(removed?.op)).toEqual(["One", "Three"]);
    expect(removed?.next).toEqual({ prop: item(0), caret: "end" });
  });

  it("from the first item goes to the start of the one that follows", () => {
    const removed = removeItemOp(list(["", "Two"]), "l", item(0));
    expect(itemsAfter(removed?.op)).toEqual(["Two"]);
    expect(removed?.next).toEqual({ prop: item(0), caret: "start" });
  });

  it("leaves no item to go to when it was the only one", () => {
    const removed = removeItemOp(list([""]), "l", item(0));
    expect(itemsAfter(removed?.op)).toEqual([]);
    expect(removed?.next).toBeNull();
  });

  it("writes nothing to a locked list", () => {
    expect(
      removeItemOp(list(["", "Two"], { locked: true }), "l", item(0))
    ).toBeNull();
  });
});
