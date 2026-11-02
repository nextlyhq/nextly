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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { refusalWording } from "./drag-refusal";
import { collectRegions, resolveDrop, type DropRegion } from "./drop-targets";
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
        placement: { nodes: [card], placing: [button], sources: sources() },
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
