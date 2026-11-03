/**
 * The composition a component's locks are judged on lifts every condition
 * gate, in the page and in the definitions it reaches.
 */
import { describe, expect, it } from "vitest";

import {
  componentsWithConditionGatesLifted,
  withConditionGatesLifted,
} from "./condition-gates-lifted";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { DEFAULT_LIMITS } from "./limits";
import { resolveComponentInstances } from "./resolve-instances";

const gate = { conditions: [[{ field: "title", op: "eq", value: "Home" }]] };

const heading = (id: string): BlockNode => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const placing = (id: string, componentId: string, gated = false): BlockNode =>
  ({
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
    ...(gated ? { visibility: gate } : {}),
  }) as unknown as BlockNode;

const documentOf = (kind: string, nodes: BlockNode[]): BlockDocument =>
  ({ formatVersion: DOCUMENT_FORMAT_VERSION, kind, nodes }) as BlockDocument;

/** Every node type a composed forest holds. */
function typesIn(nodes: readonly BlockNode[]): string[] {
  return nodes.flatMap(node => [
    node.type,
    ...Object.values(node.slots ?? {}).flatMap(typesIn),
  ]);
}

describe("withConditionGatesLifted", () => {
  it("lifts a gate nested in a slot, on a copy, and answers undefined for none", () => {
    const page = documentOf("page", [
      {
        id: "box",
        type: "core/box",
        version: 1,
        props: {},
        slots: { children: [placing("i1", "promo", true)] },
      },
    ]);

    const lifted = withConditionGatesLifted(page, DEFAULT_LIMITS);

    expect(lifted?.nodes[0]?.slots?.children?.[0]).not.toHaveProperty(
      "visibility"
    );
    // The page it was given keeps its gate.
    expect(page.nodes[0]?.slots?.children?.[0]).toHaveProperty("visibility");
    expect(
      withConditionGatesLifted(
        documentOf("page", [placing("i1", "promo")]),
        DEFAULT_LIMITS
      )
    ).toBeUndefined();
  });
});

describe("componentsWithConditionGatesLifted", () => {
  it("expands a placement a definition gates, and says which definitions it lifted", () => {
    const promo = documentOf("component", [heading("hero")]);
    const banner = documentOf("component", [placing("nested", "promo", true)]);
    const components = new Map([
      ["promo", promo],
      ["banner", banner],
    ]);
    const page = documentOf("page", [placing("b1", "banner")]);
    const composedHero = (lookup: typeof components | undefined) =>
      typesIn(
        resolveComponentInstances(
          page,
          lookup ??
            componentsWithConditionGatesLifted(components, DEFAULT_LIMITS)
        ).document.nodes
      ).filter(type => type === "core/heading").length;

    // CONTROL: composed as served, the gated placement stays unexpanded.
    expect(composedHero(components)).toBe(0);
    expect(composedHero(undefined)).toBe(1);

    const lifted = componentsWithConditionGatesLifted(
      components,
      DEFAULT_LIMITS
    );
    expect(lifted.lifts("banner")).toBe(true);
    expect(lifted.lifts("promo")).toBe(false);
    // A definition gating nothing is handed out as the library holds it.
    expect(lifted.get("promo")).toBe(promo);
    expect(lifted.get("missing")).toBeUndefined();
  });
});
