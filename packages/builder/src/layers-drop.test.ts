/**
 * Where a dragged Layers row lands, judged without a browser: the gap from the
 * pointer's height, the depth from its x, clamped by the rows either side, and
 * the verdict from the one placement rule and the editor's lock question.
 *
 * The rows are measured as the panel measures them — 28px each, top to
 * bottom — from a flattening of the document, so each case reads as a drawn
 * list with a pointer somewhere on it.
 *
 * @module layers-drop.test
 */
import {
  clearBlocks,
  locateNode,
  registerBlocks,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { placementSources } from "./drop-targets";
import { holdsBlocks } from "./keyboard-move";
import {
  LAYERS_DEPTH_PX,
  layersDrop,
  layersRefusalWording,
  layersVerdictCache,
  rowAt,
  type LayersDropResult,
  type LayersPlacement,
  type LayersRow,
} from "./layers-drop";
import type { LockRefusalFacts } from "./lock-refusal";
import type { BuilderOp } from "./ops";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      { ...base, name: "t/heading", editor: { label: "Heading" } },
      {
        ...base,
        name: "t/box",
        editor: { label: "Box" },
        slots: { children: {} },
      },
      {
        ...base,
        name: "t/tabs",
        editor: { label: "Tabs" },
        // Two regions and neither the default, so an indent cannot name one.
        slots: { first: {}, second: {} },
      },
      {
        ...base,
        name: "t/card",
        editor: { label: "Card" },
        slots: { children: {} },
        contentModel: (props: { link?: string }) =>
          props.link
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "t/button",
        editor: { label: "Button" },
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
    ] as never,
    { source: "layers-drop-test" }
  );
});

afterEach(() => {
  clearBlocks();
});

const ROW = 28;
/** Where depth zero begins on the x axis, in every case below. */
const LEFT = 100;

function node(id: string, type: string, extra: Partial<BlockNode> = {}) {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** The rows the panel would draw: open branches show what they hold. */
function rowsOf(
  document: BlockDocument,
  open: readonly string[] = []
): LayersRow[] {
  const rows: LayersRow[] = [];
  const walk = (nodes: readonly BlockNode[], depth: number): void => {
    for (const each of nodes) {
      const at = locateNode(document.nodes, each.id);
      rows.push({
        id: each.id,
        depth,
        parentId: at?.parent?.id,
        slot: at?.slot,
        index: at?.index ?? 0,
        expanded: open.includes(each.id),
        canHoldChildren: holdsBlocks(each, undefined),
        top: rows.length * ROW,
        height: ROW,
      });
      if (open.includes(each.id)) {
        walk(Object.values(each.slots ?? {}).flat(), depth + 1);
      }
    }
  };
  walk(document.nodes, 0);
  return rows;
}

function placementFor(
  document: BlockDocument,
  lockRefusalFor: LayersPlacement["lockRefusalFor"] = () => undefined
): LayersPlacement {
  return {
    document,
    sources: placementSources({ nesting: registryNestingSource() }),
    lockRefusalFor,
    verdicts: layersVerdictCache(),
  };
}

/** The pointer over a row's upper or lower half, at a depth's x. */
function over(
  rows: readonly LayersRow[],
  id: string,
  half: "upper" | "lower",
  depth: number
): { x: number; y: number } {
  const row = rows.find(each => each.id === id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return {
    x: LEFT + depth * LAYERS_DEPTH_PX,
    y: row.top + (half === "upper" ? 4 : ROW - 4),
  };
}

function drop(
  document: BlockDocument,
  draggedId: string,
  pointer: { x: number; y: number },
  open: readonly string[] = [],
  placement: LayersPlacement = placementFor(document)
): LayersDropResult {
  return layersDrop({
    rows: rowsOf(document, open),
    draggedId,
    pointer,
    left: LEFT,
    placement,
  });
}

describe("layersDrop: the gap and the depth", () => {
  it("reorders at the depth the block had when dragged straight down", () => {
    const doc = page([
      node("a", "t/heading"),
      node("b", "t/heading"),
      node("c", "t/heading"),
    ]);
    const result = drop(doc, "a", over(rowsOf(doc), "c", "lower", 0));
    // After c, counted with a lifted out: index 2 of [b, c].
    expect(result).toEqual({
      kind: "drop",
      to: { index: 2 },
      line: { y: 3 * ROW, depth: 0 },
    });
  });

  it("nests the block inside the row above when dragged to the right", () => {
    const doc = page([
      node("box", "t/box", { slots: { children: [node("in", "t/heading")] } }),
      node("h1", "t/heading"),
      node("h2", "t/heading"),
    ]);
    // The gap below the collapsed box, one level right of it: inside, at the
    // end of what it already holds.
    const result = drop(doc, "h2", over(rowsOf(doc), "box", "lower", 1));
    expect(result).toEqual({
      kind: "drop",
      to: { parentId: "box", slot: "children", index: 1 },
      line: { y: ROW, depth: 1 },
    });
  });

  it("keeps the block at the top level when the same gap is aimed at depth 0", () => {
    const doc = page([
      node("box", "t/box", { slots: { children: [node("in", "t/heading")] } }),
      node("h1", "t/heading"),
      node("h2", "t/heading"),
    ]);
    const result = drop(doc, "h2", over(rowsOf(doc), "box", "lower", 0));
    // The whole position, so a drop into the box at ITS index 1 cannot pass.
    expect(result).toEqual({
      kind: "drop",
      to: { index: 1 },
      line: { y: ROW, depth: 0 },
    });
  });

  it("clamps the depth to one deeper than a row above that holds blocks", () => {
    const doc = page([node("box", "t/box"), node("h1", "t/heading")]);
    const result = drop(doc, "h1", over(rowsOf(doc), "box", "lower", 6));
    expect(result).toMatchObject({
      kind: "drop",
      to: { parentId: "box", slot: "children", index: 0 },
      line: { depth: 1 },
    });
  });

  it("never nests inside a row above that holds no blocks", () => {
    const doc = page([
      node("h0", "t/heading"),
      node("h1", "t/heading"),
      node("h2", "t/heading"),
    ]);
    // Far to the right of a heading: the deepest the gap allows is the
    // heading's own depth, so the block goes after it rather than into it.
    const result = drop(doc, "h2", over(rowsOf(doc), "h0", "lower", 4));
    expect(result).toMatchObject({
      kind: "drop",
      to: { index: 1 },
      line: { depth: 0 },
    });
  });

  it("clamps the depth to the row below, so that row keeps its parent", () => {
    const doc = page([
      node("box", "t/box", { slots: { children: [node("in", "t/heading")] } }),
      node("h1", "t/heading"),
    ]);
    // Between an open box and its first child, aimed far to the LEFT: the
    // child below still needs the box above it, so the drop goes inside.
    const result = drop(
      doc,
      "h1",
      over(rowsOf(doc, ["box"]), "in", "upper", -3),
      ["box"]
    );
    expect(result).toMatchObject({
      kind: "drop",
      to: { parentId: "box", slot: "children", index: 0 },
      line: { depth: 1 },
    });
  });

  it("moves a nested block out by dragging it left", () => {
    const doc = page([
      node("box", "t/box", { slots: { children: [node("in", "t/heading")] } }),
      node("h1", "t/heading"),
    ]);
    const rows = rowsOf(doc, ["box"]);
    const result = drop(doc, "in", over(rows, "in", "lower", 0), ["box"]);
    expect(result).toEqual({
      kind: "drop",
      to: { index: 1 },
      // The box it leaves is asked to drop the slot if that left it empty,
      // as a keyboard move out asks.
      dropSlotIfEmpty: { parentId: "box", slot: "children" },
      line: { y: 2 * ROW, depth: 0 },
    });
  });

  it("never drops a block into its own subtree", () => {
    const doc = page([
      node("shelf", "t/box"),
      node("outer", "t/box", { slots: { children: [node("inner", "t/box")] } }),
      node("h1", "t/heading"),
    ]);
    // Over the dragged box's own child, far right. Its rows are not places it
    // can go, so the row above the gap is the shelf, and the block nests there.
    const result = drop(
      doc,
      "outer",
      over(rowsOf(doc, ["outer"]), "inner", "lower", 3),
      ["outer"]
    );
    expect(result).toMatchObject({
      kind: "drop",
      to: { parentId: "shelf", slot: "children", index: 0 },
    });
  });

  it("answers none at the place the block already is", () => {
    const doc = page([node("a", "t/heading"), node("b", "t/heading")]);
    expect(drop(doc, "a", over(rowsOf(doc), "a", "lower", 0))).toEqual({
      kind: "none",
    });
  });

  it("keeps two slots of one container apart where their rows meet", () => {
    // A container's slots are drawn as one run of rows: `first` holds a, and
    // `second` holds b then c. Over b's own row, with b lifted out, the rows
    // either side are a and c — which belong to different slots. The gap is
    // b's own place, so nothing moves; it must not slip into `first`.
    registerBlocks(
      [{ ...base, name: "t/pair", slots: { first: {}, second: {} } }] as never,
      { source: "layers-drop-test-pair" }
    );
    const doc = page([
      node("pair", "t/pair", {
        slots: {
          first: [node("a", "t/heading")],
          second: [node("b", "t/heading"), node("c", "t/heading")],
        },
      }),
    ]);
    const rows = rowsOf(doc, ["pair"]);
    for (const half of ["upper", "lower"] as const) {
      expect(drop(doc, "b", over(rows, "b", half, 1), ["pair"])).toEqual({
        kind: "none",
      });
    }
    // Dragged above a, it still lands in the slot of the row it is placed
    // before: `first`, ahead of a.
    expect(drop(doc, "c", over(rows, "a", "upper", 1), ["pair"])).toMatchObject(
      {
        kind: "drop",
        to: { parentId: "pair", slot: "first", index: 0 },
      }
    );
  });

  it("leaves a block where it was over its own row, at either end of its slot", () => {
    // Both mirrored layouts of one container whose two slots are drawn as one
    // run of rows: the dragged block at the END of the first slot, and at the
    // START of the second. Over its own row at its own depth, nothing moves.
    registerBlocks(
      [{ ...base, name: "t/split", slots: { first: {}, second: {} } }] as never,
      { source: "layers-drop-test-split" }
    );
    const layouts = [
      { first: ["a", "b"], second: ["c"] },
      { first: ["a"], second: ["b", "c"] },
    ];
    for (const layout of layouts) {
      const doc = page([
        node("split", "t/split", {
          slots: {
            first: layout.first.map(id => node(id, "t/heading")),
            second: layout.second.map(id => node(id, "t/heading")),
          },
        }),
      ]);
      const rows = rowsOf(doc, ["split"]);
      for (const half of ["upper", "lower"] as const) {
        expect(drop(doc, "b", over(rows, "b", half, 1), ["split"])).toEqual({
          kind: "none",
        });
      }
    }
    // The control: aimed past the boundary on purpose, over the lower half of
    // c, b does cross into `second`, after c.
    const doc = page([
      node("split", "t/split", {
        slots: {
          first: [node("a", "t/heading"), node("b", "t/heading")],
          second: [node("c", "t/heading")],
        },
      }),
    ]);
    expect(
      drop(doc, "b", over(rowsOf(doc, ["split"]), "c", "lower", 1), ["split"])
    ).toMatchObject({
      kind: "drop",
      to: { parentId: "split", slot: "second", index: 1 },
    });
  });

  it("answers none outside every row", () => {
    const doc = page([node("a", "t/heading"), node("b", "t/heading")]);
    expect(drop(doc, "a", { x: LEFT, y: -5 })).toEqual({ kind: "none" });
    expect(drop(doc, "a", { x: LEFT, y: 2 * ROW + 1 })).toEqual({
      kind: "none",
    });
  });

  it("finds the row a height is over, top edge in and bottom edge out", () => {
    const rows = rowsOf(page([node("a", "t/heading"), node("b", "t/heading")]));
    expect(rowAt(rows, 0)?.id).toBe("a");
    expect(rowAt(rows, ROW)?.id).toBe("b");
    expect(rowAt(rows, 2 * ROW)).toBeUndefined();
  });
});

describe("layersDrop: refusals", () => {
  it("refuses inside a container whose slots do not include the default", () => {
    const doc = page([node("tabs", "t/tabs"), node("h1", "t/heading")]);
    const result = drop(doc, "h1", over(rowsOf(doc), "tabs", "lower", 1));
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.refusal).toMatchObject({
      kind: "placement",
      verdict: { reason: "undeclared-slot" },
    });
    expect(result.line).toEqual({ y: ROW, depth: 1 });
  });

  it("refuses a Button inside a linked Card, in the rule's own words", () => {
    const doc = page([
      node("card", "t/card", { props: { link: "/go" } }),
      node("button", "t/button"),
    ]);
    const result = drop(doc, "button", over(rowsOf(doc), "card", "lower", 1));
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.refusal).toMatchObject({
      kind: "placement",
      verdict: { reason: "content-model" },
    });
    expect(layersRefusalWording(result.refusal).headline).toBe(
      "A Button can't go inside this Card."
    );
  });

  it("allows the same Button inside a Card with no link", () => {
    const doc = page([node("card", "t/card"), node("button", "t/button")]);
    expect(
      drop(doc, "button", over(rowsOf(doc), "card", "lower", 1))
    ).toMatchObject({ kind: "drop", to: { parentId: "card" } });
  });

  it("refuses every place for a block that holds a locked block, as the op layer does", () => {
    const doc = page([
      node("box", "t/box", {
        slots: { children: [node("caption", "t/heading", { locked: true })] },
      }),
      node("h1", "t/heading"),
      node("h2", "t/heading"),
    ]);
    const result = drop(doc, "box", over(rowsOf(doc), "h2", "lower", 0));
    expect(result).toMatchObject({
      kind: "refused",
      refusal: { kind: "held", locked: { id: "caption" } },
      line: { y: 3 * ROW, depth: 0 },
    });
    if (result.kind !== "refused") return;
    expect(layersRefusalWording(result.refusal)).toEqual({
      headline: "Heading inside this block is locked.",
      remedy: "Unlock Heading to move this block.",
    });
  });

  it("refuses where the editor's locks refuse, asking with the move it would apply", () => {
    const doc = page([node("box", "t/box"), node("h1", "t/heading")]);
    const lock: LockRefusalFacts = {
      code: "locked-slot-altered",
      holderType: "t/box",
      lock: "all",
    };
    const asked: (readonly BuilderOp[])[] = [];
    const placement = placementFor(doc, ops => {
      asked.push(ops);
      return lock;
    });
    const result = drop(
      doc,
      "h1",
      over(rowsOf(doc), "box", "lower", 1),
      [],
      placement
    );
    expect(result).toEqual({
      kind: "refused",
      refusal: { kind: "lock", lock },
      line: { y: ROW, depth: 1 },
    });
    expect(asked).toEqual([
      [
        {
          kind: "move",
          id: "h1",
          to: { parentId: "box", slot: "children", index: 0 },
        },
      ],
    ]);
    if (result.kind !== "refused") return;
    expect(layersRefusalWording(result.refusal).headline).toBe(
      "This area of Box is locked."
    );
  });
});

describe("layersDrop: the verdicts kept for one gesture", () => {
  it("asks each position once, however often the pointer passes it", () => {
    const doc = page([node("box", "t/box"), node("h1", "t/heading")]);
    const question = vi.fn(() => undefined);
    const placement = placementFor(doc, question);
    const pointer = over(rowsOf(doc), "box", "lower", 1);
    drop(doc, "h1", pointer, [], placement);
    drop(doc, "h1", pointer, [], placement);
    expect(question).toHaveBeenCalledTimes(1);
    expect(
      placement.verdicts.placement.get("box")?.get("children")
    ).toMatchObject({ allowed: true });
  });

  it("keys a container by its id and its slot apart, so no spelling collides", () => {
    // `a:b` holding `c`, and `a` holding `b:c` that refuses a heading: one
    // joined key for both would let the second's refusal answer for the first.
    registerBlocks(
      [
        { ...base, name: "t/one", slots: { c: {} } },
        { ...base, name: "t/two", slots: { "b:c": { allow: ["t/box"] } } },
      ] as never,
      { source: "layers-drop-test-keys" }
    );
    const doc = page([
      node("a:b", "t/one"),
      node("a", "t/two"),
      node("h1", "t/heading"),
    ]);
    const placement = placementFor(doc);
    const rows = rowsOf(doc);
    expect(
      drop(doc, "h1", over(rows, "a", "lower", 1), [], placement)
    ).toMatchObject({
      kind: "refused",
      refusal: { verdict: { reason: "not-allowed-in-slot" } },
    });
    expect(
      drop(doc, "h1", over(rows, "a:b", "lower", 1), [], placement)
    ).toMatchObject({
      kind: "drop",
      to: { parentId: "a:b", slot: "c", index: 0 },
    });
  });
});
