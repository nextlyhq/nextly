/**
 * Where a dragged block can land, and which of those places the pointer means.
 *
 * Every fixture here carries a RELATIONSHIP between adjacent candidates rather
 * than a tidy shape, because that is what separates this model from the one it
 * replaces. Children of equal height, containers that do not overlap and rows
 * of uniform width all resolve correctly under a ranking that measures to a
 * rectangle's centre — so a fixture built to look like a page cannot show that
 * the line model is doing anything.
 *
 * @module drop-targets.test
 */
import { describe, expect, it } from "vitest";

import type {
  BlockDocument,
  BlockNode,
  NestingSource,
} from "@nextlyhq/blocks-engine";

import {
  axisOfRects,
  collectRegions,
  movingSubtree,
  regionAt,
  resolveDrop,
  ROOT_REGION,
  targetsInRegion,
  type DropRegion,
  type DropTarget,
  type RectSource,
} from "./drop-targets";
import type { Rect } from "./geometry";
import type { SlotSource } from "./inserter";

/** Rectangles from a literal map, and a canvas that holds all of them. */
function rectsOf(
  map: Record<string, Rect>,
  root: Rect = { x: 0, y: 0, width: 400, height: 1000 }
): RectSource {
  return {
    rectOf: id => map[id],
    rootRect: () => root,
  };
}

/** Slots from a literal map, standing in for the block definitions. */
function slotsOf(map: Record<string, readonly string[]>): SlotSource {
  return { slotsOf: type => map[type] };
}

/** A nesting source that permits everything, so nesting never masks a case. */
const PERMISSIVE: NestingSource = {
  parentsOf: () => undefined,
  slotAllowOf: () => undefined,
};

function node(
  id: string,
  type: string,
  slots?: Record<string, BlockNode[]>
): BlockNode {
  return {
    id,
    type,
    version: 1,
    props: {},
    ...(slots ? { slots } : {}),
  } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** The one region a flat document has, built the way the resolver builds it. */
function rootRegion(childIds: string[], axis: "x" | "y" = "y"): DropRegion {
  return {
    id: ROOT_REGION,
    at: { at: "root" },
    depth: 0,
    rect: { x: 0, y: 0, width: 400, height: 1000 },
    axis,
    childIds,
  };
}

describe("axisOfRects", () => {
  it("reads a vertical stack as running down the page", () => {
    expect(
      axisOfRects([
        { x: 0, y: 0, width: 400, height: 50 },
        { x: 0, y: 50, width: 400, height: 50 },
      ])
    ).toBe("y");
  });

  it("reads a row as running across it", () => {
    expect(
      axisOfRects([
        { x: 0, y: 0, width: 100, height: 200 },
        { x: 100, y: 0, width: 100, height: 200 },
      ])
    ).toBe("x");
  });

  it("takes vertical when there is no evidence", () => {
    // One child cannot indicate a direction, and page content runs down the
    // page far more often than across — so the default is not arbitrary.
    expect(axisOfRects([{ x: 0, y: 0, width: 10, height: 10 }])).toBe("y");
    expect(axisOfRects([])).toBe("y");
  });

  it("reads the direction from where children LANDED, not from their shape", () => {
    // Two wide, short children stacked vertically. An axis guessed from the
    // aspect ratio of the rectangles would call these horizontal; where they
    // sit relative to each other is what actually decides it.
    expect(
      axisOfRects([
        { x: 0, y: 0, width: 400, height: 4 },
        { x: 0, y: 20, width: 400, height: 4 },
      ])
    ).toBe("y");
  });
});

describe("targetsInRegion", () => {
  it("gives a region with n children n+1 lines", () => {
    const targets = targetsInRegion(
      rootRegion(["a", "b"]),
      rectsOf({
        a: { x: 0, y: 0, width: 400, height: 100 },
        b: { x: 0, y: 100, width: 400, height: 100 },
      })
    );

    expect(targets.map(t => t.at)).toEqual([
      { index: 0 },
      { index: 1 },
      { index: 2 },
    ]);
  });

  it("puts the lines on the edges and in the gap between", () => {
    // A 20px gap between the two blocks. The interior line sits in the MIDDLE
    // of it: reading either edge alone puts the line against one of the two
    // blocks, so a margin makes it look like it belongs to that block rather
    // than to the space separating them.
    const targets = targetsInRegion(
      rootRegion(["a", "b"]),
      rectsOf({
        a: { x: 0, y: 0, width: 400, height: 100 },
        b: { x: 0, y: 120, width: 400, height: 100 },
      })
    );

    expect(targets.map(t => t.line)).toEqual([0, 110, 220]);
  });

  it("draws across the region, on the axis the region runs", () => {
    const [vertical] = targetsInRegion(
      rootRegion(["a"]),
      rectsOf({ a: { x: 0, y: 10, width: 400, height: 100 } })
    );
    expect(vertical).toMatchObject({ axis: "y", from: 0, to: 400 });

    const [horizontal] = targetsInRegion(
      rootRegion(["a"], "x"),
      rectsOf({ a: { x: 10, y: 0, width: 100, height: 400 } })
    );
    // An x-axis region separates its children left to right, so the line is
    // VERTICAL and its extent is the region's height.
    expect(horizontal).toMatchObject({ axis: "x", from: 0, to: 1000 });
  });

  it("gives an empty region one line across its middle", () => {
    // The only way to fill a container that has just been inserted. An edge
    // would read as "beside this container" rather than "inside it".
    const region: DropRegion = {
      id: "box::children",
      at: { at: "slot", parentType: "core/box", slot: "children" },
      parentId: "box",
      slot: "children",
      depth: 1,
      rect: { x: 0, y: 100, width: 400, height: 200 },
      axis: "y",
      childIds: [],
    };

    const targets = targetsInRegion(region, rectsOf({}));

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      line: 200,
      at: { parentId: "box", slot: "children", index: 0 },
    });
  });

  it("keeps a child's INDEX when it rendered nothing measurable", () => {
    // THE case. The op addresses a position in the STORED children, so
    // renumbering around an unrendered node would drop the block at a different
    // index from the one the line was drawn for. Here "b" is missing from the
    // rect source, and the line after "c" must still be index 3.
    const targets = targetsInRegion(
      rootRegion(["a", "b", "c"]),
      rectsOf({
        a: { x: 0, y: 0, width: 400, height: 100 },
        c: { x: 0, y: 100, width: 400, height: 100 },
      })
    );

    expect(targets.map(t => t.at)).toEqual([
      { index: 0 },
      { index: 2 },
      { index: 3 },
    ]);
  });

  it("addresses a slot region by parent and slot, never by position", () => {
    const region: DropRegion = {
      id: "box::children",
      at: { at: "slot", parentType: "core/box", slot: "children" },
      parentId: "box",
      slot: "children",
      depth: 1,
      rect: { x: 0, y: 0, width: 400, height: 200 },
      axis: "y",
      childIds: ["kid"],
    };

    const targets = targetsInRegion(
      region,
      rectsOf({ kid: { x: 0, y: 10, width: 400, height: 100 } })
    );

    expect(targets.map(t => t.at)).toEqual([
      { parentId: "box", slot: "children", index: 0 },
      { parentId: "box", slot: "children", index: 1 },
    ]);
  });
});

describe("collectRegions", () => {
  const slots = slotsOf({ "core/box": ["children"], "core/row": ["items"] });

  it("gives a container a region from its DEFINITION, not from its node", () => {
    // An empty container carries no `slots` key at all, so asking the node
    // produces no region for exactly the containers that most need one — and an
    // author could never fill anything they had just inserted.
    const regions = collectRegions(
      documentOf([node("box", "core/box")]),
      slots,
      rectsOf({ box: { x: 0, y: 0, width: 400, height: 200 } })
    );

    expect(regions.map(r => r.id)).toEqual([ROOT_REGION, "box::children"]);
    expect(regions[1]).toMatchObject({ childIds: [], depth: 1 });
  });

  it("skips a container that rendered nothing measurable", () => {
    // Rather than giving it a zero rectangle. A zero rectangle contains no
    // point so it would never resolve, but it WOULD sit in the list claiming to
    // be droppable — an absence that reads as a presence.
    const regions = collectRegions(
      documentOf([node("box", "core/box")]),
      slots,
      rectsOf({})
    );

    expect(regions.map(r => r.id)).toEqual([ROOT_REGION]);
  });

  it("reports a nested container as deeper than the one holding it", () => {
    const regions = collectRegions(
      documentOf([
        node("outer", "core/box", { children: [node("inner", "core/row")] }),
      ]),
      slots,
      rectsOf({
        outer: { x: 0, y: 0, width: 400, height: 300 },
        inner: { x: 20, y: 20, width: 360, height: 100 },
      })
    );

    expect(regions.map(r => [r.id, r.depth])).toEqual([
      [ROOT_REGION, 0],
      ["outer::children", 1],
      ["inner::items", 2],
    ]);
  });

  it("gives a block with no declared slots no region", () => {
    const regions = collectRegions(
      documentOf([node("h", "core/heading")]),
      slots,
      rectsOf({ h: { x: 0, y: 0, width: 400, height: 40 } })
    );

    expect(regions.map(r => r.id)).toEqual([ROOT_REGION]);
  });
});

describe("regionAt", () => {
  const outer: DropRegion = {
    id: "outer::children",
    at: { at: "slot", parentType: "core/box", slot: "children" },
    parentId: "outer",
    slot: "children",
    depth: 1,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    axis: "y",
    childIds: ["inner"],
  };
  const inner: DropRegion = {
    id: "inner::items",
    at: { at: "slot", parentType: "core/row", slot: "items" },
    parentId: "inner",
    slot: "items",
    depth: 2,
    rect: { x: 20, y: 20, width: 360, height: 100 },
    axis: "x",
    childIds: [],
  };
  const regions = [rootRegion(["outer"]), outer, inner];

  it("gives the pointer to the DEEPEST container holding it", () => {
    // Nested containers overlap by construction, so depth is what stops an
    // ancestor claiming a pointer that is inside its own child.
    expect(regionAt(regions, { x: 100, y: 50 })?.id).toBe("inner::items");
    expect(regionAt(regions, { x: 100, y: 200 })?.id).toBe("outer::children");
    expect(regionAt(regions, { x: 100, y: 500 })?.id).toBe(ROOT_REGION);
  });

  it("reports nothing when the pointer has left the canvas", () => {
    // Not the root as a fallback. Falling back would let a drop resolve from a
    // pointer that had left the canvas, which is how a block lands on the page
    // after a drag the author abandoned by dragging away.
    expect(regionAt(regions, { x: 100, y: 2000 })).toBeUndefined();
  });

  it("skips a region inside the block being dragged", () => {
    // Skipped rather than refused, so the pointer falls through to the
    // container around it: an author dragging a box over its own interior means
    // "put it beside itself".
    expect(regionAt(regions, { x: 100, y: 50 }, new Set(["inner"]))?.id).toBe(
      "outer::children"
    );
    expect(
      regionAt(regions, { x: 100, y: 50 }, new Set(["outer", "inner"]))?.id
    ).toBe(ROOT_REGION);
  });
});

describe("movingSubtree", () => {
  it("collects the node and everything under it", () => {
    const document = documentOf([
      node("outer", "core/box", {
        children: [
          node("inner", "core/row", { items: [node("leaf", "core/heading")] }),
        ],
      }),
    ]);

    expect([...movingSubtree(document, "outer")].sort()).toEqual([
      "inner",
      "leaf",
      "outer",
    ]);
  });

  it("is empty for a palette drag and for an id the document lost", () => {
    const document = documentOf([node("a", "core/heading")]);

    expect(movingSubtree(document, undefined).size).toBe(0);
    expect(movingSubtree(document, "gone").size).toBe(0);
  });
});

describe("resolveDrop", () => {
  /** Two children of very UNEQUAL height, which is the separating fixture. */
  const unequal = {
    regions: [rootRegion(["tall", "short"])],
    rects: rectsOf({
      tall: { x: 0, y: 0, width: 400, height: 300 },
      short: { x: 0, y: 300, width: 400, height: 20 },
    }),
    nesting: PERMISSIVE,
    blockName: "core/heading",
    forbiddenParents: new Set<string>(),
  };

  function targetAt(y: number): DropTarget {
    const resolution = resolveDrop(unequal, { x: 200, y });
    if (resolution.kind !== "target") {
      throw new Error(
        `expected a target at y=${String(y)}, got ${resolution.kind}`
      );
    }
    return resolution.target;
  }

  it("switches at each child's CENTRE, whatever the children's sizes are", () => {
    // THE test this model exists for. The lines are at 0, 300 and 320, so the
    // boundaries fall at 150 (the tall child's centre) and 310 (the short
    // one's).
    //
    // A ranker measuring to the middle of a drop ZONE would put the boundary
    // between index 1 and index 2 near the middle of the GAP between the two
    // zones instead — and with a 20px child against a 300px one, that is
    // nowhere near the short child's centre. y=305 is inside the short block's
    // leading half and must still resolve to index 1.
    expect(targetAt(140).at).toEqual({ index: 0 });
    expect(targetAt(160).at).toEqual({ index: 1 });
    expect(targetAt(305).at).toEqual({ index: 1 });
    expect(targetAt(315).at).toEqual({ index: 2 });
  });

  it("carries the line it resolved to, so the indicator and the drop agree", () => {
    // Produced together rather than by two calls: computed apart, the indicator
    // and the drop can be derived from different readings and the block lands
    // somewhere other than where the line was drawn.
    expect(targetAt(160)).toMatchObject({ line: 300, at: { index: 1 } });
  });

  it("refuses with the engine's reason when the region will not take the block", () => {
    const regions = [
      {
        id: "acc::panels",
        at: { at: "slot", parentType: "core/accordion", slot: "panels" },
        parentId: "acc",
        slot: "panels",
        depth: 1,
        rect: { x: 0, y: 0, width: 400, height: 200 },
        axis: "y",
        childIds: [],
      } satisfies DropRegion,
    ];

    const resolution = resolveDrop(
      {
        blockName: "core/heading",
        forbiddenParents: new Set(),
        regions,
        rects: rectsOf({}),
        // The container's half of the rule: the slot names what it holds.
        nesting: {
          parentsOf: () => undefined,
          slotAllowOf: () => ["core/accordion-item"],
        },
      },
      { x: 100, y: 100 }
    );

    // A refusal rather than an absent target, because the canvas has to say
    // WHY: the author aimed at this region.
    //
    // `parentId` travels with it for the same reason `permitted` does. A region
    // is identified by `"<parentId>::<slot>"`, which is a composite the surface
    // drawing the refusal would otherwise have to take apart with a string
    // split — and a container is the thing that has to be outlined and named,
    // so the id of the node is the fact a caller actually needs.
    expect(resolution).toEqual({
      kind: "refused",
      refusal: {
        regionId: "acc::panels",
        parentId: "acc",
        reason: "not-allowed-in-slot",
        permitted: ["core/accordion-item"],
      },
    });
  });

  it("carries no parent on a refusal at the ROOT region", () => {
    // The root has no container node, so there is nothing to outline or name.
    // Absent rather than a sentinel: a caller can then ask whether there is a
    // container at all, which is exactly what separates `restricted-at-root`
    // from a refusal an author can fix by aiming somewhere else.
    const resolution = resolveDrop(
      {
        blockName: "core/accordion-item",
        forbiddenParents: new Set(),
        regions: [
          {
            id: ROOT_REGION,
            at: { at: "root" },
            depth: 0,
            rect: { x: 0, y: 0, width: 400, height: 200 },
            axis: "y",
            childIds: [],
          } satisfies DropRegion,
        ],
        rects: rectsOf({}),
        nesting: {
          parentsOf: () => ["core/accordion"],
          slotAllowOf: () => undefined,
        },
      },
      { x: 100, y: 100 }
    );

    // `toStrictEqual`, not `toEqual`. The looser matcher IGNORES properties
    // whose value is undefined, so it passes whether the key is absent or
    // present-and-empty — which is the exact distinction being asserted, and
    // the one the docblock promises. A test that cannot see the difference is
    // not coverage of it.
    expect(resolution).toStrictEqual({
      kind: "refused",
      refusal: {
        regionId: ROOT_REGION,
        reason: "restricted-at-root",
        permitted: ["core/accordion"],
      },
    });
  });

  it("refuses on the CHILD's half of the rule too", () => {
    // Both halves are asked, and neither implies the other. Here the slot takes
    // anything and the block itself declares where it belongs.
    const resolution = resolveDrop(
      {
        blockName: "core/accordion-item",
        forbiddenParents: new Set(),
        regions: [rootRegion([])],
        rects: rectsOf({}),
        nesting: {
          parentsOf: type =>
            type === "core/accordion-item" ? ["core/accordion"] : undefined,
        },
      },
      { x: 100, y: 100 }
    );

    expect(resolution).toMatchObject({
      kind: "refused",
      refusal: { reason: "restricted-at-root" },
    });
  });

  it("reports nothing when the pointer is off the canvas", () => {
    expect(resolveDrop(unequal, { x: 200, y: 5000 })).toEqual({ kind: "none" });
  });

  it("keeps the EARLIER index when two lines coincide", () => {
    // Two lines land on the same coordinate when a child measures zero on the
    // axis — a collapsed block, or one whose styles gave it no height.
    // Preferring the later one would make a drop land AFTER a block the author
    // aimed before.
    const resolution = resolveDrop(
      {
        blockName: "core/heading",
        forbiddenParents: new Set(),
        regions: [rootRegion(["zero"])],
        rects: rectsOf({ zero: { x: 0, y: 100, width: 400, height: 0 } }),
        nesting: PERMISSIVE,
      },
      { x: 200, y: 100 }
    );

    expect(resolution).toMatchObject({
      kind: "target",
      target: { at: { index: 0 } },
    });
  });

  it("resolves a drop inside a container to that container's own line", () => {
    const document = documentOf([node("box", "core/box")]);
    const rects = rectsOf({ box: { x: 0, y: 100, width: 400, height: 200 } });
    const regions = collectRegions(
      document,
      slotsOf({ "core/box": ["children"] }),
      rects
    );

    const resolution = resolveDrop(
      {
        blockName: "core/heading",
        forbiddenParents: new Set(),
        regions,
        rects,
        nesting: PERMISSIVE,
      },
      { x: 200, y: 150 }
    );

    expect(resolution).toMatchObject({
      kind: "target",
      target: { at: { parentId: "box", slot: "children", index: 0 } },
    });
  });
});
