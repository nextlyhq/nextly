/**
 * Every assertion here reads the outcome's KIND, and a refusal also reads its REASON.
 *
 * Asserting only that no action came back would not separate these cases: a refused drop, a no-op
 * and an unresolvable target are all "nothing to dispatch", so a test written that way passes on
 * an implementation that has confused any one of them with the other two — and the distinction
 * each case exists to pin is the one thing it cannot see.
 */
import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import "../../render/blocks"; // register core blocks

import { planDrop } from "./dropPlan";

function tree(): BlockNode {
  const a = makeNode("core/heading", { text: "A" });
  const b = makeNode("core/paragraph", { text: "B" });
  const c = makeNode("core/button", { text: "C" });
  return makeNode("core/container", {}, undefined, { default: [a, b, c] });
}

const reg = defaultBlockRegistry;

describe("planDrop", () => {
  it("plans an ADD from the library at the target index", () => {
    const root = tree();
    const outcome = planDrop(
      { kind: "library", blockType: "core/heading" },
      { kind: "dropzone", parentId: root.id, slot: "default", index: 1 },
      root,
      reg
    );
    expect(outcome).toEqual({
      kind: "action",
      action: {
        type: "ADD",
        parentId: root.id,
        slot: "default",
        nodeType: "core/heading",
        index: 1,
      },
    });
  });

  it("plans a MOVE and adjusts the index for a downward same-slot move", () => {
    const root = tree();
    const a = root.slots!.default![0]; // index 0
    // drop A into gap index 3 (after C) → after removal, target becomes 2
    const outcome = planDrop(
      { kind: "node", nodeId: a.id },
      { kind: "dropzone", parentId: root.id, slot: "default", index: 3 },
      root,
      reg
    );
    expect(outcome).toEqual({
      kind: "action",
      action: {
        type: "MOVE",
        id: a.id,
        parentId: root.id,
        slot: "default",
        index: 2,
      },
    });
  });

  it("does not adjust the index for an upward same-slot move", () => {
    const root = tree();
    const c = root.slots!.default![2]; // index 2
    // drop C into gap index 0 (before A)
    const outcome = planDrop(
      { kind: "node", nodeId: c.id },
      { kind: "dropzone", parentId: root.id, slot: "default", index: 0 },
      root,
      reg
    );
    expect(outcome).toEqual({
      kind: "action",
      action: {
        type: "MOVE",
        id: c.id,
        parentId: root.id,
        slot: "default",
        index: 0,
      },
    });
  });

  describe("the three outcomes that are not an action", () => {
    /**
     * The point of the group: one fixture reaches each of them, and every assertion below names a
     * DIFFERENT kind. An implementation that collapsed any two would fail here rather than pass
     * three tests with one value.
     */
    it("REFUSES an ADD into a non-container, and says which rule", () => {
      const root = tree();
      const heading = root.slots!.default![0];
      expect(
        planDrop(
          { kind: "library", blockType: "core/paragraph" },
          { kind: "dropzone", parentId: heading.id, slot: "default", index: 0 },
          root,
          reg
        )
      ).toEqual({ kind: "refused", reason: "not-a-container" });
    });

    it("REFUSES a block the container's slot does not admit, and says which rule", () => {
      // `core/columns` admits only `core/column`, so a heading aimed at it is refused by the
      // slot's allowlist rather than by the container being unable to hold children at all —
      // a different reason, and the author's remedy differs with it.
      const columns = makeNode("core/columns", {}, undefined, { default: [] });
      const root = makeNode("core/container", {}, undefined, {
        default: [columns],
      });
      expect(
        planDrop(
          { kind: "library", blockType: "core/heading" },
          { kind: "dropzone", parentId: columns.id, slot: "default", index: 0 },
          root,
          reg
        )
      ).toEqual({ kind: "refused", reason: "not-allowed-in-slot" });
    });

    it("REFUSES dropping a container into its own descendant", () => {
      const innerC = makeNode("core/container", {}, undefined, { default: [] });
      const outer = makeNode("core/container", {}, undefined, {
        default: [innerC],
      });
      const root = makeNode("core/container", {}, undefined, {
        default: [outer],
      });
      expect(
        planDrop(
          { kind: "node", nodeId: outer.id },
          { kind: "dropzone", parentId: innerC.id, slot: "default", index: 0 },
          root,
          reg
        )
      ).toEqual({ kind: "refused", reason: "into-itself" });
    });

    it("reports a drop adjacent to the source as UNCHANGED, not refused", () => {
      const root = tree();
      const b = root.slots!.default![1]; // index 1
      // gap index 1 (before B) and gap index 2 (after B) both land B where it already is
      for (const index of [1, 2]) {
        expect(
          planDrop(
            { kind: "node", nodeId: b.id },
            { kind: "dropzone", parentId: root.id, slot: "default", index },
            root,
            reg
          )
        ).toEqual({ kind: "unchanged" });
      }
    });

    it("reports a target the document does not hold as UNRESOLVED, not refused", () => {
      const root = tree();
      expect(
        planDrop(
          { kind: "library", blockType: "core/heading" },
          {
            kind: "dropzone",
            parentId: "no-such-node",
            slot: "default",
            index: 0,
          },
          root,
          reg
        )
      ).toEqual({ kind: "unresolved" });
    });

    it("reports a drag that ended off any drop zone as UNRESOLVED", () => {
      const root = tree();
      expect(
        planDrop({ kind: "library", blockType: "core/heading" }, {}, root, reg)
      ).toEqual({ kind: "unresolved" });
    });
  });
});
