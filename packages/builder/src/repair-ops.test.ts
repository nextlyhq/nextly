/**
 * A lock repair as the op store applies it.
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
  expandSlotDefaults,
  lockBreaksIn,
  makeNode,
  planRepair,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
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
function applied(document: BlockDocument) {
  const plan = planRepair(document, sources());
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
});
