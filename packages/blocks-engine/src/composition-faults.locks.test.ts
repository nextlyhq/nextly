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
      // A box that locks nothing, so a box inside a sealed slot inherits it.
      {
        ...base,
        name: "acme/plain-box",
        slots: { inner: { defaultBlock: [{ type: "acme/headline" }] } },
      },
      {
        ...base,
        name: "acme/sealed-shelf",
        slots: {
          shelf: {
            defaultBlock: [{ type: "acme/plain-box" }],
            lock: "contentOnly",
          },
        },
      },
      // Locks "all" a slot that starts with a box holding a headline.
      {
        ...base,
        name: "acme/fixed-shelf",
        slots: {
          items: { defaultBlock: [{ type: "acme/plain-box" }], lock: "all" },
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

describe("a placement inside a lock a component's slot inherits", () => {
  it("is refused for a value that changes design two levels beneath the lock", () => {
    // The headline's own box declares no lock; it is held because its box sits
    // in the shelf's contentOnly slot. Only a lock passed down the composed
    // tree reaches it.
    const shelf = placed("acme/sealed-shelf", "shelf");
    const box = shelf.slots!.shelf![0]!;
    box.slots!.inner![0] = { ...box.slots!.inner![0]!, id: "deep" };
    const definition = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [shelf],
      exposed: [
        {
          id: "side",
          label: "Alignment",
          nodeId: "deep",
          propPath: "align",
          type: "select",
          options: [{ value: "right", label: "Right" }],
        },
      ],
    } as ComponentDocument;
    const host = placement({
      props: { componentId: "promo", overrides: { side: "right" } },
    });
    const composition = resolveComponentInstances(
      host,
      new Map([["promo", definition]])
    );
    const faults = compositionFaults(host, composition, {
      nesting: registryNestingSource(),
      definitions: registryBlockSource(),
    });
    expect(faults.map(f => [f.code, f.instanceId])).toEqual([
      ["locked-slot-content-only", "i1"],
    ]);
  });
});

describe("a placement supplying content to a locked exposed slot", () => {
  /** A component exposing the shelf's locked slot, beside the sealed card. */
  function shelfComponent(): ComponentDocument {
    const doc = promo();
    const shelf = placed("acme/fixed-shelf", "shelf");
    return {
      ...doc,
      nodes: [...doc.nodes, shelf],
      slots: {
        ...(doc.slots ?? {}),
        stock: { label: "Stock", nodeId: "shelf", slot: "items" },
      },
    } as ComponentDocument;
  }

  function judgeWith(host: BlockDocument) {
    const composition = resolveComponentInstances(
      host,
      new Map([["promo", shelfComponent()]])
    );
    return compositionFaults(host, composition, {
      nesting: registryNestingSource(),
      definitions: registryBlockSource(),
    });
  }

  it("holds the lock inside a container it supplies, as the slot inherits it", () => {
    // The box is the slot's starting block, so the slot itself holds what it
    // starts with; the box's own slot inherits "all", and the page's box puts
    // a second headline in it.
    const box = placed("acme/plain-box", "b1");
    box.slots!.inner!.push(makeNode("acme/headline", 1, {}));
    const faults = judgeWith(placement({ slots: { stock: [box] } }));
    expect(faults.map(f => [f.code, f.instanceId])).toEqual([
      ["locked-slot-altered", "i1"],
    ]);
  });

  it("says the placement changes which blocks the slot holds, when it removes them", () => {
    // Supplying nothing removes the box the slot starts with.
    const faults = judgeWith(placement({ slots: { stock: [] } }));
    expect(faults.map(f => f.code)).toEqual(["locked-slot-altered"]);
    expect(faults[0]!.message).not.toContain("puts other blocks");
    expect(faults[0]!.message).toContain("starts with");
  });

  it("reports each locked slot a placement breaks, not one per placement", () => {
    // Two slots locked "all", each broken by the same placement: one fault
    // per placement and rule would name only the first.
    const faults = judgeWith(
      placement({
        slots: {
          stock: [],
          extra: [
            makeNode("acme/headline", 1, {}),
            makeNode("acme/headline", 1, {}),
          ],
        },
      })
    );
    expect(faults.map(f => f.code)).toEqual([
      "locked-slot-altered",
      "locked-slot-altered",
    ]);
    expect(faults.map(f => f.message).join(" ")).toContain('"items"');
    // Both slots are called "items"; each message names the block holding
    // its slot, so an author can tell the two apart.
    expect(faults[0]!.message).not.toEqual(faults[1]!.message);
    expect(faults.map(f => f.message).join(" ")).toContain('"acme/fixed-row"');
    expect(faults.map(f => f.message).join(" ")).toContain(
      '"acme/fixed-shelf"'
    );
  });
});

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

describe("a placement judged with what its page already holds", () => {
  // The composed page's stored forms, and the page with its placements as
  // their components hold them, are what a caller passes as baselines: a part
  // one of them already holds is kept, so a block whose defaults changed does
  // not freeze every page that places it.
  function judgeAgainst(host: BlockDocument, baselines: readonly unknown[]) {
    const composition = resolveComponentInstances(
      host,
      new Map([["promo", promo()]])
    );
    return compositionFaults(host, composition, {
      nesting: registryNestingSource(),
      definitions: registryBlockSource(),
      baselines,
    });
  }

  function composedOf(host: BlockDocument) {
    return resolveComponentInstances(host, new Map([["promo", promo()]]))
      .document;
  }

  const moved = () =>
    placement({
      props: { componentId: "promo", overrides: { side: "right" } },
    });

  it("keeps a value a baseline already holds at the same place", () => {
    expect(judgeAgainst(moved(), [composedOf(moved())])).toEqual([]);
    // The control: without it the same placement is refused.
    expect(judgeAgainst(moved(), []).map(f => f.code)).toEqual([
      "locked-slot-content-only",
    ]);
  });

  it("refuses a value neither the starting block nor any baseline holds", () => {
    expect(
      judgeAgainst(moved(), [composedOf(placement())]).map(f => f.code)
    ).toEqual(["locked-slot-content-only"]);
  });
});

describe("what a lock fault says about the break, for an editor to word", () => {
  // An editor refusing the edit before it happens words it itself, and tells
  // a break the edit adds from one the page already had by where it is: the
  // block whose slot is locked, the slot, and the rule.
  it("names the holder, the slot and what changed, under contentOnly", () => {
    const host = placement({
      props: { componentId: "promo", overrides: { side: "right" } },
    });
    const faults = judge(host);
    expect(faults.map(fault => fault.lock)).toEqual([
      {
        // The holder as composed: the definition's node under the id the
        // composition gives it for this placement.
        holderId: expect.stringMatching(/^cx-/),
        holderType: "acme/sealed-card",
        slot: "body",
        lock: "contentOnly",
        childType: "acme/headline",
        changes: ['prop "align"'],
        held: [],
        heldCount: 0,
      },
    ]);
    // The same placement composed again names the same holder, so a break
    // before an edit and after it can be told apart from a new one.
    expect(judge(structuredClone(host))[0]!.lock!.holderId).toBe(
      faults[0]!.lock!.holderId
    );
  });

  it("names the holder, the slot and the rule, for the blocks a slot holds", () => {
    const faults = judge(
      placement({
        slots: {
          extra: [
            makeNode("acme/headline", 1, {}),
            makeNode("acme/headline", 1, {}),
          ],
        },
      })
    );
    expect(faults.map(fault => fault.lock)).toEqual([
      {
        holderId: expect.stringMatching(/^cx-/),
        holderType: "acme/fixed-row",
        slot: "items",
        lock: "all",
        changes: [],
        held: ["acme/headline", "acme/headline"],
        heldCount: 2,
      },
    ]);
  });

  it("tells a slot already broken from the same slot given another block", () => {
    const giving = (count: number) =>
      judge(
        placement({
          slots: {
            extra: Array.from({ length: count }, () =>
              makeNode("acme/headline", 1, {})
            ),
          },
        })
      )[0]!.lock!;
    expect(giving(3).heldCount).toBe(3);
    expect(giving(3)).not.toEqual(giving(2));
  });
});
