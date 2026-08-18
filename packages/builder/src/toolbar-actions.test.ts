/**
 * The toolbar's decisions, without a DOM.
 *
 * Two properties matter more than the rest and are asserted with controls
 * beside them. **A lock stops a move and a delete but not a duplicate**, and
 * **a lock INSIDE a block stops the delete without stopping the move** — those
 * two together are what separates "the toolbar asks the lock rules" from "the
 * toolbar reads `node.locked`", and only the second case can tell them apart.
 *
 * The placement cases exist here rather than in the component because every
 * rectangle jsdom reports is zero: a placement computed during render is a
 * placement no component test can see fail.
 *
 * @module toolbar-actions.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import {
  TOOLBAR_GAP_PX,
  toolbarActions,
  toolbarPlacement,
  type ToolbarAction,
  type ToolbarActionId,
} from "./toolbar-actions";

function node(
  id: string,
  type = "acme/heading",
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function box(
  id: string,
  children: BlockNode[],
  extra: Partial<BlockNode> = {}
) {
  return node(id, "acme/box", { slots: { children }, ...extra });
}

function actionOf(
  actions: ToolbarAction[],
  id: ToolbarActionId
): ToolbarAction {
  const found = actions.find(action => action.id === id);
  if (found === undefined) throw new Error(`no ${id} action`);
  return found;
}

describe("toolbarActions", () => {
  it("offers nothing without a selection", () => {
    expect(toolbarActions(documentOf([node("a")]), null)).toEqual([]);
  });

  it("offers nothing for an id the document no longer holds", () => {
    // An undo that removes the selected node while the selection stands is
    // routine. The bar is drawn against an element, and there is none.
    expect(toolbarActions(documentOf([node("a")]), "gone")).toEqual([]);
  });

  it("draws the same buttons in the same order whatever is selected", () => {
    // The bar keeping one shape is what lets an author aim at a button before
    // the selection has finished changing. A set that varied would move the
    // control they were reaching for.
    const document = documentOf([box("outer", [node("kid")]), node("last")]);
    const expected: ToolbarActionId[] = [
      "select-parent",
      "move-up",
      "move-down",
      "duplicate",
      "delete",
    ];

    for (const id of ["outer", "kid", "last"]) {
      expect(toolbarActions(document, id).map(a => a.id)).toEqual(expected);
    }
  });

  it("cannot select a parent from the top level, and can from inside one", () => {
    const document = documentOf([box("outer", [node("kid")])]);

    expect(
      actionOf(toolbarActions(document, "outer"), "select-parent").enabled
    ).toBe(false);
    expect(
      actionOf(toolbarActions(document, "kid"), "select-parent").enabled
    ).toBe(true);
  });

  it("refuses the move that would leave the container", () => {
    const document = documentOf([node("a"), node("b"), node("c")]);

    expect(actionOf(toolbarActions(document, "a"), "move-up").enabled).toBe(
      false
    );
    expect(actionOf(toolbarActions(document, "a"), "move-down").enabled).toBe(
      true
    );
    expect(actionOf(toolbarActions(document, "c"), "move-up").enabled).toBe(
      true
    );
    expect(actionOf(toolbarActions(document, "c"), "move-down").enabled).toBe(
      false
    );
  });

  it("says nothing about a move that is merely at the end of its container", () => {
    // A fact about the page the author can see. Explaining it on every
    // selection is noise, and it would train them to ignore the one reason that
    // does need reading.
    const document = documentOf([node("a"), node("b")]);

    expect(
      actionOf(toolbarActions(document, "a"), "move-up").reason
    ).toBeUndefined();
  });

  it("a lock stops the move and the delete, and says why", () => {
    const document = documentOf([
      node("a", "acme/heading", { locked: true }),
      node("b"),
    ]);
    const actions = toolbarActions(document, "a");

    expect(actionOf(actions, "move-down").enabled).toBe(false);
    expect(actionOf(actions, "move-down").reason).toBe("This block is locked.");
    expect(actionOf(actions, "delete").enabled).toBe(false);
    expect(actionOf(actions, "delete").reason).toBe("This block is locked.");
  });

  it("a lock does NOT stop a duplicate", () => {
    // Duplicating neither moves nor removes the original. Refusing would mean
    // an author could not copy the one block they had most deliberately
    // protected — and the keyboard duplicate already reads it this way.
    const document = documentOf([node("a", "acme/heading", { locked: true })]);

    expect(actionOf(toolbarActions(document, "a"), "duplicate").enabled).toBe(
      true
    );
  });

  it("a lock INSIDE a block stops its delete but not its move", () => {
    // THE case that separates asking the two lock rules from reading
    // `node.locked` once: delete destroys the subtree, a move carries it
    // intact. Both halves are asserted, so a toolbar that used one answer for
    // both fails here whichever answer it picked.
    const document = documentOf([
      box("outer", [node("kid", "acme/heading", { locked: true })]),
      node("after"),
    ]);
    const actions = toolbarActions(document, "outer");

    expect(actionOf(actions, "move-down").enabled).toBe(true);
    expect(actionOf(actions, "delete").enabled).toBe(false);
    expect(actionOf(actions, "delete").reason).toBe(
      "Heading inside this block is locked."
    );
  });

  it("names an inner lock by the author's name for it", () => {
    // Through the one label rule, so the toolbar cannot call a block something
    // the layers panel does not.
    const document = documentOf([
      box("outer", [
        node("kid", "acme/heading", { locked: true, name: "Caption" }),
      ]),
    ]);

    expect(actionOf(toolbarActions(document, "outer"), "delete").reason).toBe(
      "Caption inside this block is locked."
    );
  });

  it("offers duplicate and delete for an ordinary block", () => {
    // The control for the refusal cases above: they would all pass against a
    // toolbar that disabled everything.
    const document = documentOf([node("a")]);
    const actions = toolbarActions(document, "a");

    expect(actionOf(actions, "duplicate").enabled).toBe(true);
    expect(actionOf(actions, "delete").enabled).toBe(true);
    expect(actionOf(actions, "delete").reason).toBeUndefined();
  });
});

describe("toolbarPlacement", () => {
  const bar = { width: 200, height: 32 };
  const canvas = { width: 1000, height: 800 };

  it("sits above the block, clear of it by the gap", () => {
    const at = toolbarPlacement(
      { x: 40, y: 300, width: 500, height: 100 },
      bar,
      canvas
    );

    expect(at.side).toBe("above");
    expect(at.y).toBe(300 - 32 - TOOLBAR_GAP_PX);
  });

  it("aligns to the block's leading edge", () => {
    // Not centred: a centred bar moves whenever the block's width changes,
    // which is exactly what an author is doing while editing its padding.
    expect(
      toolbarPlacement({ x: 40, y: 300, width: 500, height: 100 }, bar, canvas)
        .x
    ).toBe(40);
    expect(
      toolbarPlacement({ x: 40, y: 300, width: 900, height: 100 }, bar, canvas)
        .x
    ).toBe(40);
  });

  it("flips below when there is no room above", () => {
    // The first block on a page. Clamping to the canvas top instead would draw
    // the bar ON the block rather than beside it.
    const at = toolbarPlacement(
      { x: 0, y: 10, width: 500, height: 100 },
      bar,
      canvas
    );

    expect(at.side).toBe("below");
    expect(at.y).toBe(10 + 100 + TOOLBAR_GAP_PX);
  });

  it("stays above for a block at the BOTTOM of a tall canvas", () => {
    // The control for the flip: a rule that flipped on any overflow would move
    // the bar for a block that had plenty of room above it.
    expect(
      toolbarPlacement({ x: 0, y: 700, width: 500, height: 100 }, bar, canvas)
        .side
    ).toBe("above");
  });

  it("slides back in from the right edge", () => {
    const at = toolbarPlacement(
      { x: 950, y: 300, width: 40, height: 20 },
      bar,
      canvas
    );

    expect(at.x).toBe(1000 - 200);
  });

  it("slides back in from a negative left edge", () => {
    expect(
      toolbarPlacement({ x: -30, y: 300, width: 200, height: 20 }, bar, canvas)
        .x
    ).toBe(0);
  });

  it("keeps the FIRST buttons visible when the bar is wider than the canvas", () => {
    // No position satisfies both edges. Clamping to the right would push the
    // leading buttons off-screen, and those are the ones an author reaches for.
    expect(
      toolbarPlacement({ x: 40, y: 300, width: 100, height: 20 }, bar, {
        width: 120,
        height: 800,
      }).x
    ).toBe(0);
  });
});
