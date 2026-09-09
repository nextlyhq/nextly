import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "./document";
import {
  countNodes,
  documentBytes,
  ForestTooLargeError,
  MAX_NODES,
  MAX_WALKABLE_ENTRIES,
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
  // 21 objects walk 2,097,151 entries, which is past the bound. 18 objects walk
  // 262,143, which is not — so the pair separates "refuses what it must" from
  // "refuses everything", and neither test is evidence without the other.
  const OVER = 21;
  const UNDER = 18;

  it("refuses to COUNT one, rather than answering from a partial walk", () => {
    expect(() => countNodes(sharedChain(OVER))).toThrow(ForestTooLargeError);
  });

  it("refuses to MEASURE ITS DEPTH for the same reason", () => {
    expect(() => treeDepth(sharedChain(OVER))).toThrow(ForestTooLargeError);
  });

  it("refuses to SIZE one instead of raising a native string-length error", () => {
    /*
     * `JSON.stringify` expands a shared node into a copy per path that reaches
     * it, so the string grows with entries rather than objects and stops with
     * `RangeError: Invalid string length` — an error naming a string length,
     * from the one function that decides whether a document may be stored.
     *
     * The assertion names the type rather than merely requiring a throw:
     * without it the RangeError this replaced would satisfy the test.
     */
    expect(() => documentBytes(page(sharedChain(OVER)))).toThrow(
      ForestTooLargeError
    );
    let raised: unknown;
    try {
      documentBytes(page(sharedChain(OVER)));
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ForestTooLargeError);
    expect(raised).not.toBeInstanceOf(RangeError);
  });

  it("says what to look for, since the caller's own nodes are rarely the cause", () => {
    // The message has to name the SHARING. "Too large" sends a reader to trim a
    // document that is already small, which is the wrong repair.
    expect(() => countNodes(sharedChain(OVER))).toThrow(/more than one parent/);
  });

  it("still answers for a shared forest UNDER the bound", () => {
    // The control for all four above. A bound set low enough to refuse
    // everything passes each of them, and this is what separates the two.
    expect(countNodes(sharedChain(UNDER))).toBe(2 ** (UNDER + 1) - 1);
    expect(treeDepth(sharedChain(UNDER))).toBe(UNDER + 1);
  });

  it("leaves an ordinary document alone, bound nowhere near it", () => {
    // The bound is a MACHINE one and must never fire on anything a product cap
    // would have allowed, so it is asserted against the product cap rather than
    // against a number chosen to agree with it.
    expect(MAX_WALKABLE_ENTRIES).toBeGreaterThan(MAX_NODES * 100);
    const ordinary = chain(50);
    expect(countNodes(ordinary)).toBe(51);
    expect(treeDepth(ordinary)).toBe(51);
    expect(documentBytes(page(ordinary))).toBeGreaterThan(0);
  });
});
