/**
 * The `turnInto` op: one block replaced by a block of another type under the
 * same id, in the same place, as ONE undoable edit.
 *
 * The properties a plausible implementation gets wrong: a block that lands at
 * the end of its list instead of where it was, an undo that does not restore
 * the block exactly, an op that survives being written down only in part, a
 * new block under a different id or one reusing an id the page holds, an
 * "edit" to the same type recorded as a turn, and a Layers lock that does not
 * hold.
 */
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { layersLockBreak } from "./layers-lock";
import { applyOp, applyOps, OpError, type BuilderOp } from "./ops";

function text(id: string, over: Partial<BlockNode> = {}): BlockNode {
  return {
    id,
    type: "core/text",
    version: 2,
    props: { text: "Words" },
    ...over,
  };
}

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** The section holding three texts; the middle one is turned. */
function sectionPage(): BlockDocument {
  return page([
    {
      id: "section",
      type: "core/section",
      version: 1,
      props: {},
      slots: { children: [text("a"), text("b"), text("c")] },
    },
  ]);
}

const HEADING: BlockNode = {
  id: "b",
  type: "core/heading",
  version: 1,
  props: { text: "Words", level: "h2" },
  name: "Intro",
};

const TURN: BuilderOp = { kind: "turnInto", id: "b", node: HEADING };

describe("the turnInto op", () => {
  it("puts the new block where the old one was, under its id", () => {
    const applied = applyOp(sectionPage(), TURN);
    const children = applied.document.nodes[0]?.slots?.children ?? [];
    expect(children.map(child => [child.id, child.type])).toEqual([
      ["a", "core/text"],
      ["b", "core/heading"],
      ["c", "core/text"],
    ]);
    expect(children[1]).toEqual(HEADING);
  });

  it("turns a top-level block in place too", () => {
    const applied = applyOp(page([text("x"), text("b"), text("y")]), TURN);
    expect(applied.document.nodes.map(node => node.type)).toEqual([
      "core/text",
      "core/heading",
      "core/text",
    ]);
  });

  it("is one undo step: its inverse puts the old block back exactly", () => {
    const before = sectionPage();
    const applied = applyOps(before, [TURN]);
    expect(applied.inverses).toHaveLength(1);
    expect(applied.inverses[0]).toEqual({
      kind: "turnInto",
      id: "b",
      node: text("b"),
    });
    const undone = applyOps(applied.document, applied.inverses);
    expect(undone.document).toEqual(before);
    // And redo is the inverse's inverse.
    const redone = applyOps(undone.document, undone.inverses);
    expect(redone.document).toEqual(applied.document);
  });

  it("replays the same from storage, inverse included", () => {
    const stored = JSON.parse(JSON.stringify(TURN)) as BuilderOp;
    const applied = applyOp(sectionPage(), stored);
    expect(applied.document).toEqual(applyOp(sectionPage(), TURN).document);
    const inverse = JSON.parse(JSON.stringify(applied.inverse)) as BuilderOp;
    expect(applyOp(applied.document, inverse).document).toEqual(sectionPage());
  });

  it("does not share the op's block with the document", () => {
    const node = structuredClone(HEADING);
    const applied = applyOp(sectionPage(), { kind: "turnInto", id: "b", node });
    node.props.text = "Changed later";
    expect(applied.document.nodes[0]?.slots?.children?.[1]?.props.text).toBe(
      "Words"
    );
  });

  it("refuses a block that is not in the document", () => {
    expect(() =>
      applyOp(sectionPage(), {
        ...TURN,
        id: "gone",
        node: { ...HEADING, id: "gone" },
      })
    ).toThrow(/no node with id "gone"/);
  });

  it("refuses a new block under another id", () => {
    expect(() =>
      applyOp(sectionPage(), { ...TURN, node: { ...HEADING, id: "other" } })
    ).toThrow(/keeps its id/);
  });

  it("refuses the same type, which is an update", () => {
    expect(() =>
      applyOp(sectionPage(), { ...TURN, node: text("b", { name: "x" }) })
    ).toThrow(/already a "core\/text"/);
  });

  it("refuses a new block holding an id the page already uses", () => {
    const node: BlockNode = {
      ...HEADING,
      type: "core/box",
      slots: { children: [text("c")] },
    };
    expect(() => applyOp(sectionPage(), { ...TURN, node })).toThrow(
      /^turnInto: .*already uses/
    );
  });

  it("refuses a malformed new block", () => {
    const node = { ...HEADING, version: 0 };
    expect(() => applyOp(sectionPage(), { ...TURN, node })).toThrow(OpError);
    expect(() => applyOp(sectionPage(), { ...TURN, node })).toThrow(
      /^turnInto: /
    );
  });

  describe("the Layers lock", () => {
    it("refuses a locked block", () => {
      const before = page([text("b", { locked: true })]);
      expect(() => applyOp(before, TURN)).toThrow(/locked/);
      expect(layersLockBreak(before.nodes, TURN)).toEqual({
        lockedId: "b",
        where: "within",
      });
    });

    it("refuses a block inside a locked one", () => {
      const before = sectionPage();
      const section = before.nodes[0] as BlockNode;
      section.locked = true;
      expect(() => applyOp(before, TURN)).toThrow(/locked/);
      expect(layersLockBreak(before.nodes, TURN)).toEqual({
        lockedId: "section",
        where: "around",
      });
    });

    it("refuses a new block that arrives locked, since its undo could not run", () => {
      expect(() =>
        applyOp(sectionPage(), { ...TURN, node: { ...HEADING, locked: true } })
      ).toThrow(/arrives locked/);
    });

    it("stands down for a system transform", () => {
      const before = page([text("b", { locked: true })]);
      const node = { ...HEADING, locked: true };
      const applied = applyOp(before, { ...TURN, node }, undefined, {
        layersLocks: "ignore",
      });
      expect(applied.document.nodes[0]?.type).toBe("core/heading");
    });
  });
});
