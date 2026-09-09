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

  it("translates the serializer's size failure, and only that one", () => {
    /*
     * The real trigger is a string longer than the engine can hold — 23 shared
     * objects reach it — and building one costs half a gigabyte, which is not
     * what a unit suite should spend to observe a translation. The FIXTURE
     * raises the same error the serializer raises, from inside the same call,
     * so the mechanism under test is exercised exactly.
     *
     * The second half is what makes the first mean anything: a cycle raises
     * `TypeError` and must pass THROUGH, because renaming an unrelated failure
     * into a size complaint sends a reader to shrink a document that is fine.
     */
    const sizeFailure = {
      id: "s",
      type: "core/box",
      version: 1,
      props: {},
      toJSON() {
        throw new RangeError("Invalid string length");
      },
    } as unknown as BlockNode;
    expect(() => documentBytes(page([sizeFailure]))).toThrow(
      ForestTooLargeError
    );
    expect(() => documentBytes(page([sizeFailure]))).toThrow(
      /longer than a string can hold/
    );

    const cyclic = { id: "c", type: "core/box", version: 1, props: {} } as {
      self?: unknown;
    } & BlockNode;
    cyclic.self = cyclic;
    let raised: unknown;
    try {
      documentBytes(page([cyclic]));
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(TypeError);
    expect(raised).not.toBeInstanceOf(ForestTooLargeError);
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
