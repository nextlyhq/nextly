/**
 * Whether the editor may move or delete a block the author has locked.
 *
 * The fixture that separates a correct rule from a plausible one is a container
 * holding a locked CHILD: a rule that checks only the node passes every
 * single-block case and loses the locked child the moment someone deletes what
 * it sits in.
 *
 * @module locking.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { isLocked, lockBlockingDelete, lockBlockingMove } from "./locking";

function node(
  id: string,
  extra: Partial<BlockNode> = {},
  children?: BlockNode[]
): BlockNode {
  return {
    id,
    type: "acme/block",
    version: 1,
    props: {},
    ...(children ? { slots: { children } } : {}),
    ...extra,
  } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** A section holding a locked caption, plus an unlocked sibling. */
function withLockedChild(): BlockDocument {
  return documentOf([
    node("section", {}, [node("caption", { locked: true })]),
    node("loose"),
  ]);
}

describe("isLocked", () => {
  it("reads the flag, and treats absent as unlocked", () => {
    // `locked` is optional, so most nodes never carry it. Reading a missing
    // field as locked would freeze an entire document written before the flag
    // existed.
    expect(isLocked(node("a", { locked: true }))).toBe(true);
    expect(isLocked(node("b", { locked: false }))).toBe(false);
    expect(isLocked(node("c"))).toBe(false);
  });
});

describe("lockBlockingMove", () => {
  it("refuses to move the locked node itself", () => {
    expect(lockBlockingMove(withLockedChild(), "caption")?.id).toBe("caption");
  });

  it("ALLOWS moving a container that holds a locked child", () => {
    // The separating case, and the direction that is easy to get wrong by being
    // cautious. Moving the section leaves the caption in the same slot at the
    // same index with the same neighbours, so nothing the lock protects has
    // changed — and refusing would let one locked caption freeze the whole
    // section around it.
    expect(lockBlockingMove(withLockedChild(), "section")).toBeUndefined();
  });

  it("allows an ordinary node, and reports nothing for an id the document lost", () => {
    // The control: without it, "returns undefined" would be satisfied by a
    // function that always does.
    expect(lockBlockingMove(withLockedChild(), "loose")).toBeUndefined();
    expect(lockBlockingMove(withLockedChild(), "gone")).toBeUndefined();
  });
});

describe("lockBlockingDelete", () => {
  it("refuses to delete the locked node itself", () => {
    expect(lockBlockingDelete(withLockedChild(), "caption")?.id).toBe(
      "caption"
    );
  });

  it("REFUSES to delete a container that holds a locked child", () => {
    // THE case. Deleting the section destroys the caption, which is the one
    // outcome the flag exists to prevent — and it would happen through an
    // action aimed at something else.
    expect(lockBlockingDelete(withLockedChild(), "section")?.id).toBe(
      "caption"
    );
  });

  it("finds a lock nested several levels down", () => {
    const document = documentOf([
      node("outer", {}, [node("middle", {}, [node("deep", { locked: true })])]),
    ]);

    expect(lockBlockingDelete(document, "outer")?.id).toBe("deep");
  });

  it("names the OUTERMOST lock when a subtree holds more than one", () => {
    // The refusal has to name something an author can act on, and the deepest
    // match is the least likely to be the one they meant.
    const document = documentOf([
      node("outer", {}, [
        node("middle", { locked: true }, [node("deep", { locked: true })]),
      ]),
    ]);

    expect(lockBlockingDelete(document, "outer")?.id).toBe("middle");
  });

  it("allows deleting a container whose children are all unlocked", () => {
    // The control for every refusal above: a rule that refused everything would
    // satisfy them all.
    const document = documentOf([node("outer", {}, [node("child")])]);

    expect(lockBlockingDelete(document, "outer")).toBeUndefined();
  });
});
