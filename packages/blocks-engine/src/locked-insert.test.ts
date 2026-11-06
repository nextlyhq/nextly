/**
 * A copy put into a document keeps the Layers locks it carries, and its undo
 * still takes it out.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import { insertKeepingLocks } from "./locked-insert";
import { applyOps, OpError } from "./ops";
import type { BlockNode } from "./document";

function node(
  id: string,
  extra: Partial<BlockNode> = {},
  children?: BlockNode[]
): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(children === undefined ? {} : { slots: { children } }),
    ...extra,
  };
}

const pageOf = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

describe("insertKeepingLocks", () => {
  it("puts a locked subtree in locked where it lands, and undoes to the page before", () => {
    const page = pageOf([node("a")]);
    const copy = node("b", { locked: true }, [node("b1", { locked: true })]);

    const applied = applyOps(
      page,
      insertKeepingLocks([{ node: copy, at: { index: 1 } }])
    );

    expect(applied.document.nodes[1]).toEqual(copy);
    expect(applyOps(applied.document, applied.inverses).document).toEqual(page);
  });

  it("is what makes the copy placeable: the lock carried on the insert is refused", () => {
    const page = pageOf([node("a")]);
    const copy = node("b", { locked: true });

    expect(() =>
      applyOps(page, [{ kind: "insert", node: copy, at: { index: 1 } }])
    ).toThrow(OpError);
  });

  it("still refuses a copy put into a locked block", () => {
    const page = pageOf([node("a", { locked: true }, [])]);

    expect(() =>
      applyOps(
        page,
        insertKeepingLocks([
          {
            node: node("b", { locked: true }),
            at: { parentId: "a", slot: "children", index: 0 },
          },
        ])
      )
    ).toThrow(OpError);
  });
});
