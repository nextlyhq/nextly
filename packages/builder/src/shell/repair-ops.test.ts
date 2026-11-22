/**
 * A repair, of locks and placements, as the op store applies it.
 *
 * The engine's planner says what the repaired document is; the store only
 * takes ops. These turn the plan's steps into ops, and every case holds them
 * to the plan: applied in order to the document, they give exactly the plan's
 * `result`, and nothing else. A translation that placed one block a position
 * off would pass a looser check and still move an author's block somewhere
 * the preview did not show.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyOps,
  clearBlocks,
  DEFAULT_LIMITS,
  expandSlotDefaults,
  lockBreaksIn,
  lockRepairRule,
  makeNode,
  placementBreaksIn,
  placementRepairRule,
  planRepair,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
  type ContentModel,
  type RepairPlan,
  type RepairRule,
} from "@nextlyhq/blocks-engine";

import { repairOps } from "./repair-ops";

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
      // A box whose `link` prop makes it render an `<a>`, which refuses the
      // Button, an interactive block, anywhere beneath it.
      {
        ...base,
        name: "acme/box",
        slots: { children: {} },
        contentModel: (props: { link?: string }): ContentModel =>
          typeof props.link === "string"
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "acme/button",
        contentModel: (): ContentModel => ({
          is: ["flow", "phrasing", "interactive"],
        }),
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
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** Plan, translate, apply: the document the ops give, beside the plan's. */
function applied(document: BlockDocument, rules?: readonly RepairRule[]) {
  const plan = planRepair(document, sources(), rules);
  const translated = repairOps(document, plan);
  if (!("ops" in translated)) throw new Error("the repair was refused");
  const result = applyOps(document, translated.ops).document;
  return { plan, ops: translated.ops, result };
}

describe("repairOps", () => {
  it("gives no ops for a document with nothing to repair", () => {
    const document = page(placed("acme/fixed-row"));
    expect(repairOps(document, planRepair(document, sources()))).toEqual({
      ops: [],
    });
  });

  it("moves a block out, adds the missing one and restores the order, under all", () => {
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.reverse();
    row.slots!.items!.splice(1, 0, placed("acme/card", "extra"));
    const { plan, result } = applied(page(row));

    expect(plan.steps.map(step => step.kind)).toContain("move");
    expect(result).toEqual(plan.result);
    expect(lockBreaksIn(result, sources())).toEqual([]);
  });

  it("keeps the author's order under insert, the added block at its starting place", () => {
    // The extra comes first, so an add placed before the extra moved out
    // would land one position off.
    const row = placed("acme/loose-row", "row");
    row.slots!.items = [placed("acme/card", "extra"), row.slots!.items![0]!];
    const { result, plan } = applied(page(row));

    expect(result).toEqual(plan.result);
  });

  it("puts a design back inside contentOnly, keeping the content", () => {
    const card = placed("acme/sealed-card", "card");
    const headline = card.slots!.body![0]!;
    headline.props = { text: "Spring sale", align: "right" };
    headline.styles = { base: { color: "red" } } as never;
    const { result, plan, ops } = applied(page(card));

    expect(ops.map(op => op.kind)).toEqual(["update"]);
    expect(result).toEqual(plan.result);
  });

  it("moves blocks out of a nested area to just after the outermost locked block, in order", () => {
    const shelf = placed("acme/sealed-shelf", "shelf");
    shelf.slots!.main![0]!.slots!.body!.push(
      placed("acme/divider", "one"),
      placed("acme/divider", "two")
    );
    const { result, plan } = applied(
      page(placed("acme/divider", "top"), shelf)
    );

    expect(result.nodes.map(node => node.id)).toEqual([
      "top",
      "shelf",
      "one",
      "two",
    ]);
    expect(result).toEqual(plan.result);
  });

  it("refuses, naming the block, when a block it must move is locked", () => {
    // A locked block does not move until it is unlocked; the repair says so
    // rather than applying half of itself.
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push({ ...placed("acme/divider", "held"), locked: true });
    const document = page(row);

    expect(repairOps(document, planRepair(document, sources()))).toEqual({
      refused: { reason: "locked-block", nodeId: "held" },
    });
  });

  it("names the locked block inside one it must move, the one to unlock", () => {
    const row = placed("acme/fixed-row", "row");
    const card = placed("acme/card", "card");
    card.slots!.body![0] = {
      ...card.slots!.body![0]!,
      id: "inner",
      locked: true,
    };
    row.slots!.items!.push(card);
    const document = page(row);

    expect(repairOps(document, planRepair(document, sources()))).toEqual({
      refused: { reason: "locked-block", nodeId: "inner" },
    });
  });

  it("names the locked block AROUND one it must move or change, the one to unlock", () => {
    // The broken row sits inside a block the author locked in Layers. Every
    // step of its repair changes something that lock covers, so the op layer
    // refuses it; the repair names the block to unlock rather than reporting
    // that its blocks could not be placed.
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.reverse();
    const document = page({
      ...placed("acme/card", "frame"),
      locked: true,
      slots: { body: [row] },
    });

    expect(repairOps(document, planRepair(document, sources()))).toEqual({
      refused: { reason: "locked-block", nodeId: "frame" },
    });
  });
  it("puts parts back before it adds, so every step stays within the byte cap", () => {
    // A row missing its divider, and a sealed card whose headline holds a
    // large design value the lock puts back. The page and the repaired page
    // both fit the cap; the page with the divider added and the value not
    // yet put back does not.
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.pop();
    const card = placed("acme/sealed-card", "card");
    card.slots!.body![0]!.props.align = "x".repeat(4000);
    const document = page(row, card);
    const plan = planRepair(document, sources());
    expect(plan.steps.map(step => step.kind).sort()).toEqual(["add", "reset"]);
    const bytes = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value)).length;
    const maxBytes = bytes(document) + 8;
    expect(bytes(plan.result)).toBeLessThan(maxBytes);

    const translated = repairOps(document, plan, {
      ...DEFAULT_LIMITS,
      maxBytes,
    });

    expect(translated).not.toHaveProperty("refused");
  });

  it("applies the placement rule's moves after the lock rule's, giving the plan's result", () => {
    // The lock rule moves the extra Button out of the fixed row, still inside
    // the linked box; the placement rule then moves it out of the link, and
    // the second Button with it, in order.
    const row = placed("acme/fixed-row", "row");
    row.slots!.items!.push(placed("acme/button", "first"));
    const box = {
      ...placed("acme/box", "box"),
      props: { link: "/go" },
      slots: { children: [row, placed("acme/button", "second")] },
    };
    const { plan, result } = applied(page(box), [
      lockRepairRule,
      placementRepairRule,
    ]);

    expect(plan.steps.map(step => step.kind === "move" && step.cause)).toEqual([
      "lock",
      "placement",
      "placement",
    ]);
    expect(result).toEqual(plan.result);
    expect(result.nodes.map(node => node.id)).toEqual([
      "box",
      "first",
      "second",
    ]);
    expect(placementBreaksIn(result, sources())).toEqual([]);
  });

  it("places a placement move exactly after the block it names", () => {
    // Two moves out of one slot that name the same block: the second lands
    // just after it, before the first, as the plan's result has them.
    const box = {
      ...placed("acme/box", "box"),
      props: { link: "/go" },
      slots: {
        children: [placed("acme/button", "a"), placed("acme/button", "b")],
      },
    };
    const document = page(box);
    const from = { holderId: "box", slot: "children" };
    const plan: RepairPlan = {
      steps: [
        {
          kind: "move",
          cause: "placement",
          nodeId: "a",
          type: "acme/button",
          from,
          after: "box",
        },
        {
          kind: "move",
          cause: "placement",
          nodeId: "b",
          type: "acme/button",
          from,
          after: "box",
        },
      ],
      result: page(
        { ...box, slots: { children: [] } },
        box.slots.children[1]!,
        box.slots.children[0]!
      ),
      remaining: [],
      remainingPlacements: [],
    };

    const translated = repairOps(document, plan);
    if (!("ops" in translated)) throw new Error("the repair was refused");
    expect(applyOps(document, translated.ops).document).toEqual(plan.result);
  });
});
