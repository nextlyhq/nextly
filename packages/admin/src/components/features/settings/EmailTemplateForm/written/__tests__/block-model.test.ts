/**
 * The edits a written email's block list makes: each returns a new document,
 * never changing the one it was given, and keeps a list's blocks inside it.
 */
import { describe, expect, it } from "vitest";

import type {
  WrittenBlock,
  WrittenDocument,
} from "@admin/services/emailTemplateApi";

import {
  addBlock,
  duplicateBlock,
  moveBlock,
  moveBlockTo,
  newBlock,
  removeBlock,
  restoreBlock,
} from "../block-model";

const heading = (text: string): WrittenBlock => ({
  type: "heading",
  text: [{ type: "text", text }],
});
const A = heading("A");
const B = heading("B");
const C = heading("C");
const doc = (...blocks: WrittenBlock[]): WrittenDocument => ({
  version: 1,
  blocks,
});
const list = (...blocks: WrittenBlock[]): WrittenBlock => ({
  type: "list",
  variable: "lines",
  blocks: blocks as Extract<WrittenBlock, { type: "list" }>["blocks"],
});

describe("the block list's edits", () => {
  it("adds a new block at the end, or at the end of a list, and says where", () => {
    const top = addBlock(doc(A), "divider");
    expect(top.doc.blocks).toEqual([A, { type: "divider" }]);
    expect(top.path).toEqual([1]);

    const inner = addBlock(doc(A, list(B)), "spacer", 1);
    expect(inner.doc.blocks[1]).toEqual(list(B, { type: "spacer" }));
    expect(inner.path).toEqual([1, 1]);
  });

  it("never adds a list inside a list", () => {
    expect(() => addBlock(doc(list()), "list", 0)).toThrow();
  });

  it("moves a block up or down, and not past either end", () => {
    expect(moveBlock(doc(A, B, C), [1], -1).blocks).toEqual([B, A, C]);
    expect(moveBlock(doc(A, B, C), [1], 1).blocks).toEqual([A, C, B]);
    expect(moveBlock(doc(A, B), [0], -1).blocks).toEqual([A, B]);
    expect(moveBlock(doc(A, B), [1], 1).blocks).toEqual([A, B]);
  });

  it("moves a block inside its own list", () => {
    expect(moveBlock(doc(list(A, B)), [0, 1], -1).blocks).toEqual([list(B, A)]);
  });

  it("drops a dragged block at a place in its own list", () => {
    expect(moveBlockTo(doc(A, B, C), [0], 2).blocks).toEqual([B, C, A]);
    expect(moveBlockTo(doc(list(A, B, C)), [0, 2], 0).blocks).toEqual([
      list(C, A, B),
    ]);
  });

  it("duplicates a block just after itself", () => {
    const copy = duplicateBlock(doc(A, B), [0]);
    expect(copy.doc.blocks).toEqual([A, A, B]);
    expect(copy.path).toEqual([1]);
    // A copy, not the same object: editing one leaves the other.
    expect(copy.doc.blocks[1]).not.toBe(copy.doc.blocks[0]);
  });

  it("removes a block, and puts it back where it was on undo", () => {
    const original = doc(A, list(B, C));
    const removed = removeBlock(original, [1, 0]);
    expect(removed.doc.blocks).toEqual([A, list(C)]);
    expect(restoreBlock(removed.doc, removed.removed)).toEqual(original);
  });

  it("puts a block removed from a list back in the email when its list has gone", () => {
    const removed = removeBlock(doc(A, list(B, C)), [1, 0]);
    // The list itself removed (or moved) before Undo.
    const withoutList = removeBlock(removed.doc, [1]).doc;
    expect(restoreBlock(withoutList, removed.removed).blocks).toEqual([A, B]);
  });

  it("leaves the document it was given unchanged", () => {
    const original = doc(A, B);
    const copy = structuredClone(original);
    moveBlock(original, [0], 1);
    removeBlock(original, [0]);
    addBlock(original, "divider");
    expect(original).toEqual(copy);
  });

  it("starts each kind of block as the written rules shape it", () => {
    expect(newBlock("heading")).toEqual({ type: "heading", text: [] });
    expect(newBlock("text")).toEqual({ type: "text", text: [] });
    expect(newBlock("divider")).toEqual({ type: "divider" });
    expect(newBlock("spacer")).toEqual({ type: "spacer" });
    expect(newBlock("button")).toMatchObject({ type: "button" });
    expect(newBlock("image")).toMatchObject({ type: "image", alt: [] });
    expect(newBlock("list")).toMatchObject({ type: "list", blocks: [] });
  });
});
