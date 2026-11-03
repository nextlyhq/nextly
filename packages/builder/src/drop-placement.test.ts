/**
 * A canvas drop judged by the one placement rule: the refusal carries the
 * rule's whole answer, so its words name the linked block in the way, and a
 * component placement offers the slots its component exposes as regions.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  declaredSlotNames,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import { refusalWording } from "./drag-refusal";
import {
  collectRegions,
  resolveDrop,
  type DropRefusal,
  type DropRegion,
} from "./drop-targets";
import type { Rect } from "./geometry";
import { registrySlotSource } from "./inserter";

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
    { source: "test" }
  );
});

afterEach(() => {
  clearBlocks();
});

const box: Rect = { x: 0, y: 0, width: 100, height: 100 };
const rects = { rectOf: () => box, rootRect: () => box };
const sources = (components?: Map<string, BlockDocument>) => ({
  nesting: registryNestingSource(),
  definitions: registryBlockSource(),
  ...(components === undefined ? {} : { components }),
});

describe("a drop judged by the one placement rule", () => {
  it("names exactly the reasons a refusal can carry", () => {
    // `DropRefusal` is published, and a consumer switching over `reason`
    // handles a fixed set of cases. Spelled out as literals rather than as the
    // engine's alias, so a reason added on either side fails the typecheck
    // here instead of reaching that switch unannounced.
    expectTypeOf<DropRefusal["reason"]>().toEqualTypeOf<
      | "wrong-parent"
      | "restricted-at-root"
      | "not-allowed-in-slot"
      | "undeclared-slot"
      | "holds-no-blocks"
      | "phrasing-only"
      | "content-model"
    >();
  });

  it("refuses a Button over a linked card, and says the card is in the way", () => {
    const card: BlockNode = {
      id: "card",
      type: "t/card",
      version: 1,
      props: { link: "/go" },
    };
    const region: DropRegion = {
      id: "card::children",
      target: { kind: "slot", parentType: "t/card", slot: "children" },
      parentId: "card",
      slot: "children",
      depth: 1,
      rect: box,
      axis: "y",
      childIds: [],
    };
    const button: BlockNode = {
      id: "b",
      type: "t/button",
      version: 1,
      props: {},
    };
    const resolution = resolveDrop(
      {
        blockNames: ["t/button"],
        forbiddenParents: new Set(),
        regions: [region],
        nesting: registryNestingSource(),
        rects,
        placement: {
          nodes: [card],
          placing: () => [button],
          sources: sources(),
        },
      },
      { x: 10, y: 10 }
    );
    expect(resolution.kind).toBe("refused");
    if (resolution.kind !== "refused") return;
    expect(resolution.refusal.reason).toBe("content-model");
    expect(
      refusalWording(resolution.refusal, "t/button", "t/card").headline
    ).toBe("A Button can't go inside this Card.");
  });

  it("anchors an inherited refusal at the linked card, not the box it holds", () => {
    // The Button is aimed at a Box inside a linked Card. The Card refuses it,
    // so the refusal names the Card's node for the notice to sit over; the
    // region the pointer is in is still the Box's.
    const card: BlockNode = {
      id: "card",
      type: "t/card",
      version: 1,
      props: { link: "/go" },
      slots: {
        children: [{ id: "box", type: "t/card", version: 1, props: {} }],
      },
    };
    const region: DropRegion = {
      id: "box::children",
      target: { kind: "slot", parentType: "t/card", slot: "children" },
      parentId: "box",
      slot: "children",
      depth: 2,
      rect: box,
      axis: "y",
      childIds: [],
    };
    const resolution = resolveDrop(
      {
        blockNames: ["t/button"],
        forbiddenParents: new Set(),
        regions: [region],
        nesting: registryNestingSource(),
        rects,
        placement: {
          nodes: [card],
          placing: () => [{ id: "b", type: "t/button", version: 1, props: {} }],
          sources: sources(),
        },
      },
      { x: 10, y: 10 }
    );
    expect(resolution.kind).toBe("refused");
    if (resolution.kind !== "refused") return;
    expect(resolution.refusal.reason).toBe("content-model");
    expect(resolution.refusal.regionId).toBe("box::children");
    expect(resolution.refusal.parentId).toBe("card");
  });

  it("keeps the region's container when the block being placed refuses itself", () => {
    // A linked Card holding a Button breaks the rule inside itself, wherever
    // it goes. The refuser is the dragged Card, which is not on the page, so
    // the notice stays with the region it was aimed at.
    const target: BlockNode = {
      id: "plain",
      type: "t/card",
      version: 1,
      props: {},
    };
    const region: DropRegion = {
      id: "plain::children",
      target: { kind: "slot", parentType: "t/card", slot: "children" },
      parentId: "plain",
      slot: "children",
      depth: 1,
      rect: box,
      axis: "y",
      childIds: [],
    };
    const resolution = resolveDrop(
      {
        blockNames: ["t/card"],
        forbiddenParents: new Set(),
        regions: [region],
        nesting: registryNestingSource(),
        rects,
        placement: {
          nodes: [target],
          placing: () => [
            {
              id: "new-card",
              type: "t/card",
              version: 1,
              props: { link: "/go" },
              slots: {
                children: [
                  { id: "b", type: "t/button", version: 1, props: {} },
                ],
              },
            },
          ],
          sources: sources(),
        },
      },
      { x: 10, y: 10 }
    );
    expect(resolution.kind).toBe("refused");
    if (resolution.kind !== "refused") return;
    expect(resolution.refusal.reason).toBe("content-model");
    expect(resolution.refusal.parentId).toBe("plain");
  });

  it("judges a region once for the gesture, however often the pointer moves in it", () => {
    // Every pointer move and autoscroll frame resolves the drop again. The
    // document, the blocks and the regions are fixed for the gesture, so the
    // rule's answer for a region is too; counted through the nesting source
    // every verdict reads.
    let asked = 0;
    const registry = registryNestingSource();
    const counting = {
      parentsOf: (type: string) => {
        asked += 1;
        return registry.parentsOf(type);
      },
      slotAllowOf: (type: string, slot: string) => {
        asked += 1;
        return registry.slotAllowOf?.(type, slot);
      },
    };
    const card: BlockNode = {
      id: "card",
      type: "t/card",
      version: 1,
      props: {},
    };
    const region: DropRegion = {
      id: "card::children",
      target: { kind: "slot", parentType: "t/card", slot: "children" },
      parentId: "card",
      slot: "children",
      depth: 1,
      rect: box,
      axis: "y",
      childIds: [],
    };
    const query = {
      blockNames: ["t/button"],
      forbiddenParents: new Set<string>(),
      regions: [region],
      nesting: counting,
      rects,
      placement: {
        nodes: [card],
        placing: () => [{ id: "b", type: "t/button", version: 1, props: {} }],
        sources: { ...sources(), nesting: counting },
        verdicts: new Map(),
      },
    };
    expect(resolveDrop(query, { x: 10, y: 10 }).kind).toBe("target");
    // The control: judging did read the source, so the count can move.
    expect(asked).toBeGreaterThan(0);
    const once = asked;
    expect(resolveDrop(query, { x: 20, y: 20 }).kind).toBe("target");
    expect(resolveDrop(query, { x: 30, y: 30 }).kind).toBe("target");
    expect(asked).toBe(once);
  });

  it("keeps apart two regions whose ids spell the same string", () => {
    // Card `a`'s slot `b::children` and card `a::b`'s slot `children` both
    // spell the id `a::b::children`. The first is a slot the Card does not
    // declare, so it refuses; the second is the Card's own slot and accepts.
    // One gesture's answers must not hand the second the first's refusal.
    const a: BlockNode = { id: "a", type: "t/card", version: 1, props: {} };
    const ab: BlockNode = { id: "a::b", type: "t/card", version: 1, props: {} };
    const region = (parentId: string, slot: string): DropRegion => ({
      id: `${parentId}::${slot}`,
      target: { kind: "slot", parentType: "t/card", slot },
      parentId,
      slot,
      depth: 1,
      rect: box,
      axis: "y",
      childIds: [],
    });
    const verdicts = new Map();
    const at = (aimed: DropRegion) =>
      resolveDrop(
        {
          blockNames: ["t/button"],
          forbiddenParents: new Set(),
          regions: [aimed],
          nesting: registryNestingSource(),
          rects,
          placement: {
            nodes: [a, ab],
            placing: () => [
              { id: "b", type: "t/button", version: 1, props: {} },
            ],
            sources: sources(),
            verdicts,
          },
        },
        { x: 10, y: 10 }
      );
    const undeclared = region("a", "b::children");
    const declared = region("a::b", "children");
    // The premise: the two ids collide, so a cache keyed by id would mix them.
    expect(undeclared.id).toBe(declared.id);
    const first = at(undeclared);
    expect(first.kind).toBe("refused");
    if (first.kind === "refused") {
      expect(first.refusal.reason).toBe("undeclared-slot");
    }
    expect(at(declared).kind).toBe("target");
  });

  it("offers a component placement's exposed slot as a region", () => {
    const tile = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [{ id: "inner", type: "t/card", version: 1, props: {} }],
      slots: { body: { label: "Body", nodeId: "inner", slot: "children" } },
    } as unknown as BlockDocument;
    const placed: BlockNode = {
      id: "i",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "tile" },
    };
    const lookup = new Map([["tile", tile]]);
    const regions = collectRegions(
      { formatVersion: 1, kind: "page", nodes: [placed] },
      registrySlotSource(),
      rects,
      node => declaredSlotNames(node, sources(lookup))
    );
    expect(regions.map(region => region.id)).toContain("i::body");
  });
});
