/**
 * A placement cannot reach past a lock inside the component it places.
 *
 * A page validated alone sees one node for a placement, and the component
 * validated alone holds its locked slots as they started. What the page
 * finally draws is the composition: the placement's exposed values written
 * into the definition's nodes, and its slot content put inside them. A lock in
 * the definition holds there too, so this judges the composed tree, and names
 * the placement that broke it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compositionFaults } from "./composition-faults";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "./document";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import { resolveComponentInstances } from "./resolve-instances";
import { expandSlotDefaults, makeNode } from "./tree";

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
          items: { defaultBlock: [{ type: "acme/headline" }], lock: "all" },
        },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

/** A block as inserting it places it, under a fixed id. */
function placed(type: string, id: string): BlockNode {
  const node = makeNode(
    type,
    1,
    {},
    expandSlotDefaults(type, registryBlockSource(), registryNestingSource())
  );
  return { ...node, id };
}

/** The promo component: one sealed card, its headline exposed both ways. */
function promo(): ComponentDocument {
  const card = placed("acme/sealed-card", "card");
  const headline = card.slots!.body![0]!;
  card.slots!.body![0] = { ...headline, id: "headline" };
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [card, placed("acme/fixed-row", "row")],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "headline",
        propPath: "text",
        type: "text",
      },
      {
        id: "side",
        label: "Alignment",
        nodeId: "headline",
        propPath: "align",
        type: "select",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ],
      },
    ],
    // Points at a locked slot inside the definition.
    slots: { extra: { label: "Extra", nodeId: "row", slot: "items" } },
  } as ComponentDocument;
}

function placement(extra: Partial<BlockNode> = {}): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "i1",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "promo" },
        ...extra,
      },
    ],
  };
}

function judge(host: BlockDocument) {
  const composition = resolveComponentInstances(
    host,
    new Map([["promo", promo()]])
  );
  return compositionFaults(host, composition, {
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
  });
}

describe("a placement inside a component's locked slot", () => {
  it("is accepted as placed, and with a new value for a content field", () => {
    // The positive control: a judge refusing every placement of a component
    // holding a lock would satisfy each refusal below.
    expect(judge(placement())).toEqual([]);
    expect(
      judge(
        placement({
          props: { componentId: "promo", overrides: { title: "Sale" } },
        })
      )
    ).toEqual([]);
  });

  it("is refused for a value that changes what is not content, naming the placement and the rule", () => {
    const faults = judge(
      placement({
        props: { componentId: "promo", overrides: { side: "right" } },
      })
    );
    expect(faults.map(f => [f.code, f.instanceId, f.componentId])).toEqual([
      ["locked-slot-content-only", "i1", "promo"],
    ]);
    expect(faults[0]!.message).toContain('"body"');
    expect(faults[0]!.message).toContain("contentOnly");
    expect(faults[0]!.message).toContain('"align"');
  });

  it("accepts content it supplies to an exposed slot that keeps the slot's starting blocks", () => {
    // Under "all" the blocks' content may change; supplying the same blocks
    // with new text is an edit of content, not of the arrangement.
    expect(
      judge(
        placement({
          slots: { extra: [makeNode("acme/headline", 1, { text: "New" })] },
        })
      )
    ).toEqual([]);
  });

  it("is refused for content it supplies to an exposed slot that a lock holds", () => {
    const faults = judge(
      placement({
        // One block more than the slot starts with.
        slots: {
          extra: [
            makeNode("acme/headline", 1, { text: "First" }),
            makeNode("acme/headline", 1, { text: "More" }),
          ],
        },
      })
    );
    expect(faults.map(f => [f.code, f.instanceId])).toEqual([
      ["locked-slot-altered", "i1"],
    ]);
    expect(faults[0]!.message).toContain('"items"');
    expect(faults[0]!.message).toContain('"all"');
  });

  it("judges no lock when the caller supplies no definitions", () => {
    const host = placement({
      props: { componentId: "promo", overrides: { side: "right" } },
    });
    const composition = resolveComponentInstances(
      host,
      new Map([["promo", promo()]])
    );
    expect(
      compositionFaults(host, composition, { nesting: registryNestingSource() })
    ).toEqual([]);
  });
});
