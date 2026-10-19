/**
 * The repair planner: what a document that breaks a lock becomes, and the
 * steps that get it there, for an author to see before anything changes.
 *
 * Its promises, each a case below: no authored block is lost and each keeps
 * its id; a block a locked slot may not hold moves to just after the OUTERMOST
 * block whose lock applies, so no lock's fixed blocks change; a missing
 * starting block is added; and the repaired document saves. The rules run in
 * the order given, so a later rule extends the plan rather than replacing it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import { DEFAULT_LIMITS } from "./limits";
import { lockBreaksIn } from "./lock-breaks";
import { lockRepairRule, planRepair, type RepairRule } from "./repair-plan";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import { expandSlotDefaults, makeNode, walkNodes } from "./tree";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
        defaultProps: { text: "Title", align: "left" },
      },
      { ...base, name: "acme/divider" },
      {
        ...base,
        name: "acme/card",
        slots: { body: { defaultBlock: [{ type: "acme/headline" }] } },
      },
      {
        ...base,
        name: "acme/sealed-card",
        slots: {
          body: {
            defaultBlock: [{ type: "acme/headline" }],
            lock: "contentOnly",
          },
        },
      },
      {
        ...base,
        name: "acme/fixed-row",
        slots: {
          items: {
            defaultBlock: [{ type: "acme/headline" }, { type: "acme/divider" }],
            lock: "all",
          },
        },
      },
      {
        ...base,
        name: "acme/loose-row",
        slots: {
          items: {
            defaultBlock: [{ type: "acme/headline" }, { type: "acme/divider" }],
            lock: "insert",
          },
        },
      },
      // An object-valued design prop, two of them in a contentOnly slot.
      {
        ...base,
        name: "acme/framed",
        props: { frame: { type: "object" } },
        defaultProps: { frame: { width: 1 } },
      },
      {
        ...base,
        name: "acme/framed-pair",
        slots: {
          body: {
            defaultBlock: [{ type: "acme/framed" }, { type: "acme/framed" }],
            lock: "contentOnly",
          },
        },
      },
      // May sit only in a fixed row, so moving one out has nowhere to go.
      { ...base, name: "acme/row-item", parent: ["acme/fixed-row"] },
      // One block with five locked slots, more breaks than it has nodes.
      {
        ...base,
        name: "acme/five-slots",
        slots: Object.fromEntries(
          ["a", "b", "c", "d", "e"].map(slot => [
            slot,
            { defaultBlock: [{ type: "acme/headline" }], lock: "all" },
          ])
        ),
      },
      {
        ...base,
        name: "acme/sealed-shelf",
        slots: {
          main: { defaultBlock: [{ type: "acme/card" }], lock: "contentOnly" },
        },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

const sources = () => ({
  definitions: registryBlockSource(),
  nesting: registryNestingSource(),
});

function placed(type: string, id?: string): BlockNode {
  const node = makeNode(
    type,
    1,
    {},
    expandSlotDefaults(type, registryBlockSource(), registryNestingSource())
  );
  return id === undefined ? node : { ...node, id };
}

function page(...nodes: BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

function ids(doc: BlockDocument): string[] {
  const found: string[] = [];
  walkNodes(doc.nodes, node => found.push(node.id));
  return found.sort();
}

/** The repaired document's top level and one slot, as types, for a reader. */
const types = (nodes: readonly BlockNode[] | undefined) =>
  (nodes ?? []).map(node => node.type);

/** Plans, and holds every plan to the promises every repair makes. */
function repaired(doc: BlockDocument, rules?: readonly RepairRule[]) {
  const before = structuredClone(doc);
  const plan = planRepair(doc, sources(), rules);
  // Nothing authored is lost, and nothing is changed in place.
  expect(ids(plan.result)).toEqual(expect.arrayContaining(ids(before)));
  // Every block has an id of its own, the added ones included.
  expect(new Set(ids(plan.result)).size).toBe(ids(plan.result).length);
  expect(doc).toEqual(before);
  // The repaired document saves.
  expect(lockBreaksIn(plan.result, sources())).toEqual([]);
  return plan;
}

describe("planRepair", () => {
  it("plans nothing for a document that breaks no lock", () => {
    const doc = page(placed("acme/fixed-row"), placed("acme/sealed-card"));
    const plan = repaired(doc);
    expect(plan.steps).toEqual([]);
    expect(plan.result).toEqual(doc);
  });

  it("moves a block a slot locked all may not hold to just after its holder, keeping its id", () => {
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push({ ...placed("acme/divider"), id: "extra" });
    const plan = repaired(page(row));
    expect(plan.steps).toEqual([
      expect.objectContaining({
        kind: "move",
        nodeId: "extra",
        from: { holderId: "row", slot: "items" },
      }),
    ]);
    expect(plan.result.nodes.map(node => node.id)).toEqual(["row", "extra"]);
  });

  it("moves it into the slot its holder sits in when the holder is not at the top", () => {
    const card = placed("acme/card", "card");
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push({ ...placed("acme/divider"), id: "extra" });
    card.slots!.body!.push(row);
    const plan = repaired(page(card));
    expect(plan.result.nodes[0]!.slots!.body!.map(node => node.id)).toEqual([
      card.slots!.body![0]!.id,
      "row",
      "extra",
    ]);
  });

  it("adds a starting block that is missing, under a new id", () => {
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.pop();
    const plan = repaired(page(row));
    expect(plan.steps).toEqual([
      expect.objectContaining({
        kind: "add",
        type: "acme/divider",
        at: { holderId: "row", slot: "items", index: 1 },
      }),
    ]);
    expect(types(plan.result.nodes[0]!.slots!.items)).toEqual([
      "acme/headline",
      "acme/divider",
    ]);
  });

  it("gives each added block an id of its own, however many slots miss the same one", () => {
    const rows = [placed("acme/fixed-row", "a"), placed("acme/fixed-row", "b")];
    for (const row of rows) row.slots!.items!.pop();
    const plan = repaired(page(...rows));
    expect(plan.steps.map(step => step.kind)).toEqual(["add", "add"]);
  });

  it("restores the starting order under all, moving nothing", () => {
    const row = placed("acme/fixed-row", "row");
    const [headline, divider] = row.slots!.items!;
    row.slots!.items = [divider!, headline!];
    const plan = repaired(page(row));
    expect(plan.steps).toEqual([
      expect.objectContaining({
        kind: "reorder",
        holderId: "row",
        slot: "items",
      }),
    ]);
    expect(plan.result.nodes[0]!.slots!.items!.map(node => node.id)).toEqual([
      headline!.id,
      divider!.id,
    ]);
  });

  it("keeps the order an insert lock allows, and moves only the block more", () => {
    const row = placed("acme/loose-row", "row");
    const [headline, divider] = row.slots!.items!;
    row.slots!.items = [
      divider!,
      { ...placed("acme/divider"), id: "extra" },
      headline!,
    ];
    const plan = repaired(page(row));
    expect(plan.steps.map(step => step.kind)).toEqual(["move"]);
    expect(plan.result.nodes[0]!.slots!.items!.map(node => node.id)).toEqual([
      divider!.id,
      headline!.id,
    ]);
  });

  it("moves a block out of a nested lock to just after the OUTERMOST locked block, so the outer slot keeps its blocks", () => {
    // The card's body inherits the shelf's contentOnly. Moving the block more
    // to just after the card would put it into the shelf's slot, which may
    // hold only the card: it goes after the shelf instead.
    const shelf = placed("acme/sealed-shelf", "shelf");
    shelf.slots!.main![0]!.slots!.body!.push({
      ...placed("acme/divider"),
      id: "extra",
    });
    const plan = repaired(page(shelf));
    // One move, straight to where it ends up: a preview naming a stop inside
    // the shelf would show the author a step that is not the repair.
    expect(plan.steps).toEqual([
      expect.objectContaining({
        kind: "move",
        nodeId: "extra",
        after: "shelf",
      }),
    ]);
    expect(plan.result.nodes.map(node => node.id)).toEqual(["shelf", "extra"]);
    expect(types(plan.result.nodes[0]!.slots!.main)).toEqual(["acme/card"]);
  });

  it("puts a block's design back as it started inside contentOnly, keeping its content", () => {
    const card = placed("acme/sealed-card", "card");
    const headline = card.slots!.body![0]!;
    headline.props.text = "Spring sale";
    headline.props.align = "right";
    headline.classes = ["promo"];
    const plan = repaired(page(card));
    expect(plan.steps).toEqual([
      expect.objectContaining({
        kind: "reset",
        nodeId: headline.id,
        parts: ['prop "align"', "classes"],
      }),
    ]);
    const after = plan.result.nodes[0]!.slots!.body![0]!;
    expect(after.id).toBe(headline.id);
    expect(after.props).toEqual({ text: "Spring sale", align: "left" });
    expect(after.classes).toBeUndefined();
  });

  it("places several blocks out of one slot after each other, so the steps give the result's order", () => {
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push(
      { ...placed("acme/divider"), id: "one" },
      { ...placed("acme/divider"), id: "two" }
    );
    const plan = repaired(page(row));
    expect(
      plan.steps.map(step =>
        step.kind === "move" ? [step.nodeId, step.after] : []
      )
    ).toEqual([
      ["one", "row"],
      ["two", "one"],
    ]);
    expect(plan.result.nodes.map(node => node.id)).toEqual([
      "row",
      "one",
      "two",
    ]);
  });

  it("repairs every locked slot of a block, however many it declares", () => {
    const block = placed("acme/five-slots", "five");
    delete block.slots;
    const plan = repaired(page(block));
    expect(plan.steps.map(step => step.kind)).toEqual([
      "add",
      "add",
      "add",
      "add",
      "add",
    ]);
  });

  it("leaves a break whose block has nowhere it may go, names it, and repairs the rest", () => {
    // The row item may sit only in a fixed row: just after the row is the top
    // of the page, which its nesting rule refuses.
    const stuck = placed("acme/fixed-row", "stuck");
    stuck.slots!.items!.push({ ...placed("acme/row-item"), id: "item" });
    const other = placed("acme/fixed-row", "other");
    other.slots!.items!.push({ ...placed("acme/divider"), id: "extra" });
    const plan = planRepair(page(stuck, other), sources());
    expect(plan.steps).toEqual([
      expect.objectContaining({ kind: "move", nodeId: "extra" }),
    ]);
    expect(plan.remaining).toEqual([
      expect.objectContaining({ holderId: "stuck", slot: "items" }),
    ]);
    // Nothing moved where the rule refuses it, and nothing lost.
    expect(plan.result.nodes.map(node => node.id)).toEqual([
      "stuck",
      "other",
      "extra",
    ]);
  });

  it("puts back only the design parts the lock refuses, keeping one the stored copy holds", () => {
    // Stored aligned right, which the save keeps; the class is new.
    const card = placed("acme/sealed-card", "card");
    card.slots!.body![0]!.props.align = "right";
    const stored = page(structuredClone(card));
    card.slots!.body![0]!.classes = ["promo"];
    const plan = planRepair(page(card), { ...sources(), stored: [stored] });
    expect(plan.steps).toEqual([
      expect.objectContaining({ kind: "reset", parts: ["classes"] }),
    ]);
    const after = plan.result.nodes[0]!.slots!.body![0]!;
    expect(after.props.align).toBe("right");
    expect(after.classes).toBeUndefined();
    expect(plan.remaining).toEqual([]);
  });

  it("plans nothing for a document past its depth limit, without walking it unbounded", () => {
    // Deeper than any stored page may be, and deeper than a recursive walk or
    // a copy of it can go.
    let node = placed("acme/card", "d0");
    const top = node;
    for (let depth = 1; depth < 20_000; depth += 1) {
      const child = { ...placed("acme/divider"), id: `d${depth}` };
      node.slots = { body: [child] };
      node = child;
    }
    const plan = planRepair(page(top), sources());
    expect(plan.steps).toEqual([]);
    expect(plan.result.nodes[0]).toBe(top);
  });

  it("finds a holder beneath a node storing more slot names than the node cap", () => {
    // Four nodes, within a cap of four, but the card stores five slot names.
    // The repair finds the row where validation's walk does.
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.reverse();
    const card = placed("acme/card", "card");
    card.slots = { a: [], b: [], c: [], d: [], body: [row] };
    const limits = { ...DEFAULT_LIMITS, maxNodes: 4 };
    const plan = planRepair(page(card), { ...sources(), limits });
    expect(plan.steps.map(step => step.kind)).toEqual(["reorder"]);
    expect(plan.remaining).toEqual([]);
  });

  it("plans nothing when the blocks it would add take the page past its limits", () => {
    // One row missing both its starting blocks: within a cap of two nodes as
    // it is, three once repaired, which a save would refuse.
    const row = placed("acme/fixed-row", "row");
    delete row.slots;
    const limits = { ...DEFAULT_LIMITS, maxNodes: 2 };
    const plan = planRepair(page(row), { ...sources(), limits });
    expect(plan.steps).toEqual([]);
    expect(plan.remaining).not.toEqual([]);
  });

  it("lists a slot's moves before its reorder, so the steps applied in order give the result", () => {
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.reverse();
    row.slots!.items!.push({ ...placed("acme/divider"), id: "extra" });
    const plan = repaired(page(row));
    expect(plan.steps.map(step => step.kind)).toEqual(["move", "reorder"]);
  });

  it("gives each block it puts back a design value of its own", () => {
    // Two holders of one type, each child reset from the starting blocks the
    // plan expands once for that type: an edit to one must not change the
    // other.
    const pairs = [
      placed("acme/framed-pair", "a"),
      placed("acme/framed-pair", "b"),
    ];
    for (const pair of pairs) {
      for (const child of pair.slots!.body!) child.props.frame = { width: 9 };
    }
    const plan = repaired(page(...pairs));
    const first = plan.result.nodes[0]!.slots!.body![0]!;
    const second = plan.result.nodes[1]!.slots!.body![0]!;
    expect(first.props.frame).toEqual(second.props.frame);
    expect(first.props.frame).not.toBe(second.props.frame);
  });

  it("repairs several breaks in one plan", () => {
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push({ ...placed("acme/divider"), id: "extra" });
    const card = placed("acme/sealed-card", "card");
    card.slots!.body![0]!.props.align = "right";
    const plan = repaired(page(row, card));
    expect(plan.steps.map(step => step.kind).sort()).toEqual(["move", "reset"]);
  });

  it("runs the rules it is given in order, each on what the one before left", () => {
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push({ ...placed("acme/divider"), id: "extra" });
    const seen: string[][] = [];
    const later: RepairRule = {
      name: "test/later",
      apply(document) {
        seen.push(document.nodes.map(node => node.id));
        return { document, steps: [] };
      },
    };
    repaired(page(row), [lockRepairRule, later]);
    // The later rule received the document with the lock already repaired.
    expect(seen).toEqual([["row", "extra"]]);
  });
});
