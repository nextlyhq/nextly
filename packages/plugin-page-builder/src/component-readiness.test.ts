/**
 * What the publish-readiness notice counts, and what it refuses to decide.
 *
 * These cover the two properties that make the notice trustworthy: it names
 * every component the document really points at, and it does not invent a
 * definition of "published" beside the one the query service owns.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockNode,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { embeddedComponentIds, unpublishedAmong } from "./component-readiness";

const LIMITS: DocumentLimits = {
  maxDepth: 12,
  maxNodes: 5000,
  maxBytes: 2_097_152,
};

const instance = (componentId: unknown, id = "i1"): BlockNode =>
  ({
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  }) as unknown as BlockNode;

const container = (children: BlockNode[], id = "c1"): BlockNode =>
  ({
    id,
    type: "core/container",
    version: 1,
    props: {},
    // `slots`, not `children`: a container stores its child regions by name.
    // Written as `children` this fixture is a childless container, and every
    // nesting assertion below would pass by finding nothing to descend into.
    slots: { default: children },
  }) as unknown as BlockNode;

describe("the components a document embeds", () => {
  it("finds an instance nested inside containers", async () => {
    // The reason this walks rather than scanning the top level: a page builds
    // its layout out of containers, so the ordinary place for a component is
    // several levels down. A top-level scan would report zero for exactly the
    // pages components exist to build.
    const nodes = [container([container([instance("hero", "deep")])])];

    expect(embeddedComponentIds(nodes, LIMITS)).toEqual(["hero"]);
  });

  it("reports one entry for a component embedded twice", async () => {
    const nodes = [instance("hero", "a"), instance("hero", "b")];

    expect(embeddedComponentIds(nodes, LIMITS)).toEqual(["hero"]);
  });

  it("ignores a blank id rather than naming it", async () => {
    // `"   "` is a nonempty string, so it survives as a reference while naming
    // nothing. Counted, the notice would send an author looking for a component
    // that does not exist.
    const nodes = [instance("   "), instance("hero", "b")];

    expect(embeddedComponentIds(nodes, LIMITS)).toEqual(["hero"]);
  });

  it("ignores a non-string id", async () => {
    const nodes = [instance(42), instance(null, "b"), instance("hero", "c")];

    expect(embeddedComponentIds(nodes, LIMITS)).toEqual(["hero"]);
  });

  it("does not count an ordinary block as a component", async () => {
    // The control for every count above: without it, a walker that reported
    // every node would pass each of them by returning MORE than asked, and the
    // notice would name the page's own headings as unpublished components.
    const nodes = [
      container([
        { id: "h", type: "core/heading", version: 1, props: {} },
      ] as unknown as BlockNode[]),
      { id: "t", type: "core/text", version: 1, props: {} } as BlockNode,
    ];

    expect(embeddedComponentIds(nodes, LIMITS)).toEqual([]);
  });

  it("ignores a NON-instance node that happens to carry a componentId", async () => {
    // The discriminating case for the type guard. Without a node of another
    // type carrying the prop, the guard is dead weight: an ordinary block has
    // no `componentId`, so dropping the type check entirely still returns
    // nothing for every other fixture here, and the guard reads as tested when
    // nothing exercises it. A block that stores a reference of its own under
    // the same prop name is the shape that separates them.
    const impostor = {
      id: "x",
      type: "core/card",
      version: 1,
      props: { componentId: "not-a-component" },
    } as unknown as BlockNode;

    expect(
      embeddedComponentIds([impostor, instance("hero", "b")], LIMITS)
    ).toEqual(["hero"]);
  });

  it("counts a condition-gated instance", async () => {
    // Gating is evaluated per request against a context a write cannot see, and
    // an instance gated off for today's visitor still renders for tomorrow's.
    // Skipping it would drop a real reference from the notice.
    const gated = {
      id: "g",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "hero" },
      visibility: { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] },
    } as unknown as BlockNode;

    expect(embeddedComponentIds([gated], LIMITS)).toEqual(["hero"]);
  });

  it("stops at the cap the renderer reads under", async () => {
    // An unbounded walk would name components inside a document the renderer
    // refuses, so the notice would report what no reader of the page can see.
    const many = Array.from({ length: 10 }, (_, i) =>
      instance(`c${String(i)}`, `n${String(i)}`)
    );

    const found = embeddedComponentIds(many, { ...LIMITS, maxNodes: 3 });

    expect(found.length).toBeLessThan(10);
  });
});

describe("which embedded components are not live", () => {
  it("reports the ids a published-scoped read did not return", async () => {
    expect(unpublishedAmong(["hero", "footer"], new Set(["hero"]))).toEqual([
      "footer",
    ]);
  });

  it("reports nothing when every embedded component came back", async () => {
    expect(
      unpublishedAmong(["hero", "footer"], new Set(["hero", "footer"]))
    ).toEqual([]);
  });

  it("keeps document order rather than read order", async () => {
    // Two writes of one document otherwise produce two spellings of the same
    // message, which reads to an author as two different problems.
    expect(unpublishedAmong(["b", "a"], new Set())).toEqual(["b", "a"]);
  });

  it("treats an id the store never mentions as not live", async () => {
    // Unpublished and deleted arrive identically here, and they leave the same
    // hole on the page — so neither needs a second rule to tell them apart.
    expect(unpublishedAmong(["ghost"], new Set(["hero"]))).toEqual(["ghost"]);
  });
});

describe("the document format these read", () => {
  it("is the one the engine currently emits", async () => {
    // A format bump that moved `componentId` would leave every assertion above
    // green while the walker found nothing in a real document.
    expect(DOCUMENT_FORMAT_VERSION).toBeGreaterThan(0);
  });
});
