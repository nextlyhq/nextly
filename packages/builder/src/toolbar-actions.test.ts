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

import {
  applyOps,
  saveAsPatternRefusal,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { compositionRefusalReason } from "./composition-refusal";
import { layersLockRefusalFor } from "./lock-refusal";
import { selectionDuplication } from "./selection-ops";

import {
  depthMoveActions,
  TOOLBAR_GAP_PX,
  toolbarActions,
  turnIntoChoice,
  toolbarPlacement,
  unionRect,
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
    // Taken from the bar's own answer for the first selection rather than
    // written down, so a verb added to the bar is covered by this the day it
    // arrives. A literal list only ever asserts the shape somebody typed, which
    // is never the shape that is about to change.
    const expected = toolbarActions(document, "outer").map(a => a.id);

    // The control: a list this could not read would make every comparison below
    // pass against nothing.
    expect(expected.length).toBeGreaterThan(1);
    for (const id of ["kid", "last"]) {
      expect(toolbarActions(document, id).map(a => a.id)).toEqual(expected);
    }
  });

  describe("a greyed item says why", () => {
    // Every item the bar or the menu shows dimmed carries its reason, the
    // edges of a container included: "nothing happens" is not an answer an
    // author can act on.
    const document = documentOf([node("a"), node("b"), node("c")]);

    it("says a top-level block has no parent to select", () => {
      const action = actionOf(toolbarActions(document, "a"), "select-parent");
      expect(action.enabled).toBe(false);
      expect(action.reason).toBe("Already at the top level of the page");
    });

    it("says the first block cannot move up, and the last cannot move down", () => {
      const first = actionOf(toolbarActions(document, "a"), "move-up");
      expect(first.enabled).toBe(false);
      expect(first.reason).toBe("Already at the top here");
      const last = actionOf(toolbarActions(document, "c"), "move-down");
      expect(last.enabled).toBe(false);
      expect(last.reason).toBe("Already at the bottom here");
    });

    it("says the same for several blocks at the edge, which the set moves as one", () => {
      const top = toolbarActions(document, "a", ["a", "b"]);
      expect(actionOf(top, "move-up").enabled).toBe(false);
      expect(actionOf(top, "move-up").reason).toBe("Already at the top here");
      const bottom = toolbarActions(document, "b", ["b", "c"]);
      expect(actionOf(bottom, "move-down").enabled).toBe(false);
      expect(actionOf(bottom, "move-down").reason).toBe(
        "Already at the bottom here"
      );
      // The control: a set away from the edge moves, and says nothing.
      expect(actionOf(top, "move-down").reason).toBe(undefined);
    });

    it("says the same thing for a top-level block's parent and its outdent", () => {
      // One fact, "this is the top level", asked by two verbs: one sentence.
      const parent = actionOf(toolbarActions(document, "a"), "select-parent");
      const outdent = depthMoveActions(document, "a").find(
        move => move.direction === "outdent"
      );
      expect(outdent?.enabled).toBe(false);
      expect(parent.reason).toBe(outdent?.reason);
    });

    it("words a refused indent so it is true when the block above has several regions", () => {
      // A block above with two regions and neither the default: the
      // keyboard move cannot name one and answers `null`, though there IS a
      // block above. The position stands in for that answer, since which
      // regions a block declares is its definition's, not this document's.
      const regions = node("cols", "acme/columns", {
        slots: { left: [], right: [] },
      });
      const nested = documentOf([regions, node("x")]);
      const noSlotToName = () => null;
      const indent = depthMoveActions(
        nested,
        "x",
        undefined,
        undefined,
        noSlotToName
      ).find(move => move.direction === "indent");
      expect(indent?.enabled).toBe(false);
      expect(indent?.reason).toBe("No block just above that it can go into");
    });

    it("says nothing for an item that can be pressed", () => {
      expect(actionOf(toolbarActions(document, "b"), "move-up").reason).toBe(
        undefined
      );
    });
  });

  describe("saving a selection to the pattern library", () => {
    // A rule source of its own rather than the registry, so these assert the
    // toolbar's reading of a refusal and not which blocks happen to be
    // registered in this process.
    const anyParent = { parentsOf: () => undefined };

    it("offers it for a run of blocks, which is the ordinary case", () => {
      // Not a single-block afterthought: a pattern is usually several blocks —
      // a heading, a paragraph and a button — so the SET is what this verb is
      // for. Move is the verb that narrows for a set; this one does not.
      const document = documentOf([node("a"), node("b"), node("c")]);

      const action = actionOf(
        toolbarActions(document, "a", ["a", "b"], anyParent),
        "save-as-pattern"
      );

      expect(action.enabled).toBe(true);
      expect(action.reason).toBeUndefined();
    });

    it("refuses a selection with a gap in it, and says what to do", () => {
      // `a` and `c` share a parent with `b` between them. The sentence has to
      // be a remedy: nothing on the canvas says why this particular pair cannot
      // travel together.
      const document = documentOf([node("a"), node("b"), node("c")]);

      const action = actionOf(
        toolbarActions(document, "a", ["a", "c"], anyParent),
        "save-as-pattern"
      );

      expect(action.enabled).toBe(false);
      expect(action.reason).toBe(compositionRefusalReason({ problem: "gap" }));
    });

    it("asks the PLANNER, so it refuses exactly what a save would refuse", () => {
      // The property that matters, and the one a toolbar keeping its own list
      // of causes would lose. Every selection is put to both, and they agree on
      // every one — including the ones neither refuses, which is what stops
      // this passing against a bar that refuses everything.
      const document = documentOf([
        box("outer", [node("kid"), node("kid2")]),
        node("mid"),
        node("last"),
      ]);
      // Only selections the bar is DRAWN for. An id the document no longer
      // holds produces no bar at all, which is a different rule and is asserted
      // on its own above.
      const selections = [
        ["outer"],
        ["kid"],
        ["kid", "kid2"],
        ["outer", "mid"],
        ["outer", "last"],
        ["kid", "last"],
      ];

      const verdicts = selections.map(ids => {
        const offered = actionOf(
          toolbarActions(document, ids[0] ?? null, ids, anyParent),
          "save-as-pattern"
        ).enabled;
        const planner =
          saveAsPatternRefusal(document, ids, anyParent) === undefined;
        return { ids, offered, planner };
      });

      // Both outcomes are present, so neither a bar that always offers nor one
      // that never does could satisfy this.
      expect(verdicts.some(v => v.planner)).toBe(true);
      expect(verdicts.some(v => !v.planner)).toBe(true);
      for (const verdict of verdicts) {
        expect({ ids: verdict.ids, enabled: verdict.offered }).toEqual({
          ids: verdict.ids,
          enabled: verdict.planner,
        });
      }
    });

    it("is offered for a set as well as for one block", () => {
      // The two branches of `toolbarActions` are separate lists, so a verb
      // added to one and not the other is invisible until an author selects a
      // second block.
      const document = documentOf([node("a"), node("b")]);

      expect(
        toolbarActions(document, "a", ["a"], anyParent).map(a => a.id)
      ).toContain("save-as-pattern");
      expect(
        toolbarActions(document, "a", ["a", "b"], anyParent).map(a => a.id)
      ).toContain("save-as-pattern");
    });
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

  it("a lock stops the move and the delete, and says why", () => {
    const document = documentOf([
      node("a", "acme/heading", { locked: true }),
      node("b"),
    ]);
    const actions = toolbarActions(document, "a");

    expect(actionOf(actions, "move-down").enabled).toBe(false);
    expect(actionOf(actions, "move-down").reason).toBe("Heading is locked.");
    expect(actionOf(actions, "delete").enabled).toBe(false);
    expect(actionOf(actions, "delete").reason).toBe("Heading is locked.");
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

  it.each([
    ["a locked block", "a", [node("a", "acme/heading", { locked: true })]],
    [
      "a block holding a locked one",
      "outer",
      [box("outer", [node("kid", "acme/heading", { locked: true })])],
    ],
    [
      "a block inside a locked one",
      "kid",
      [box("outer", [node("kid")], { locked: true, name: "Hero" })],
    ],
  ])(
    "offers Duplicate for %s exactly when its ops apply",
    (_case, selectedId, nodes) => {
      // The bar asks the editor's own question of the very ops the verb
      // applies, so an offered Duplicate never fails in silence and a dimmed
      // one says why.
      const document = documentOf(nodes);
      const action = actionOf(
        toolbarActions(document, selectedId, undefined, undefined, true, ops =>
          layersLockRefusalFor(document, ops)
        ),
        "duplicate"
      );
      const plan = selectionDuplication(document, [selectedId]);
      const applies = (): boolean => {
        try {
          applyOps(document, plan?.ops ?? []);
          return true;
        } catch {
          return false;
        }
      };

      expect(action.enabled).toBe(applies());
    }
  );

  it("a lock INSIDE a block stops its delete and its move", () => {
    // THE case that separates asking the lock rule from reading `node.locked`
    // once: a locked block does not move or disappear until it is unlocked,
    // and moving or deleting the block around it would do both to it. The op
    // layer refuses either, so the toolbar offers neither, naming the block.
    const document = documentOf([
      box("outer", [node("kid", "acme/heading", { locked: true })]),
      node("after"),
    ]);
    const actions = toolbarActions(document, "outer");

    expect(actionOf(actions, "move-down").enabled).toBe(false);
    expect(actionOf(actions, "move-down").reason).toBe(
      "Heading inside this block is locked."
    );
    expect(actionOf(actions, "delete").enabled).toBe(false);
    expect(actionOf(actions, "delete").reason).toBe(
      "Heading inside this block is locked."
    );
  });

  it("a lock AROUND a block stops its move and its delete, naming the holder", () => {
    // The block itself is unlocked, but it sits inside a locked one, which
    // covers it: moving or deleting it out would change what that lock keeps.
    const document = documentOf([
      box("outer", [node("kid"), node("sibling")], {
        locked: true,
        name: "Hero",
      }),
    ]);
    const actions = toolbarActions(document, "kid");

    expect(actionOf(actions, "move-down").enabled).toBe(false);
    expect(actionOf(actions, "move-down").reason).toBe(
      "This block is inside Hero, which is locked."
    );
    expect(actionOf(actions, "delete").enabled).toBe(false);
    expect(actionOf(actions, "delete").reason).toBe(
      "This block is inside Hero, which is locked."
    );
  });

  it("dims a duplicate the lock around the block would refuse, through the editor's question", () => {
    // A copy goes beside the original, inside the locked block. The verb asks
    // the editor's lock question, which now answers for a Layers lock too.
    const document = documentOf([
      box("outer", [node("kid")], { locked: true, name: "Hero" }),
    ]);
    const actions = toolbarActions(
      document,
      "kid",
      undefined,
      undefined,
      true,
      ops => layersLockRefusalFor(document, ops)
    );

    expect(actionOf(actions, "duplicate").enabled).toBe(false);
    expect(actionOf(actions, "duplicate").reason).toBe(
      "Hero is locked. Unlock it to add blocks to it."
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

describe("making a component from a selection", () => {
  const anyParent = { parentsOf: () => undefined };
  const offer = { mayCreate: true };
  const TURN = "turn-into-component";

  it("is not offered where the host has no component library", () => {
    const ids = toolbarActions(
      documentOf([node("a")]),
      "a",
      ["a"],
      anyParent
    ).map(action => action.id);

    expect(ids).not.toContain(TURN);
  });

  it("is ONE item behind the menu, for a run of blocks", () => {
    const document = documentOf([node("a"), node("b"), node("c")]);
    const actions = toolbarActions(
      document,
      "a",
      ["a", "b"],
      anyParent,
      true,
      undefined,
      offer
    );

    expect(actionOf(actions, TURN)).toMatchObject({
      label: "Turn into component…",
      enabled: true,
      inMenu: true,
    });
    // The two items it replaces are gone.
    const ids: readonly string[] = actions.map(action => action.id);
    expect(ids).not.toContain("save-as-component");
    expect(ids).not.toContain("convert-to-component");
    // Both ways are open.
    expect(turnIntoChoice(document, ["a", "b"], anyParent)).toEqual({});
    // The structural verbs stay buttons of their own.
    expect(actionOf(actions, "delete").inMenu).toBeUndefined();
  });

  it("is dimmed with the grant's reason for an author who may not publish components", () => {
    const actions = toolbarActions(
      documentOf([node("a")]),
      "a",
      ["a"],
      anyParent,
      true,
      undefined,
      { mayCreate: false }
    );

    expect(actionOf(actions, TURN)).toMatchObject({
      enabled: false,
      reason: "You do not have permission to create and publish components.",
    });
  });

  it("is dimmed with the planner's reason for a run with a gap", () => {
    const document = documentOf([node("a"), node("b"), node("c")]);
    const actions = toolbarActions(
      document,
      "a",
      ["a", "c"],
      anyParent,
      true,
      undefined,
      offer
    );

    expect(actionOf(actions, TURN).reason).toBe(
      compositionRefusalReason({ problem: "gap" })
    );
    expect(actionOf(actions, TURN).enabled).toBe(false);
  });

  it("stays offered, keeping the originals only, when a locked block cannot be taken off the page", () => {
    // Saving copies, so a locked block may be saved; replacing removes it.
    const document = documentOf([node("a", "acme/heading", { locked: true })]);
    const actions = toolbarActions(
      document,
      "a",
      ["a"],
      anyParent,
      true,
      undefined,
      offer
    );

    expect(actionOf(actions, TURN).enabled).toBe(true);
    const choice = turnIntoChoice(document, ["a"], anyParent);
    expect(choice.replaceRefused).toEqual(expect.any(String));
    expect(choice.keepRefused).toBeUndefined();
  });

  it("keeps the originals only when the editor's lock question refuses the placement", () => {
    const document = documentOf([node("a")]);
    const asked: string[] = [];
    const ask = (ops: readonly { kind: string }[]) => {
      asked.push(ops.map(op => op.kind).join(","));
      return ops.some(op => op.kind === "insert")
        ? {
            code: "locked-slot-altered" as const,
            holderType: "acme/hero",
            lock: "all" as const,
            childType: undefined,
          }
        : undefined;
    };
    const actions = toolbarActions(
      document,
      "a",
      ["a"],
      anyParent,
      true,
      ask,
      offer
    );

    expect(asked).toContain("remove,insert");
    expect(actionOf(actions, TURN).enabled).toBe(true);
    expect(
      turnIntoChoice(document, ["a"], anyParent, ask).replaceRefused
    ).toEqual(expect.any(String));
  });
});

describe("detach, duplicate and update a pattern", () => {
  const anyParent = { parentsOf: () => undefined };
  const card = {
    formatVersion: 1,
    kind: "component",
    nodes: [node("t", "acme/heading")],
  } as unknown as BlockDocument;
  const placed = (id: string) =>
    node(id, "nextly/component-instance", {
      props: { componentId: "card" },
    });
  const offer = {
    mayCreate: true,
    mayUpdatePattern: true,
    definitions: new Map([["card", card]]),
  };

  it("offers Detach and Duplicate for one placement, behind the menu", () => {
    const actions = toolbarActions(
      documentOf([placed("p")]),
      "p",
      ["p"],
      anyParent,
      true,
      undefined,
      offer
    );

    expect(actionOf(actions, "detach-component")).toMatchObject({
      enabled: true,
      inMenu: true,
    });
    expect(actionOf(actions, "duplicate-component").enabled).toBe(true);
  });

  it("offers neither for a block that is not a placement", () => {
    const ids = toolbarActions(
      documentOf([node("a")]),
      "a",
      ["a"],
      anyParent,
      true,
      undefined,
      offer
    ).map(action => action.id);

    expect(ids).not.toContain("detach-component");
    expect(ids).not.toContain("duplicate-component");
  });

  it("dims Detach with the reason when the component cannot be drawn", () => {
    const actions = toolbarActions(
      documentOf([placed("p")]),
      "p",
      ["p"],
      anyParent,
      true,
      undefined,
      { ...offer, definitions: new Map() }
    );

    const detach = actionOf(actions, "detach-component");
    expect(detach.enabled).toBe(false);
    expect(detach.reason).toBeTruthy();
  });

  it("dims Duplicate for an author who may not create components", () => {
    const actions = toolbarActions(
      documentOf([placed("p")]),
      "p",
      ["p"],
      anyParent,
      true,
      undefined,
      { ...offer, mayCreate: false }
    );

    expect(actionOf(actions, "duplicate-component")).toMatchObject({
      enabled: false,
      reason: "You do not have permission to create and publish components.",
    });
  });

  it("dims Duplicate for a placement whose component this author cannot read", () => {
    const actions = toolbarActions(
      documentOf([placed("p")]),
      "p",
      ["p"],
      anyParent,
      true,
      undefined,
      { ...offer, definitions: new Map() }
    );

    expect(actionOf(actions, "duplicate-component")).toMatchObject({
      enabled: false,
      reason: "This component is not available to copy.",
    });
  });

  it("dims Duplicate for a locked placement, whose re-point is an edit", () => {
    const locked = node("p", "nextly/component-instance", {
      props: { componentId: "card" },
      locked: true,
    });
    const actions = toolbarActions(
      documentOf([locked]),
      "p",
      ["p"],
      anyParent,
      true,
      undefined,
      offer
    );

    expect(actionOf(actions, "duplicate-component").enabled).toBe(false);
    // A placement reads as a component, not as the engine's word for one.
    expect(actionOf(actions, "duplicate-component").reason).toBe(
      "Component is locked."
    );
  });

  it("dims Duplicate for a placement inside a locked block, naming that block", () => {
    const actions = toolbarActions(
      documentOf([
        box("hold", [placed("p")], { locked: true, name: "Promo area" }),
      ]),
      "p",
      ["p"],
      anyParent,
      true,
      undefined,
      offer
    );

    expect(actionOf(actions, "duplicate-component")).toMatchObject({
      enabled: false,
      reason: "This block is inside Promo area, which is locked.",
    });
  });

  it("offers Duplicate for a placement whose slot content holds a locked block", () => {
    // The re-point edits the placement's own props and carries its content
    // with it, so a lock inside that content does not hold it, as it would a
    // move or a delete.
    const holding = node("p", "nextly/component-instance", {
      props: { componentId: "card" },
      slots: { extra: [node("pinned", "acme/heading", { locked: true })] },
    });
    const actions = toolbarActions(
      documentOf([holding]),
      "p",
      ["p"],
      anyParent,
      true,
      undefined,
      offer
    );

    expect(actionOf(actions, "duplicate-component").enabled).toBe(true);
  });

  it("offers Update a pattern for a savable run, dimmed without the grant", () => {
    const document = documentOf([node("a"), node("b")]);
    const allowed = toolbarActions(
      document,
      "a",
      ["a", "b"],
      anyParent,
      true,
      undefined,
      offer
    );
    const refused = toolbarActions(
      document,
      "a",
      ["a", "b"],
      anyParent,
      true,
      undefined,
      { ...offer, mayUpdatePattern: false }
    );

    expect(actionOf(allowed, "update-pattern").enabled).toBe(true);
    expect(actionOf(refused, "update-pattern")).toMatchObject({
      enabled: false,
      reason: "You do not have permission to update and publish patterns.",
    });
  });
});

describe("depthMoveActions", () => {
  it("dims Move in and Move out for a block holding a locked block, and says which", () => {
    // The op store refuses to relocate a subtree holding a locked block, so
    // offering either move would be a press that does nothing.
    const document = documentOf([
      box("shelf", []),
      box("outer", [
        box("mid", [node("kid", "acme/heading", { locked: true })]),
      ]),
    ]);
    const moves = depthMoveActions(document, "outer");
    expect(moves.map(move => [move.id, move.enabled, move.reason])).toEqual([
      ["move-in", false, "Heading inside this block is locked."],
      ["move-out", false, "Heading inside this block is locked."],
    ]);
  });

  it("offers Move in for the same block once nothing inside it is locked", () => {
    // The control: the same shape unlocked, so the refusal above is the lock.
    const document = documentOf([
      box("shelf", []),
      box("outer", [box("mid", [node("kid", "acme/heading")])]),
    ]);
    const moveIn = depthMoveActions(document, "outer")[0];
    expect(moveIn?.enabled).toBe(true);
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

  it("flips below at the top of what is on screen, not only of the page", () => {
    // Scrolled 600px down: a block 10px below the screen's top has no room
    // above it on screen, though the page has plenty.
    const screen = { top: 600, bottom: 1400 };
    const at = toolbarPlacement(
      { x: 0, y: 610, width: 500, height: 100 },
      bar,
      canvas,
      TOOLBAR_GAP_PX,
      screen
    );
    expect(at.side).toBe("below");
    expect(at.y).toBe(610 + 100 + TOOLBAR_GAP_PX);
  });

  it("stays at the top of the screen for a tall block whose top is scrolled away", () => {
    // The bar a tall block's author reaches for while its middle is on screen,
    // rather than one scrolled away with its top edge.
    const screen = { top: 600, bottom: 1400 };
    const at = toolbarPlacement(
      { x: 40, y: 200, width: 500, height: 1500 },
      bar,
      canvas,
      TOOLBAR_GAP_PX,
      screen
    );
    expect(at.side).toBe("pinned");
    expect(at.y).toBe(600 + TOOLBAR_GAP_PX);
  });

  it("stays at the top of the screen for a tall block just under it, with no room below on screen", () => {
    // Below a block taller than the rest of the screen is off it: the bar goes
    // to the screen's top, over the block, rather than out of reach.
    const screen = { top: 600, bottom: 1400 };
    const at = toolbarPlacement(
      { x: 0, y: 610, width: 500, height: 1000 },
      bar,
      canvas,
      TOOLBAR_GAP_PX,
      screen
    );
    expect(at.side).toBe("pinned");
    expect(at.y).toBe(600 + TOOLBAR_GAP_PX);
  });

  it("goes below a short block whose top is just above the screen, where that fits", () => {
    // 20px of the block is on screen: too little to pin the bar over, and
    // above it is off screen. Below it there is room.
    const screen = { top: 600, bottom: 1400 };
    const at = toolbarPlacement(
      { x: 0, y: 580, width: 500, height: 40 },
      bar,
      canvas,
      TOOLBAR_GAP_PX,
      screen
    );
    expect(at.side).toBe("below");
    expect(at.y).toBe(580 + 40 + TOOLBAR_GAP_PX);
  });

  it("keeps to the screen's left and right edges in a canvas scrolled sideways", () => {
    // The block starts 300px left of what is shown, and is still on screen.
    const screen = { top: 0, bottom: 900, left: 300, right: 1100 };
    const at = toolbarPlacement(
      { x: 0, y: 200, width: 1000, height: 100 },
      bar,
      { width: 2000, height: 3000 },
      TOOLBAR_GAP_PX,
      screen
    );
    expect(at.x).toBe(300);
  });

  it("stays with a block scrolled wholly off the side, rather than at the screen's edge", () => {
    // The block is left of what is shown: a bar clamped to the screen would
    // sit at its edge, away from the block and over another one.
    const screen = { top: 0, bottom: 900, left: 1100, right: 1900 };
    const at = toolbarPlacement(
      { x: 0, y: 200, width: 500, height: 100 },
      bar,
      { width: 2000, height: 3000 },
      TOOLBAR_GAP_PX,
      screen
    );
    expect(at.x).toBe(0);
  });

  it("judges a set of blocks off both sides by each block, not by their union", () => {
    // 0..100 and 2000..2100 with the screen at 500..1500: their union crosses
    // the screen through the gap between them, though neither block does.
    const screen = { top: 0, bottom: 900, left: 500, right: 1500 };
    const parts = [
      { x: 0, y: 200, width: 100, height: 50 },
      { x: 2000, y: 200, width: 100, height: 50 },
    ];
    const at = toolbarPlacement(
      { x: 0, y: 200, width: 2100, height: 50 },
      bar,
      { width: 3000, height: 3000 },
      TOOLBAR_GAP_PX,
      screen,
      parts
    );
    expect(at.x).toBe(0);
  });

  it("is left where it is for a block scrolled wholly out of view", () => {
    const screen = { top: 600, bottom: 1400 };
    expect(
      toolbarPlacement(
        { x: 0, y: 100, width: 500, height: 100 },
        bar,
        canvas,
        TOOLBAR_GAP_PX,
        screen
      ).side
    ).toBe("above");
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

describe("unionRect", () => {
  it("is the rectangle itself for one", () => {
    expect(unionRect([{ x: 10, y: 20, width: 30, height: 40 }])).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it("spans two rectangles that do not touch", () => {
    // What a bar anchors to once a selection can hold blocks at opposite ends
    // of a page. Anchoring at one of them would describe an action about to
    // happen to a block the author cannot see.
    expect(
      unionRect([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 100, y: 200, width: 20, height: 5 },
      ])
    ).toEqual({ x: 0, y: 0, width: 120, height: 205 });
  });

  it("is unaffected by the order they arrive in", () => {
    const a = { x: 50, y: 5, width: 10, height: 10 };
    const b = { x: 0, y: 40, width: 10, height: 10 };

    expect(unionRect([a, b])).toEqual(unionRect([b, a]));
  });

  it("answers with nothing for an empty selection", () => {
    expect(unionRect([])).toBeUndefined();
  });
});

describe("toolbarActions for MORE than one block", () => {
  it("keeps duplicate and delete, which repeat cleanly", () => {
    const document = documentOf([node("a"), node("b")]);
    const actions = toolbarActions(document, "a", ["a", "b"]);

    expect(actionOf(actions, "duplicate").enabled).toBe(true);
    expect(actionOf(actions, "delete").enabled).toBe(true);
  });

  it("withdraws select-parent, which has no answer for a set", () => {
    // "The parent" of blocks with different parents is not a block, so there is
    // nothing for this to select and it does not invent one.
    const document = documentOf([node("a"), node("b")]);
    const actions = toolbarActions(document, "a", ["a", "b"]);

    expect(actionOf(actions, "select-parent").enabled).toBe(false);
    expect(actionOf(actions, "select-parent").reason).toBe(
      "Only one block at a time. 2 are selected."
    );
  });

  it("offers move to a set that shares one container", () => {
    // Two blocks in the same list have a shared order to step through, so one
    // step for each is well defined. `a` is first, so only down is available.
    const document = documentOf([node("a"), node("b"), node("c")]);
    const actions = toolbarActions(document, "a", ["a", "b"]);

    expect(actionOf(actions, "move-down").enabled).toBe(true);
    // Dimmed at the edge with the reason one block at the end of its list
    // gives: every dimmed item says why.
    expect(actionOf(actions, "move-up").enabled).toBe(false);
    expect(actionOf(actions, "move-up").reason).toBe("Already at the top here");
  });

  it("explains a move refused because the set straddles two containers", () => {
    // Nothing on the page shows that the selection spans a boundary, so
    // this refusal names it rather than an edge.
    const document = documentOf([node("a"), node("b"), node("c")]);
    const withChild = {
      ...document,
      nodes: [
        { ...document.nodes[0], slots: { children: [node("inside")] } },
        document.nodes[1],
      ],
    } as typeof document;

    const actions = toolbarActions(withChild, "inside", ["inside", "b"]);

    expect(actionOf(actions, "move-up").enabled).toBe(false);
    expect(actionOf(actions, "move-up").reason).toContain(
      "different containers"
    );
  });

  it("keeps the same five buttons in the same order", () => {
    // A control that vanished when a second block was selected would move every
    // button after it, so the one an author was aiming at is somewhere else by
    // the time they arrive.
    const document = documentOf([node("a"), node("b")]);

    expect(toolbarActions(document, "a", ["a", "b"]).map(x => x.id)).toEqual(
      toolbarActions(document, "a").map(x => x.id)
    );
  });

  it("ONE lock refuses the whole delete, and names it", () => {
    const document = documentOf([
      node("a"),
      node("b", "acme/heading", { locked: true, name: "Pinned" }),
    ]);
    const actions = toolbarActions(document, "a", ["a", "b"]);

    expect(actionOf(actions, "delete").enabled).toBe(false);
    expect(actionOf(actions, "delete").reason).toBe("Pinned is locked.");
    // Still duplicable: the originals stay where they are.
    expect(actionOf(actions, "duplicate").enabled).toBe(true);
  });

  it("answers exactly as before for a set of ONE, which is the control", () => {
    // Without this, the multi branch could be taken for every selection and
    // every single-block case above would still pass.
    const document = documentOf([node("a"), node("b")]);

    expect(toolbarActions(document, "a", ["a"])).toEqual(
      toolbarActions(document, "a")
    );
  });
});

describe("Save as shared style…", () => {
  const styled = { styles: { base: { base: { color: "#123456" } } } };
  const card = {
    id: "c-card",
    slug: "card",
    label: "Card",
    orderIndex: 0,
    styles: {},
  };
  const save = (
    document: BlockDocument,
    ids: string[],
    offer?: { library: (typeof card)[] | undefined; mayChange: boolean }
  ) =>
    toolbarActions(
      document,
      ids[0] ?? null,
      ids,
      undefined,
      true,
      undefined,
      undefined,
      false,
      offer
    ).find(action => action.id === "save-as-shared-style");

  it("is not offered by a host with no shared styles", () => {
    expect(
      save(documentOf([node("a", undefined, styled)]), ["a"])
    ).toBeUndefined();
  });

  it("is offered, in the menu, for one block with styles of its own", () => {
    expect(
      save(documentOf([node("a", undefined, styled)]), ["a"], {
        library: [card],
        mayChange: true,
      })
    ).toEqual({
      id: "save-as-shared-style",
      label: "Save as shared style…",
      enabled: true,
      inMenu: true,
    });
  });

  it("is dimmed inside an area locked to its content, judged by the editor's lock view", () => {
    // The area's lock comes from the definitions the editor composes with,
    // not the global registry, so only the lock view knows it.
    const view = {
      definitions: {
        get: (type: string) =>
          type === "acme/area"
            ? {
                version: 1,
                slots: { children: { lock: "contentOnly" as const } },
              }
            : undefined,
      },
    };
    const document = documentOf([
      node("area", "acme/area", {
        slots: { children: [node("a", undefined, styled)] },
      }),
    ]);
    const action = save(document, ["a"], {
      library: [card],
      mayChange: true,
      view,
    } as never);
    expect(action?.enabled).toBe(false);
    expect(action?.reason).toMatch(/content/i);
  });

  it("is dimmed with the save rule's own reason", () => {
    const offer = { library: [card], mayChange: true };
    expect(save(documentOf([node("a")]), ["a"], offer)?.reason).toBe(
      "This block has no styles of its own yet."
    );
    expect(
      save(
        documentOf([node("a", undefined, { ...styled, classes: ["c-card"] })]),
        ["a"],
        offer
      )?.reason
    ).toBe("This block already uses Card.");
    expect(
      save(documentOf([node("a", undefined, styled)]), ["a"], {
        ...offer,
        mayChange: false,
      })?.reason
    ).toBe("You can't change this site's design.");
    expect(
      save(
        documentOf([
          node("a", undefined, styled),
          node("b", undefined, styled),
        ]),
        ["a", "b"],
        offer
      )?.reason
    ).toBe("Only one block at a time. 2 are selected.");
  });
});
