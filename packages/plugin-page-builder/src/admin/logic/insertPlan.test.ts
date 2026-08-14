import { describe, expect, it } from "vitest";

import { createBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockDefinition, BlockNode } from "../../core/types";

import { canDrop } from "./dropRules";
import { planInsert } from "./insertPlan";

/**
 * The library's Insert button reaches the same verdict a drag does.
 *
 * Written against definitions declared here rather than the real catalog so a change to what
 * `core/columns` admits cannot quietly turn a case into a different one — the property is about
 * the WALK, and it has to hold for any restriction, not the one the catalog happens to carry.
 */
const def = (
  type: string,
  extra: Partial<BlockDefinition> = {}
): BlockDefinition => ({
  type,
  version: 1,
  label: type,
  icon: "Square",
  category: "layout",
  defaultProps: {},
  render: () => null,
  ...extra,
});

const registry = createBlockRegistry();
registry.register(
  def("test/page", { isContainer: true, slots: [{ name: "default" }] })
);
registry.register(
  def("test/box", { isContainer: true, slots: [{ name: "default" }] })
);
registry.register(
  def("test/row", {
    isContainer: true,
    slots: [{ name: "default", allowedBlocks: ["test/cell"] }],
  })
);
registry.register(
  def("test/cell", { isContainer: true, slots: [{ name: "default" }] })
);
registry.register(
  def("test/aside", { isContainer: true, slots: [{ name: "sidebar" }] })
);
registry.register(def("test/text"));

const node = (
  type: string,
  slots?: Record<string, BlockNode[]>,
  id?: string
): BlockNode => {
  const made = makeNode(type, {}, undefined, slots);
  return id ? { ...made, id } : made;
};

describe("finding where an inserted block goes", () => {
  it("appends inside the selection when the selection accepts it", () => {
    const root = node("test/page", {
      default: [node("test/box", { default: [node("test/text")] }, "box")],
    });
    expect(planInsert(root, "box", "test/text", registry)).toEqual({
      parentId: "box",
      slot: "default",
      index: 1,
    });
  });

  it("passes the block up when the selection refuses it", () => {
    // The case the columns restriction creates: a row that only takes cells hands an ordinary
    // block to whatever holds the row, rather than refusing outright.
    const row = node("test/row", { default: [] }, "row");
    const root = node(
      "test/page",
      { default: [node("test/box"), row] },
      "page"
    );
    expect(planInsert(root, "row", "test/text", registry)).toEqual({
      parentId: "page",
      slot: "default",
      index: 2,
    });
  });

  it("lands directly after the branch it came out of, not at the far end", () => {
    const row = node("test/row", { default: [] }, "row");
    const root = node(
      "test/page",
      { default: [row, node("test/box"), node("test/box")] },
      "page"
    );
    // `row` is child 0, so the block becomes child 1 — beside what the author was looking at.
    expect(planInsert(root, "row", "test/text", registry)?.index).toBe(1);
  });

  it("puts an accepted child into the restricted slot itself", () => {
    const row = node("test/row", { default: [node("test/cell")] }, "row");
    const root = node("test/page", { default: [row] });
    expect(planInsert(root, "row", "test/cell", registry)).toEqual({
      parentId: "row",
      slot: "default",
      index: 1,
    });
  });

  it("climbs more than one level", () => {
    const inner = node("test/row", { default: [] }, "inner");
    const outer = node("test/row", { default: [] }, "outer");
    // A row inside a row: neither accepts text, so both are passed over.
    const root = node(
      "test/page",
      { default: [{ ...outer, slots: { default: [inner] } }] },
      "page"
    );
    expect(planInsert(root, "inner", "test/text", registry)?.parentId).toBe(
      "page"
    );
  });

  it("reports that there is nowhere rather than inserting out of sight", () => {
    // A root that takes only cells, selected: passing text upward runs out of ancestors, and the
    // honest answer is none — not "put it at the top of the page anyway".
    const root = node(
      "test/row",
      { default: [node("test/cell", {}, "cell")] },
      "root-row"
    );
    expect(planInsert(root, "root-row", "test/text", registry)).toBe(null);
    // And with nothing selected, which starts at the same refusing root.
    expect(planInsert(root, undefined, "test/text", registry)).toBe(null);
  });

  it("falls back to the root when nothing is selected", () => {
    const root = node("test/page", { default: [node("test/box")] }, "page");
    expect(planInsert(root, undefined, "test/text", registry)).toEqual({
      parentId: "page",
      slot: "default",
      index: 1,
    });
  });

  it("treats a stale selection as no selection", () => {
    const root = node("test/page", { default: [] }, "page");
    expect(planInsert(root, "gone", "test/text", registry)?.parentId).toBe(
      "page"
    );
  });

  it("does not carry a position out of a differently named slot", () => {
    // `sidebar` index 0 says nothing about where to sit among `default`'s children, so the
    // block appends instead of claiming a position it cannot have meant.
    const aside = node("test/aside", { sidebar: [] }, "aside");
    const root = node(
      "test/page",
      { default: [node("test/box"), node("test/box")] },
      "page"
    );
    const withAside: BlockNode = {
      ...root,
      slots: { default: [...(root.slots?.default ?? [])], sidebar: [aside] },
    };
    expect(planInsert(withAside, "aside", "test/text", registry)?.index).toBe(
      2
    );
  });

  it("never returns a target the drag path would refuse", () => {
    // The two paths agreeing is the whole point, so it is asserted against `canDrop` itself
    // rather than against a repeat of its rules.
    const row = node("test/row", { default: [] }, "row");
    const root = node("test/page", { default: [row] }, "page");
    for (const blockType of ["test/text", "test/cell", "test/row"]) {
      const target = planInsert(root, "row", blockType, registry);
      if (!target) continue;
      const parent = target.parentId === "page" ? "test/page" : "test/row";
      expect(canDrop(parent, target.slot, blockType, registry).ok).toBe(true);
    }
  });
});

describe("a block that restricts which parents it may sit under", () => {
  /**
   * Run against the REAL catalogue, because the property is about `core/column` specifically: the
   * synthetic registry above cannot carry a structural `parent`, which is declared beside the
   * block rather than on a definition handed to `createBlockRegistry`.
   */
  it("walks past a container that would accept it, to the one it belongs in", async () => {
    const { defaultBlockRegistry } = await import("../../core/registry");
    await import("../../render/blocks");

    const column = node("core/column", { default: [] }, "col");
    const root = node(
      "core/container",
      {
        default: [node("core/columns", { default: [column] }, "row")],
      },
      "page"
    );

    // The precondition that makes this test mean something: a column's own slot is unrestricted,
    // so a nearest-accepting search WOULD stop there without the parent rule.
    expect(
      canDrop("core/column", "default", "core/heading", defaultBlockRegistry).ok
    ).toBe(true);

    // Selecting the column and inserting another must produce a SIBLING, not a nested column.
    expect(
      planInsert(root, "col", "core/column", defaultBlockRegistry)
    ).toEqual({ parentId: "row", slot: "default", index: 1 });
  });

  it("reports nowhere when no ancestor is a permitted parent", async () => {
    const { defaultBlockRegistry } = await import("../../core/registry");
    await import("../../render/blocks");

    const root = node("core/container", { default: [] }, "page");
    expect(planInsert(root, "page", "core/column", defaultBlockRegistry)).toBe(
      null
    );
  });

  it("still places a block that restricts nothing", async () => {
    // The positive control: a rule that refused everything would satisfy both cases above.
    const { defaultBlockRegistry } = await import("../../core/registry");
    await import("../../render/blocks");

    const root = node("core/container", { default: [] }, "page");
    expect(
      planInsert(root, "page", "core/heading", defaultBlockRegistry)?.parentId
    ).toBe("page");
  });
});
