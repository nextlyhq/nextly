import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "./document";
import {
  countNodes,
  documentBytes,
  ForestTooLargeError,
  MAX_NODES,
  MAX_VALUE_PARTS,
  treeDepth,
} from "./limits";

/**
 * A forest of `objects` distinct nodes where each holds the NEXT one TWICE.
 *
 * Entry count is `2 ** objects - 1` while the object count is linear, which is
 * the shape the bound exists for. Nothing persisted can look like this —
 * `JSON.parse` produces fresh objects and cannot express sharing — so it is
 * built here the only way it can arise: in memory, by code.
 */
function sharedChain(objects: number): BlockNode[] {
  let node: BlockNode = {
    id: "leaf",
    type: "core/box",
    version: 1,
    props: {},
  } as BlockNode;
  for (let i = objects - 1; i >= 0; i--) {
    node = {
      id: `n${String(i)}`,
      type: "core/box",
      version: 1,
      props: {},
      slots: { children: [node, node] },
    } as BlockNode;
  }
  return [node];
}

/** A genuinely deep TREE — no sharing, one object per entry. */
function chain(objects: number): BlockNode[] {
  let node: BlockNode = {
    id: "leaf",
    type: "core/box",
    version: 1,
    props: {},
  } as BlockNode;
  for (let i = objects - 1; i >= 0; i--) {
    node = {
      id: `n${String(i)}`,
      type: "core/box",
      version: 1,
      props: {},
      slots: { children: [node] },
    } as BlockNode;
  }
  return [node];
}

const page = (nodes: BlockNode[]): BlockDocument =>
  ({ formatVersion: 1, kind: "page", nodes }) as BlockDocument;

describe("a forest whose entries outrun its objects", () => {
  // 23 objects walk 8,388,607 entries, which is past the shared ceiling of
  // 4,194,304. 18 objects walk 524,287, which is not — so the pair separates
  // "refuses what it must" from "refuses everything", and neither test is
  // evidence without the other.
  const OVER = 23;
  const UNDER = 18;

  it("refuses to COUNT one, rather than answering from a partial walk", () => {
    expect(() => countNodes(sharedChain(OVER))).toThrow(ForestTooLargeError);
  });

  it("refuses to MEASURE ITS DEPTH for the same reason", () => {
    expect(() => treeDepth(sharedChain(OVER))).toThrow(ForestTooLargeError);
  });

  it("aborts serialization at the bound instead of building the string first", () => {
    /*
     * The bound rides the serializer's OWN traversal through a replacer, so it
     * stops before the string exists. Catching the eventual failure instead
     * would pay the whole cost first: the 21-object case allocates 132 MB and a
     * deeper one exhausts the heap before any catchable error is raised.
     *
     * 30 objects is chosen because it CANNOT be serialized at all — a billion
     * entries — so a passing assertion here proves the abort is early rather
     * than merely eventual. The test would not complete otherwise.
     */
    const start = Date.now();
    expect(() => documentBytes(page(sharedChain(30)))).toThrow(
      ForestTooLargeError
    );
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it("leaves a RangeError from the document's own hook alone", () => {
    /*
     * A `toJSON`, a getter or a proxy trap may raise `RangeError` for its own
     * reasons. Renaming that into a size refusal tells a caller to shrink or
     * de-share a document whose problem is in its hook, and loses the original
     * diagnostic — so nothing here catches it.
     *
     * This replaces an earlier test that RAISED a RangeError through `toJSON`
     * to stand in for the size failure. It passed, and it pinned exactly the
     * misclassification described above: the fixture proved the translation
     * happened, never that the serializer had hit its own limit.
     */
    const own = new RangeError("from the document's own hook");
    const hooked = {
      id: "h",
      type: "core/box",
      version: 1,
      props: {},
      toJSON() {
        throw own;
      },
    } as unknown as BlockNode;

    let raised: unknown;
    try {
      documentBytes(page([hooked]));
    } catch (error) {
      raised = error;
    }
    expect(raised).toBe(own);
    expect(raised).not.toBeInstanceOf(ForestTooLargeError);
  });

  it("measures an ordinary document byte-for-byte as plain stringify would", () => {
    // The replacer must not change the OUTPUT, only bound the work. Without
    // this, a replacer that dropped or rewrote values would still pass every
    // refusal test above while silently reporting the wrong size.
    const doc = page(chain(20));
    expect(documentBytes(doc)).toBe(
      new TextEncoder().encode(JSON.stringify(doc)).length
    );
  });

  it("offers both causes rather than diagnosing the one it cannot see", () => {
    /*
     * The walk counts entries and never compares identity, so it cannot tell a
     * shared chain from a genuinely enormous flat forest. Naming only the
     * sharing would send a reader hunting for a node under two parents in a
     * document that has none — a repair that cannot succeed.
     *
     * Both halves are asserted: dropping either leaves a message that reads as
     * a diagnosis of whichever survived.
     */
    expect(() => countNodes(sharedChain(OVER))).toThrow(/more than one parent/);
    expect(() => countNodes(sharedChain(OVER))).toThrow(
      /genuinely holding that many nodes/
    );
  });

  it("does not refuse a document the serializer would have measured", () => {
    /*
     * `walkForest` reaches `node.slots` by property access, so it sees a slot
     * the serializer does not: `JSON.stringify` reads own enumerable properties
     * only. Predicting the size from the walk refused this document — whose
     * JSON is under a hundred bytes — which is a false refusal on the function
     * deciding whether a document may be stored. Measuring what the serializer
     * ACTUALLY produced cannot diverge from it.
     */
    const hidden = {
      id: "h",
      type: "core/box",
      version: 1,
      props: {},
    } as unknown as BlockNode;
    Object.defineProperty(hidden, "slots", {
      value: { children: sharedChain(OVER) },
      enumerable: false,
    });

    const bytes = documentBytes(page([hidden]));
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(1_000);
    // The control: the walk really does reach the hidden chain, so this is not
    // passing because the fixture failed to build one.
    expect(() => countNodes([hidden])).toThrow(ForestTooLargeError);
  });

  it("still answers for a shared forest UNDER the bound", () => {
    // The control for all four above. A bound set low enough to refuse
    // everything passes each of them, and this is what separates the two.
    expect(countNodes(sharedChain(UNDER))).toBe(2 ** (UNDER + 1) - 1);
    expect(treeDepth(sharedChain(UNDER))).toBe(UNDER + 1);
  });

  it("leaves an ordinary document alone, bound nowhere near it", () => {
    /*
     * The bound is a MACHINE one and must never fire on anything a product cap
     * would have allowed, so it is asserted against the product cap rather than
     * against a number chosen to agree with it.
     *
     * It is also the SAME ceiling the op layer's preflight refuses at, which is
     * what stops a dry run accepting a document the apply then rejects. A second
     * number here, however well chosen, reintroduces that disagreement.
     */
    expect(MAX_VALUE_PARTS).toBeGreaterThan(MAX_NODES * 100);
    const ordinary = chain(50);
    expect(countNodes(ordinary)).toBe(51);
    expect(treeDepth(ordinary)).toBe(51);
    expect(documentBytes(page(ordinary))).toBeGreaterThan(0);
  });
});
