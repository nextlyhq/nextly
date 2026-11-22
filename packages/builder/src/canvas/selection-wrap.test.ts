import {
  applyOps,
  clearBlocks,
  registerBlocks,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isRefusal } from "./selection-ops";
import {
  isUnwrappable,
  planUnwrap,
  planWrap,
  WRAP_WORDS,
} from "./selection-wrap";

beforeAll(() => {
  registerBlocks(coreBlocks as never, { source: "selection-wrap-test" });
});

afterAll(() => {
  clearBlocks();
});

const nesting = () => registryNestingSource();

const text = (id: string): BlockNode => ({
  id,
  type: "core/text",
  version: 2,
  props: {},
});

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

/** The document a plan leaves, as type and id outlines. */
function after(
  document: BlockDocument,
  ops: Parameters<typeof applyOps>[1]
): unknown {
  const outline = (nodes: readonly BlockNode[]): unknown[] =>
    nodes.map(node => ({
      type: node.type,
      ...(node.type === "core/text" ? { id: node.id } : {}),
      ...(node.slots?.children === undefined
        ? {}
        : { children: outline(node.slots.children) }),
    }));
  return outline(applyOps(document, ops).document.nodes);
}

describe("planWrap", () => {
  it("puts the selected blocks in a new Box at their place, in reading order", () => {
    const document = page(text("a"), text("b"), text("c"), text("d"));
    // Selected out of order: the Box holds them as a reader meets them.
    const plan = planWrap(document, ["c", "b"], nesting());
    if (plan === null || isRefusal(plan)) throw new Error("no plan");
    expect(after(document, plan.ops)).toEqual([
      { type: "core/text", id: "a" },
      {
        type: "core/box",
        children: [
          { type: "core/text", id: "b" },
          { type: "core/text", id: "c" },
        ],
      },
      { type: "core/text", id: "d" },
    ]);
    expect(plan.select).toHaveLength(1);
  });

  it("refuses blocks that are not side by side in one place", () => {
    const document = page(text("a"), {
      id: "box",
      type: "core/box",
      version: 1,
      props: {},
      slots: { children: [text("in")] },
    });
    expect(planWrap(document, ["a", "in"], nesting())).toEqual({
      reason: WRAP_WORDS.notSideBySide,
    });
  });

  it("refuses blocks with an unselected block between them, keeping the reading order", () => {
    // Wrapping a and c would carry c ahead of b, which stays outside.
    const document = page(text("a"), text("b"), text("c"));
    expect(planWrap(document, ["a", "c"], nesting())).toEqual({
      reason: WRAP_WORDS.notSideBySide,
    });
  });

  it("refuses to wrap a Column, since a Box cannot sit inside Columns", () => {
    const document = page({
      id: "row",
      type: "core/columns",
      version: 1,
      props: {},
      slots: {
        children: [
          {
            id: "c1",
            type: "core/column",
            version: 1,
            props: {},
            slots: { children: [] },
          },
          {
            id: "c2",
            type: "core/column",
            version: 1,
            props: {},
            slots: { children: [] },
          },
        ],
      },
    });
    const plan = planWrap(document, ["c1"], nesting());
    expect(plan !== null && isRefusal(plan)).toBe(true);
    // Why, and what that place takes instead.
    const reason = plan !== null && isRefusal(plan) ? plan.reason : "";
    expect(reason).toMatch(/Box/);
    expect(reason).toMatch(/Column/);
  });
});

describe("planUnwrap", () => {
  it.each(["core/box", "core/section", "core/card"])(
    "moves a %s's blocks to its place, in order, and removes it",
    type => {
      const document = page(
        text("before"),
        {
          id: "outer",
          type,
          version: 1,
          props: {},
          slots: { children: [text("x"), text("y")] },
        },
        text("after")
      );
      const plan = planUnwrap(document, "outer", nesting());
      if (plan === null || isRefusal(plan)) throw new Error("no plan");
      expect(after(document, plan.ops)).toEqual([
        { type: "core/text", id: "before" },
        { type: "core/text", id: "x" },
        { type: "core/text", id: "y" },
        { type: "core/text", id: "after" },
      ]);
      expect(plan.select).toEqual(["x", "y"]);
    }
  );

  it("unwraps a Column inside Columns where its blocks may sit there, and refuses where they may not", () => {
    const columns = (inner: BlockNode[]): BlockDocument =>
      page({
        id: "row",
        type: "core/columns",
        version: 1,
        props: {},
        slots: {
          children: [
            {
              id: "c1",
              type: "core/column",
              version: 1,
              props: {},
              slots: { children: inner },
            },
          ],
        },
      });
    // A Text cannot sit directly in Columns: refused, with the reason.
    const refused = planUnwrap(columns([text("t")]), "c1", nesting());
    expect(refused !== null && isRefusal(refused)).toBe(true);
  });

  it("is offered on Box, Section, Column and Card, and not on Columns, Accordion, Gallery or Collection list", () => {
    const node = (type: string): BlockNode => ({
      id: "n",
      type,
      version: 1,
      props: {},
    });
    for (const type of [
      "core/box",
      "core/section",
      "core/column",
      "core/card",
    ]) {
      expect(isUnwrappable(node(type)), type).toBe(true);
    }
    for (const type of [
      "core/columns",
      "core/accordion",
      "core/gallery",
      "core/collection-loop",
    ]) {
      expect(isUnwrappable(node(type)), type).toBe(false);
      expect(planUnwrap(page(node(type)), "n", nesting()), type).toBeNull();
    }
  });
});
