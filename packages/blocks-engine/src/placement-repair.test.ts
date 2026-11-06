/**
 * The placement repair, through the shared planner and the real registry: a
 * block the placement rule refuses where it sits moves, with its id and
 * everything inside it, to the nearest place the rule allows; no block is
 * lost; a block with nowhere to go stays and is named; and the lock rule runs
 * first, its moves never undone by this one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ContentModel } from "./content-model";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import { lockBreaksIn } from "./lock-breaks";
import { placementBreaksIn } from "./placement-breaks";
import { placementRepairRule } from "./placement-repair";
import { lockRepairRule, planRepair } from "./repair-plan";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import { walkNodes } from "./tree";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/** A container whose `link` prop makes it render an `<a>`. */
const linkable = (props: { link?: string }): ContentModel =>
  typeof props.link === "string" && props.link !== ""
    ? { is: ["flow", "interactive"], accepts: { without: ["interactive"] } }
    : { is: ["flow"] };

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "t/box",
        slots: { children: {} },
        contentModel: linkable,
      },
      {
        ...base,
        name: "t/button",
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
      { ...base, name: "t/heading", contentModel: () => ({ is: ["flow"] }) },
      { ...base, name: "t/only-items", slots: { items: {} } },
      // A slot locked to one heading, for the lock rule to repair first.
      {
        ...base,
        name: "t/fixed",
        slots: {
          items: { defaultBlock: [{ type: "t/heading" }], lock: "all" },
        },
      },
      // A linked card whose locked slot starts with a Button: the Button
      // breaks the placement rule, and moving it out would break the lock.
      {
        ...base,
        name: "t/locked-card",
        slots: {
          body: { defaultBlock: [{ type: "t/button" }], lock: "all" },
        },
        contentModel: linkable,
      },
      // May sit only inside a box, so one at the top level has nowhere higher.
      { ...base, name: "t/box-item", parent: ["t/box"] },
    ] as never,
    { source: "test" }
  );
});

afterEach(() => {
  clearBlocks();
});

const sources = () => ({
  definitions: registryBlockSource(),
  nesting: registryNestingSource(),
});

const placementSources = () => ({
  definitions: registryBlockSource(),
  nesting: registryNestingSource(),
});

function node(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode {
  return { id, type, version: 1, props, ...(slots ? { slots } : {}) };
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
  walkNodes(doc.nodes, each => found.push(each.id));
  return found.sort();
}

/** Each block's id, with the ids inside it, as a reader sees the tree. */
function shape(nodes: readonly BlockNode[]): unknown[] {
  return nodes.map(each =>
    each.slots === undefined
      ? each.id
      : {
          [each.id]: Object.fromEntries(
            Object.entries(each.slots).map(([slot, held]) => [
              slot,
              shape(held),
            ])
          ),
        }
  );
}

/** Plans with both rules, holding every plan to the promises a repair makes. */
function repaired(doc: BlockDocument) {
  const before = structuredClone(doc);
  const plan = planRepair(doc, sources(), [
    lockRepairRule,
    placementRepairRule,
  ]);
  // The same blocks, each once, under the same ids: nothing lost or copied.
  expect(ids(plan.result)).toEqual(ids(before));
  // The document planned from is not changed.
  expect(doc).toEqual(before);
  return plan;
}

describe("placementRepairRule", () => {
  it("moves a Button out of a linked Card to just after the Card, keeping its id", () => {
    const card = node(
      "card",
      "t/box",
      { link: "/go" },
      {
        children: [node("title", "t/heading"), node("cta", "t/button")],
      }
    );
    const plan = repaired(page(card));

    expect(plan.steps).toEqual([
      {
        kind: "move",
        cause: "placement",
        nodeId: "cta",
        type: "t/button",
        from: { holderId: "card", slot: "children" },
        after: "card",
      },
    ]);
    expect(shape(plan.result.nodes)).toEqual([
      { card: { children: ["title"] } },
      "cta",
    ]);
    expect(placementBreaksIn(plan.result, placementSources())).toEqual([]);
    expect(plan.remainingPlacements).toEqual([]);
  });

  it("keeps the order of several blocks moved out of one container", () => {
    const card = node(
      "card",
      "t/box",
      { link: "/go" },
      {
        children: [
          node("first", "t/button"),
          node("title", "t/heading"),
          node("second", "t/button"),
        ],
      }
    );
    const plan = repaired(page(card, node("next", "t/heading")));

    expect(shape(plan.result.nodes)).toEqual([
      { card: { children: ["title"] } },
      "first",
      "second",
      "next",
    ]);
    // The second lands after the first, so the steps in order give the result.
    expect(plan.steps.map(step => step.kind === "move" && step.after)).toEqual([
      "card",
      "first",
    ]);
  });

  it("moves a block out of a slot its container never declares", () => {
    const list = node(
      "list",
      "t/only-items",
      {},
      {
        items: [],
        stray: [node("lost", "t/heading")],
      }
    );
    const plan = repaired(page(list));

    expect(plan.steps).toEqual([
      expect.objectContaining({
        kind: "move",
        cause: "placement",
        nodeId: "lost",
        from: { holderId: "list", slot: "stray" },
        after: "list",
      }),
    ]);
    expect(shape(plan.result.nodes)).toEqual([
      { list: { items: [], stray: [] } },
      "lost",
    ]);
    expect(placementBreaksIn(plan.result, placementSources())).toEqual([]);
  });

  it("moves a nested block to the nearest ancestor's container that allows it, not the top", () => {
    const inner = node(
      "inner",
      "t/box",
      {},
      {
        children: [node("cta", "t/button")],
      }
    );
    const linked = node(
      "linked",
      "t/box",
      { link: "/go" },
      {
        children: [inner],
      }
    );
    const outer = node("outer", "t/box", {}, { children: [linked] });
    const plan = repaired(page(outer));

    // Beside `inner` the link still surrounds it; beside `linked`, inside
    // `outer`, nothing does.
    expect(plan.steps).toEqual([
      expect.objectContaining({
        nodeId: "cta",
        from: { holderId: "inner", slot: "children" },
        after: "linked",
      }),
    ]);
    expect(shape(plan.result.nodes)).toEqual([
      {
        outer: {
          children: [
            { linked: { children: [{ inner: { children: [] } }] } },
            "cta",
          ],
        },
      },
    ]);
    expect(placementBreaksIn(plan.result, placementSources())).toEqual([]);
  });

  it("moves a break inside another break first, then the outer one, with everything kept", () => {
    // A linked box is interactive, so one inside another breaks the rule, and
    // so does the Button inside both.
    const innerLink = node(
      "inner-link",
      "t/box",
      { link: "/b" },
      {
        children: [node("cta", "t/button")],
      }
    );
    const outerLink = node(
      "outer-link",
      "t/box",
      { link: "/a" },
      {
        children: [innerLink],
      }
    );
    const plan = repaired(page(outerLink));

    expect(plan.steps.map(step => step.kind === "move" && step.nodeId)).toEqual(
      ["cta", "inner-link"]
    );
    expect(shape(plan.result.nodes)).toEqual([
      { "outer-link": { children: [] } },
      "cta",
      { "inner-link": { children: [] } },
    ]);
    expect(placementBreaksIn(plan.result, placementSources())).toEqual([]);
    expect(plan.remainingPlacements).toEqual([]);
  });

  it("leaves a block with nowhere to go where it is, and names it", () => {
    // At the top level there is nowhere higher; in the locked card, moving the
    // Button out would break the lock.
    const stranded = node("stranded", "t/box-item");
    const locked = node(
      "locked",
      "t/locked-card",
      { link: "/go" },
      {
        body: [node("cta", "t/button")],
      }
    );
    const plan = repaired(page(stranded, locked));

    expect(plan.steps).toEqual([]);
    expect(plan.result.nodes).toEqual(page(stranded, locked).nodes);
    expect(plan.remainingPlacements.map(found => found.id).sort()).toEqual([
      "cta",
      "stranded",
    ]);
    expect(lockBreaksIn(plan.result, sources())).toEqual([]);
  });

  it("runs after the lock rule, on what the lock rule left", () => {
    // The lock rule moves the extra Button out of the fixed row to just after
    // it, which is still inside the linked box; the placement rule then
    // moves it out of the link.
    const fixed = node(
      "fixed",
      "t/fixed",
      {},
      {
        items: [node("title", "t/heading"), node("cta", "t/button")],
      }
    );
    const linked = node(
      "linked",
      "t/box",
      { link: "/go" },
      {
        children: [fixed],
      }
    );
    const plan = repaired(page(linked));

    expect(
      plan.steps.map(step =>
        step.kind === "move" ? [step.cause, step.nodeId, step.after] : step.kind
      )
    ).toEqual([
      ["lock", "cta", "fixed"],
      ["placement", "cta", "linked"],
    ]);
    expect(shape(plan.result.nodes)).toEqual([
      { linked: { children: [{ fixed: { items: ["title"] } }] } },
      "cta",
    ]);
    expect(lockBreaksIn(plan.result, sources())).toEqual([]);
    expect(placementBreaksIn(plan.result, placementSources())).toEqual([]);
  });

  it("changes nothing without nesting rules to judge with", () => {
    const card = node(
      "card",
      "t/box",
      { link: "/go" },
      {
        children: [node("cta", "t/button")],
      }
    );
    const plan = planRepair(
      page(card),
      { definitions: registryBlockSource() },
      [placementRepairRule]
    );
    expect(plan.steps).toEqual([]);
    expect(plan.remainingPlacements).toEqual([]);
  });
});
