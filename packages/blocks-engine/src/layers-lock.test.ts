/**
 * The Layers lock, applied: every op on a locked subtree, the one change a
 * locked block takes, undo and redo across a lock, and the system bypass.
 *
 * The fixture that separates the rule from a plausible half of it is a locked
 * SECTION with an unlocked child, beside an unlocked one: a rule that reads only
 * the addressed node's own flag passes every case on the section itself and
 * lets the child be edited, deleted, moved out, or joined by a new block.
 *
 * @module layers-lock.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "./document";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import {
  layersLockBreak,
  lockedAncestorOf,
  type LayersLockBreak,
} from "./layers-lock";
import { applyOp, applyOps, OpError, type BuilderOp } from "./ops";

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

/**
 * A locked section holding an unlocked caption and a deeper block, an
 * unlocked section holding a locked badge, and a loose block.
 */
function page(): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      node("locked-section", { locked: true }, [
        node("caption"),
        node("column", {}, [node("deep")]),
      ]),
      node("open-section", {}, [node("badge", { locked: true }), node("text")]),
      node("loose"),
    ],
  };
}

/** The refusal an op meets, or `undefined` when it applies. */
function refusal(document: BlockDocument, op: BuilderOp): string | undefined {
  try {
    applyOp(document, op);
    return undefined;
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
}

/** Every refusal must be the LOCK's, not some other rule the op tripped. */
function expectLockRefusal(
  document: BlockDocument,
  op: BuilderOp,
  lockedId: string
): void {
  const message = refusal(document, op);
  expect(message).toBeDefined();
  expect(message).toContain(`"${lockedId}"`);
  expect(message).toMatch(/locked/);
}

describe("an update on a locked subtree", () => {
  it("refuses changing the locked block itself, its name included", () => {
    expectLockRefusal(
      page(),
      { kind: "update", id: "locked-section", patch: { props: { a: 1 } } },
      "locked-section"
    );
    expectLockRefusal(
      page(),
      { kind: "update", id: "locked-section", patch: { name: "Hero" } },
      "locked-section"
    );
  });

  it("refuses changing a block inside it, at any depth", () => {
    expectLockRefusal(
      page(),
      { kind: "update", id: "caption", patch: { props: { text: "x" } } },
      "locked-section"
    );
    expectLockRefusal(
      page(),
      { kind: "update", id: "deep", patch: { name: "Renamed" } },
      "locked-section"
    );
  });

  it("refuses a patch that changes the lock AND something else", () => {
    // Bundling a change with the unlock in one op would make the exemption a
    // way round the lock for every edit.
    expectLockRefusal(
      page(),
      {
        kind: "update",
        id: "locked-section",
        patch: { name: "Hero" },
        unset: ["locked"],
      },
      "locked-section"
    );
  });

  it("allows the unlock, and a lock change inside a locked block", () => {
    expect(
      refusal(page(), {
        kind: "update",
        id: "locked-section",
        patch: {},
        unset: ["locked"],
      })
    ).toBeUndefined();
    expect(
      refusal(page(), {
        kind: "update",
        id: "caption",
        patch: { locked: true },
      })
    ).toBeUndefined();
  });

  it("allows changing a block AROUND a locked one, and an unrelated block", () => {
    // The control: a rule that refused every update would pass the refusals.
    expect(
      refusal(page(), {
        kind: "update",
        id: "open-section",
        patch: { props: { tone: "dark" } },
      })
    ).toBeUndefined();
    expect(
      refusal(page(), {
        kind: "update",
        id: "loose",
        patch: { name: "Footer" },
      })
    ).toBeUndefined();
  });
});

describe("a remove on a locked subtree", () => {
  it("refuses removing a block inside a locked one", () => {
    expectLockRefusal(
      page(),
      { kind: "remove", id: "caption" },
      "locked-section"
    );
    expectLockRefusal(page(), { kind: "remove", id: "deep" }, "locked-section");
  });

  it("refuses removing an unlocked block that holds a locked one", () => {
    expectLockRefusal(page(), { kind: "remove", id: "open-section" }, "badge");
  });

  it("allows removing a block no lock covers", () => {
    expect(refusal(page(), { kind: "remove", id: "text" })).toBeUndefined();
  });
});

describe("a move on a locked subtree", () => {
  it("refuses moving a block out of a locked one", () => {
    expectLockRefusal(
      page(),
      { kind: "move", id: "caption", to: { index: 0 } },
      "locked-section"
    );
  });

  it("refuses reordering inside a locked block", () => {
    expectLockRefusal(
      page(),
      {
        kind: "move",
        id: "caption",
        to: { parentId: "locked-section", slot: "children", index: 2 },
      },
      "locked-section"
    );
  });

  it("refuses moving an unlocked block that holds a locked one", () => {
    expectLockRefusal(
      page(),
      { kind: "move", id: "open-section", to: { index: 0 } },
      "badge"
    );
  });

  it("refuses moving a block INTO a locked one, or into a block inside it", () => {
    expectLockRefusal(
      page(),
      {
        kind: "move",
        id: "loose",
        to: { parentId: "locked-section", slot: "children", index: 0 },
      },
      "locked-section"
    );
    expectLockRefusal(
      page(),
      {
        kind: "move",
        id: "loose",
        to: { parentId: "column", slot: "children", index: 0 },
      },
      "locked-section"
    );
  });

  it("allows a move no lock covers", () => {
    expect(
      refusal(page(), {
        kind: "move",
        id: "text",
        to: { parentId: "open-section", slot: "children", index: 0 },
      })
    ).toBeUndefined();
  });
});

describe("an insert into a locked subtree", () => {
  it("refuses an insert into a locked block, or into a block inside it", () => {
    expectLockRefusal(
      page(),
      {
        kind: "insert",
        node: node("new"),
        at: { parentId: "locked-section", slot: "children", index: 0 },
      },
      "locked-section"
    );
    expectLockRefusal(
      page(),
      {
        kind: "insert",
        node: node("new"),
        at: { parentId: "column", slot: "children", index: 1 },
      },
      "locked-section"
    );
  });

  it("allows an insert beside a locked block", () => {
    expect(
      refusal(page(), {
        kind: "insert",
        node: node("new"),
        at: { parentId: "open-section", slot: "children", index: 0 },
      })
    ).toBeUndefined();
  });
});

describe("undo and redo across a lock", () => {
  it("takes an edit, then a lock, back in order, and replays them", () => {
    // Edit the caption, then lock the section around it. Each inverse runs
    // through the same apply, with no exemption, so every step has to be one
    // the lock allows when it runs.
    const edited = applyOp(page(), {
      kind: "update",
      id: "text",
      patch: { props: { text: "Hello" } },
    });
    const locked = applyOp(edited.document, {
      kind: "update",
      id: "open-section",
      patch: { locked: true },
    });
    // While the section is locked, the text inside it cannot change.
    expectLockRefusal(
      locked.document,
      { kind: "update", id: "text", patch: { props: { text: "Bye" } } },
      "open-section"
    );

    const unlockedAgain = applyOp(locked.document, locked.inverse);
    const original = applyOp(unlockedAgain.document, edited.inverse);
    expect(original.document).toEqual(page());

    // Redo replays in the order the edits were made: the edit, then the lock.
    const redoneEdit = applyOp(original.document, original.inverse);
    const redoneLock = applyOp(redoneEdit.document, unlockedAgain.inverse);
    expect(redoneLock.document).toEqual(locked.document);
  });

  it("undoes an unlock and a change made after it, in one group", () => {
    // Unlock-then-change as one group is what an author's single save of both
    // amounts to in the editor: the unlock lands first, so the change is
    // allowed, and the group's undo puts both back.
    const group = applyOps(page(), [
      { kind: "update", id: "locked-section", patch: {}, unset: ["locked"] },
      { kind: "update", id: "caption", patch: { props: { text: "x" } } },
    ]);
    const undone = applyOps(group.document, group.inverses);
    expect(undone.document).toEqual(page());
  });

  it("undoes a removal from a block locked after it", () => {
    // Remove a block, then lock the section it sat in. Putting it back while
    // the section is locked is refused; undoing the lock first, as the history
    // does, lets the removal's undo through.
    const removed = applyOp(page(), { kind: "remove", id: "text" });
    const sectionLocked = applyOp(removed.document, {
      kind: "update",
      id: "open-section",
      patch: { locked: true },
    });
    expectLockRefusal(sectionLocked.document, removed.inverse, "open-section");
    const unlocked = applyOp(sectionLocked.document, sectionLocked.inverse);
    expect(applyOp(unlocked.document, removed.inverse).document).toEqual(
      page()
    );
  });
});

describe("the system bypass", () => {
  it('applies an op the lock refuses when told { layersLocks: "ignore" }', () => {
    const op: BuilderOp = {
      kind: "update",
      id: "caption",
      patch: { props: { text: "x" } },
    };
    expect(() => applyOp(page(), op)).toThrow(OpError);
    const applied = applyOp(page(), op, undefined, { layersLocks: "ignore" });
    expect(applied.document.nodes[0].slots?.children[0].props).toEqual({
      text: "x",
    });
    expect(() =>
      applyOps(page(), [op], undefined, { layersLocks: "ignore" })
    ).not.toThrow();
  });

  it("round-trips a bypassed remove of a locked block through its inverse", () => {
    // The inverse puts back a subtree that arrives locked. With the lock
    // ignored for the remove, the same option lets its undo through, so a
    // system transform can always be undone the way it was applied.
    const ignore = { layersLocks: "ignore" } as const;
    const removed = applyOp(
      page(),
      { kind: "remove", id: "locked-section" },
      undefined,
      ignore
    );
    const restored = applyOp(
      removed.document,
      removed.inverse,
      undefined,
      ignore
    );
    expect(restored.document).toEqual(page());

    // Without it, a subtree arriving locked is still refused.
    expect(() => applyOp(removed.document, removed.inverse)).toThrow(
      /arrives locked/
    );
  });

  it("enforces the lock for any other option value", () => {
    // Only the exact string lifts it, so a mistyped option fails closed.
    const op: BuilderOp = { kind: "remove", id: "caption" };
    expect(() => applyOp(page(), op, undefined, {})).toThrow(OpError);
    expect(() =>
      applyOp(page(), op, undefined, {
        layersLocks: "IGNORE" as unknown as "ignore",
      })
    ).toThrow(OpError);
  });
});

describe("layersLockBreak and lockedAncestorOf", () => {
  it("say where the lock sits relative to the op", () => {
    const nodes = page().nodes;
    const cases: [BuilderOp, LayersLockBreak][] = [
      [
        { kind: "update", id: "locked-section", patch: { name: "x" } },
        { lockedId: "locked-section", where: "within" },
      ],
      [
        { kind: "remove", id: "open-section" },
        { lockedId: "badge", where: "within" },
      ],
      [
        { kind: "remove", id: "deep" },
        { lockedId: "locked-section", where: "around" },
      ],
      [
        {
          kind: "insert",
          node: node("new"),
          at: { parentId: "column", slot: "children", index: 0 },
        },
        { lockedId: "locked-section", where: "destination" },
      ],
    ];
    for (const [op, expected] of cases) {
      expect(layersLockBreak(nodes, op)).toEqual(expected);
    }
    expect(
      layersLockBreak(nodes, { kind: "remove", id: "text" })
    ).toBeUndefined();
    expect(
      layersLockBreak(nodes, { kind: "remove", id: "missing" })
    ).toBeUndefined();
  });

  it("finds the nearest locked block around a node, not the node itself", () => {
    const nodes = page().nodes;
    expect(lockedAncestorOf(nodes, "deep")?.id).toBe("locked-section");
    expect(lockedAncestorOf(nodes, "locked-section")).toBeUndefined();
    expect(lockedAncestorOf(nodes, "badge")).toBeUndefined();
  });
});
