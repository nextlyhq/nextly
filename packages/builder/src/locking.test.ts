/**
 * Whether the editor may change, move or delete a block the author has locked.
 *
 * Two fixtures separate a correct rule from a plausible one. A container
 * holding a locked CHILD: a rule that checks only the node passes every
 * single-block case and loses the locked child the moment someone deletes or
 * moves what it sits in. And an unlocked child INSIDE a locked container: a
 * rule that reads only the node's own flag lets it be changed, moved out or
 * deleted, though the lock covers it.
 *
 * @module locking.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import {
  isLocked,
  lockBlockingDelete,
  lockBlockingEdit,
  lockBlockingMove,
  lockedAncestorOf,
} from "./locking";

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

/** A locked section holding an unlocked column with a block in it. */
function withLockedParent(): BlockDocument {
  return documentOf([
    node("hero", { locked: true }, [node("column", {}, [node("title")])]),
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

  it("REFUSES moving a container that holds a locked child", () => {
    // A lock means the block does not move until it is unlocked, and moving
    // the section moves the caption with it. The op layer refuses the move, so
    // the editor has to refuse it before offering it, naming the caption.
    expect(lockBlockingMove(withLockedChild(), "section")?.id).toBe("caption");
  });

  it("refuses moving a block out of a locked container, at any depth", () => {
    expect(lockBlockingMove(withLockedParent(), "column")?.id).toBe("hero");
    expect(lockBlockingMove(withLockedParent(), "title")?.id).toBe("hero");
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

  it("refuses deleting a block out of a locked container", () => {
    expect(lockBlockingDelete(withLockedParent(), "title")?.id).toBe("hero");
  });

  it("allows deleting a container whose children are all unlocked", () => {
    // The control for every refusal above: a rule that refused everything would
    // satisfy them all.
    const document = documentOf([node("outer", {}, [node("child")])]);

    expect(lockBlockingDelete(document, "outer")).toBeUndefined();
  });
});

describe("lockBlockingEdit", () => {
  it("refuses changing the locked block itself, and any block inside it", () => {
    expect(lockBlockingEdit(withLockedParent(), "hero")?.id).toBe("hero");
    expect(lockBlockingEdit(withLockedParent(), "column")?.id).toBe("hero");
    expect(lockBlockingEdit(withLockedParent(), "title")?.id).toBe("hero");
  });

  it("allows changing a block AROUND a locked one, and an unrelated block", () => {
    // A section's own props are not inside its locked caption, so restyling
    // the section keeps the caption as it was.
    expect(lockBlockingEdit(withLockedChild(), "section")).toBeUndefined();
    expect(lockBlockingEdit(withLockedChild(), "loose")).toBeUndefined();
    expect(lockBlockingEdit(withLockedChild(), "gone")).toBeUndefined();
  });
});

describe("lockedAncestorOf", () => {
  it("names the nearest locked block around a node, never the node itself", () => {
    expect(lockedAncestorOf(withLockedParent(), "title")?.id).toBe("hero");
    expect(lockedAncestorOf(withLockedParent(), "hero")).toBeUndefined();
    expect(lockedAncestorOf(withLockedChild(), "caption")).toBeUndefined();
  });
});
