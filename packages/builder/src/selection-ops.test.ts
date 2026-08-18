/**
 * Delete, duplicate and lock across a selection.
 *
 * The case this file exists for is **duplicate order**. Every other property
 * here is the single-block rule asked more than once, and those rules have
 * their own tests; what is only true when there is a GROUP is that inserting
 * each copy beside its original shifts the positions still to be used, so the
 * plan is only correct in reverse.
 *
 * The order is asserted by APPLYING the ops rather than by reading them, since
 * a plan that looks right and lands wrong is the entire failure mode.
 *
 * @module selection-ops.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { applyOp, type BuilderOp } from "./ops";
import {
  isRefusal,
  selectionDeletion,
  selectionDuplication,
  selectionLock,
} from "./selection-ops";

afterEach(clearBlocks);

function register() {
  if (hasBlock("acme/leaf")) return;
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };
  registerBlocks(
    [
      { ...base, name: "acme/leaf", editor: { label: "Leaf" } },
      {
        ...base,
        name: "acme/box",
        editor: { label: "Box" },
        slots: { children: {} },
      },
    ] as never,
    { source: "selection-ops-test" }
  );
}

function node(id: string, extra: Partial<BlockNode> = {}): BlockNode {
  return {
    id,
    type: "acme/leaf",
    version: 1,
    props: {},
    ...extra,
  } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** Apply a planned group the way the store does, and report the top-level ids. */
function afterApplying(
  document: BlockDocument,
  ops: readonly BuilderOp[]
): string[] {
  let working = document;
  for (const op of ops) working = applyOp(working, op).document;
  return working.nodes.map(n => n.id);
}

describe("selectionDeletion", () => {
  it("plans nothing for an empty selection", () => {
    register();
    expect(selectionDeletion(documentOf([node("a")]), [])).toBeNull();
  });

  it("removes every selected block", () => {
    register();
    const document = documentOf([node("a"), node("b"), node("c")]);
    const plan = selectionDeletion(document, ["a", "c"]);
    if (plan === null || isRefusal(plan)) throw new Error("expected a plan");

    expect(afterApplying(document, plan.ops)).toEqual(["b"]);
  });

  it("refuses the WHOLE group when any block is locked", () => {
    /*
     * Follows from the group being atomic rather than from a separate policy:
     * there is no half-done delete to fall back to. Silently skipping the
     * locked one would leave an author who selected three blocks looking at one
     * they did not notice surviving.
     */
    register();
    const document = documentOf([
      node("a"),
      node("b", { locked: true, name: "Pinned" }),
    ]);

    const plan = selectionDeletion(document, ["a", "b"]);

    expect(isRefusal(plan)).toBe(true);
    expect(isRefusal(plan) ? plan.reason : "").toBe(
      "Pinned is locked. Unlock it to delete it."
    );
  });

  it("refuses for a lock INSIDE a selected container, naming it", () => {
    register();
    const document = documentOf([
      node("box", {
        type: "acme/box",
        slots: { children: [node("kid", { locked: true, name: "Caption" })] },
      } as Partial<BlockNode>),
    ]);

    const plan = selectionDeletion(document, ["box"]);

    expect(isRefusal(plan) ? plan.reason : "").toBe(
      "The selection contains Caption, which is locked. Unlock it to delete."
    );
  });

  it("names one block by its own name and several by a count", () => {
    register();
    const document = documentOf([node("a", { name: "Hero" }), node("b")]);

    const one = selectionDeletion(document, ["a"]);
    const two = selectionDeletion(document, ["a", "b"]);

    expect(!isRefusal(one) && one !== null ? one.subject : "").toBe("Hero");
    expect(!isRefusal(two) && two !== null ? two.subject : "").toBe("2 blocks");
  });
});

describe("selectionDuplication", () => {
  it("puts every copy immediately after its own original", () => {
    /*
     * THE case. Each insert shifts every later sibling along, so a plan built
     * in document order computes the second copy's position against a document
     * the first copy has already changed — and the second lands in the wrong
     * place. Asserted by APPLYING the ops, because a plan that reads correctly
     * and lands wrongly is the whole failure mode.
     */
    register();
    const document = documentOf([node("a"), node("b"), node("c")]);
    const plan = selectionDuplication(document, ["a", "b", "c"]);
    if (plan === null) throw new Error("expected a plan");

    const after = afterApplying(document, plan.ops);

    // Six blocks, and every copy sits directly after the block it came from.
    expect(after).toHaveLength(6);
    expect(after[0]).toBe("a");
    expect(after[2]).toBe("b");
    expect(after[4]).toBe("c");
    expect(after[1]).toBe(plan.newIds[0]);
    expect(after[3]).toBe(plan.newIds[1]);
    expect(after[5]).toBe(plan.newIds[2]);
  });

  it("reports the copies in DOCUMENT order though it plans in reverse", () => {
    // A caller selecting the copies afterwards wants them the way a reader
    // meets them, not the way they were planned.
    register();
    const document = documentOf([node("a"), node("b")]);
    const plan = selectionDuplication(document, ["a", "b"]);
    if (plan === null) throw new Error("expected a plan");

    const after = afterApplying(document, plan.ops);

    expect(after.indexOf(plan.newIds[0] ?? "")).toBeLessThan(
      after.indexOf(plan.newIds[1] ?? "")
    );
  });

  it("is NOT refused by a lock, and the copies carry it", () => {
    // Duplicating neither moves nor removes the original. Refusing would mean
    // an author could not copy the blocks they had most deliberately protected.
    register();
    const document = documentOf([node("a", { locked: true })]);

    const plan = selectionDuplication(document, ["a"]);

    expect(plan).not.toBeNull();
    expect(plan?.ops).toHaveLength(1);
  });

  it("plans nothing for an empty selection", () => {
    register();
    expect(selectionDuplication(documentOf([node("a")]), [])).toBeNull();
  });
});

describe("selectionLock", () => {
  it("locks every selected block", () => {
    register();
    const document = documentOf([node("a"), node("b")]);

    const plan = selectionLock(document, ["a", "b"], true);

    expect(plan?.ops).toEqual([
      { kind: "update", id: "a", patch: { locked: true } },
      { kind: "update", id: "b", patch: { locked: true } },
    ]);
  });

  it("unlocks by UNSETTING rather than storing false", () => {
    // `false` would be a second spelling of a state the absent field already
    // means, and the two would have to be kept in step forever.
    register();
    const document = documentOf([node("a", { locked: true })]);

    expect(selectionLock(document, ["a"], false)?.ops).toEqual([
      { kind: "update", id: "a", patch: {}, unset: ["locked"] },
    ]);
  });
});

describe("normalisation applies to all three", () => {
  it("acts on the container once, not on it AND its selected child", () => {
    /*
     * The control that the shared rule is actually being asked. Without it a
     * delete would remove the child with its parent and then again from a
     * document that no longer has it — which the atomic group turns into a
     * refusal of the whole edit rather than a partial one.
     */
    register();
    const document = documentOf([
      node("box", {
        type: "acme/box",
        slots: { children: [node("kid")] },
      } as Partial<BlockNode>),
    ]);

    const deletion = selectionDeletion(document, ["box", "kid"]);
    const duplication = selectionDuplication(document, ["box", "kid"]);
    const lock = selectionLock(document, ["box", "kid"], true);

    expect(
      !isRefusal(deletion) && deletion !== null ? deletion.ops : []
    ).toHaveLength(1);
    expect(duplication?.ops).toHaveLength(1);
    expect(lock?.ops).toHaveLength(1);
  });
});
