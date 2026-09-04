/**
 * What a page holds after its linked components have been inlined.
 *
 * The properties under test are the ones a consumer cannot re-derive: that an
 * untouched page is the SAME object, that the ids are the same on every render,
 * that an instance's own values beat the variant's, and that a component which
 * cannot be inlined costs its own region rather than the page.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "./document";
import { DEFAULT_LIMITS } from "./limits";
import {
  componentIdsIn,
  resolveComponentInstances,
  type DefinitionsById,
  type ResolvedBlockNode,
  type ResolvedDocument,
} from "./resolve-instances";

const node = (id: string, extra: Partial<BlockNode> = {}): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
  ...extra,
});

const box = (
  id: string,
  children: BlockNode[],
  visibility?: BlockNode["visibility"]
): BlockNode =>
  node(id, {
    type: "core/box",
    slots: { children },
    ...(visibility === undefined ? {} : { visibility }),
  });

const instance = (
  id: string,
  componentId: string,
  props: Record<string, unknown> = {},
  extra: Partial<BlockNode> = {}
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...props },
  ...extra,
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const component = (
  nodes: BlockNode[],
  envelope: Partial<ComponentDocument> = {}
): ComponentDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
  ...envelope,
});

const defs = (entries: Record<string, BlockDocument>): DefinitionsById =>
  new Map(Object.entries(entries));

/** Every node of a resolved forest, in document order. */
function flatten(nodes: readonly ResolvedBlockNode[]): ResolvedBlockNode[] {
  const out: ResolvedBlockNode[] = [];
  for (const entry of nodes) {
    out.push(entry);
    for (const children of Object.values(entry.slots ?? {})) {
      out.push(...flatten(children));
    }
  }
  return out;
}

const idsOf = (doc: ResolvedDocument): string[] =>
  flatten(doc.nodes).map(entry => entry.id);

const byInstanceOf = (
  doc: ResolvedDocument,
  instanceId: string
): ResolvedBlockNode[] =>
  flatten(doc.nodes).filter(entry => entry.instanceOf === instanceId);

describe("resolveComponentInstances", () => {
  it("returns the same document object when the page holds no instance", () => {
    const doc = page([node("a"), box("b", [node("c")])]);

    const result = resolveComponentInstances(doc, defs({}));

    expect(result.document).toBe(doc);
    expect(result.referenced).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("composes nothing in a document that is already past the node budget", () => {
    const doc = page([node("a"), node("b"), instance("i1", "hero")]);
    const definitions = defs({ hero: component([node("d1")]) });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 2 },
    });

    expect(result.document).toBe(doc);
    expect(result.unresolved).toEqual([]);
  });

  it("replaces one instance with every root of its definition", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([node("d1"), node("d2")]),
    });

    const result = resolveComponentInstances(doc, definitions);

    expect(result.document.nodes).toHaveLength(2);
    expect(result.document.nodes.map(entry => entry.type)).toEqual([
      "core/text",
      "core/text",
    ]);
    expect(idsOf(result.document)).not.toContain("d1");
  });

  it("gives two instances of one definition different ids", () => {
    const doc = page([instance("i1", "hero"), instance("i2", "hero")]);
    const definitions = defs({ hero: component([node("d1")]) });

    const ids = idsOf(resolveComponentInstances(doc, definitions).document);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("mints the same ids on every resolution of one page", () => {
    const doc = page([instance("i1", "hero"), instance("i2", "hero")]);
    const definitions = defs({
      hero: component([box("d1", [node("d2"), node("d3")])]),
    });

    const first = resolveComponentInstances(doc, definitions).document;
    const second = resolveComponentInstances(doc, definitions).document;

    expect(idsOf(first)).toEqual(idsOf(second));
    expect(idsOf(first)).toHaveLength(6);
  });

  it("never mints an id a node of the host page already carries", () => {
    // The digest the resolver would mint for this pair, taken from a run whose
    // host holds nothing that could collide, and then planted in the host.
    const probe = page([instance("i1", "hero")]);
    const definitions = defs({ hero: component([node("d1")]) });
    const minted = idsOf(
      resolveComponentInstances(probe, definitions).document
    )[0]!;

    const doc = page([node(minted), instance("i1", "hero")]);
    const ids = idsOf(resolveComponentInstances(doc, definitions).document);

    expect(ids[0]).toBe(minted);
    expect(ids[1]).not.toBe(minted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks every inlined node with its instance, not only the roots", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([box("d1", [node("d2")])]),
    });

    const result = resolveComponentInstances(doc, definitions);

    expect(byInstanceOf(result.document, "i1")).toHaveLength(2);
  });

  it("reports every definition it read, in first-reached order", () => {
    const doc = page([
      instance("i1", "hero"),
      instance("i2", "gone"),
      instance("i3", "hero"),
    ]);
    const definitions = defs({ hero: component([node("d1")]) });

    const result = resolveComponentInstances(doc, definitions);

    expect(result.referenced).toEqual(["hero", "gone"]);
  });
});

describe("resolveComponentInstances overrides", () => {
  const heroWithHeadline = component(
    [node("d1", { props: { text: "base" } })],
    {
      exposed: [
        {
          id: "headline",
          label: "Headline",
          nodeId: "d1",
          propPath: "text",
          type: "text",
        },
      ],
      variants: {
        loud: { label: "Loud", overrides: { headline: "VARIANT" } },
      },
    }
  );

  it("applies a variant's value when the instance overrides nothing", () => {
    const doc = page([instance("i1", "hero", { variant: "loud" })]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: heroWithHeadline })
    );

    expect(result.document.nodes[0]!.props.text).toBe("VARIANT");
  });

  it("prefers the instance's own value over the variant's", () => {
    const doc = page([
      instance("i1", "hero", {
        variant: "loud",
        overrides: { headline: "INSTANCE" },
      }),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: heroWithHeadline })
    );

    expect(result.document.nodes[0]!.props.text).toBe("INSTANCE");
  });

  it("inherits the definition's value when the id is absent from overrides", () => {
    const doc = page([instance("i1", "hero", { overrides: { other: "x" } })]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: heroWithHeadline })
    );

    expect(result.document.nodes[0]!.props.text).toBe("base");
  });

  it("clears the prop for an unset override rather than inheriting it", () => {
    const doc = page([
      instance("i1", "hero", { overrides: { headline: { $unset: true } } }),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: heroWithHeadline })
    );

    expect(result.document.nodes[0]!.props).not.toHaveProperty("text");
  });

  it("treats a structured value carrying $unset as a value to apply", () => {
    const doc = page([
      instance("i1", "hero", {
        overrides: { headline: { href: "/docs", $unset: true } },
      }),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: heroWithHeadline })
    );

    expect(result.document.nodes[0]!.props.text).toEqual({
      href: "/docs",
      $unset: true,
    });
  });

  it("writes a nested prop path without altering the shared definition", () => {
    const definition = component(
      [node("d1", { props: { seo: { title: "base", keep: "yes" } } })],
      {
        exposed: [
          {
            id: "title",
            label: "Title",
            nodeId: "d1",
            propPath: "seo.title",
            type: "text",
          },
        ],
      }
    );
    const doc = page([
      instance("i1", "hero", { overrides: { title: "one" } }),
      instance("i2", "hero", { overrides: { title: "two" } }),
    ]);

    const result = resolveComponentInstances(doc, defs({ hero: definition }));

    expect(result.document.nodes[0]!.props.seo).toEqual({
      title: "one",
      keep: "yes",
    });
    expect(result.document.nodes[1]!.props.seo).toEqual({
      title: "two",
      keep: "yes",
    });
    expect(definition.nodes[0]!.props.seo).toEqual({
      title: "base",
      keep: "yes",
    });
  });

  it("writes a __proto__ path as an own key rather than a prototype", () => {
    const definition = component([node("d1")], {
      exposed: [
        {
          id: "bad",
          label: "Bad",
          nodeId: "d1",
          propPath: "__proto__",
          type: "text",
        },
      ],
    });
    const doc = page([instance("i1", "hero", { overrides: { bad: "x" } })]);

    const props = resolveComponentInstances(doc, defs({ hero: definition }))
      .document.nodes[0]!.props;

    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(Object.keys(props)).toContain("__proto__");
  });
});

describe("resolveComponentInstances visibility", () => {
  const definition = component([box("d1", [node("d2")]), node("d3")], {
    exposed: [
      {
        id: "showBanner",
        label: "Banner",
        nodeId: "d1",
        propPath: "hidden",
        type: "visibility",
      },
    ],
  });

  it("drops a node and its subtree when the override hides it", () => {
    const doc = page([
      instance("i1", "hero", { overrides: { showBanner: false } }),
    ]);

    const result = resolveComponentInstances(doc, defs({ hero: definition }));

    expect(flatten(result.document.nodes)).toHaveLength(1);
  });

  it("removes the definition's own gate when the override shows it", () => {
    const gated = component(
      [
        node("d1", {
          visibility: { conditions: [[{ field: "tier", op: "eq" }]] },
        }),
      ],
      {
        exposed: [
          {
            id: "showBanner",
            label: "Banner",
            nodeId: "d1",
            propPath: "hidden",
            type: "visibility",
          },
        ],
      }
    );
    const doc = page([
      instance("i1", "hero", { overrides: { showBanner: true } }),
    ]);

    const result = resolveComponentInstances(doc, defs({ hero: gated }));

    expect(result.document.nodes[0]).not.toHaveProperty("visibility");
  });

  it("ignores a visibility override that is not a boolean, either way", () => {
    const own = { conditions: [[{ field: "tier", op: "eq" }]] };
    const gated = component([box("d1", [node("d2")], own), node("d3")], {
      exposed: [
        {
          id: "showBanner",
          label: "Banner",
          nodeId: "d1",
          propPath: "hidden",
          type: "visibility",
        },
      ],
    });

    const truthy = resolveComponentInstances(
      page([instance("i1", "hero", { overrides: { showBanner: "false" } })]),
      defs({ hero: gated })
    );
    const falsy = resolveComponentInstances(
      page([instance("i1", "hero", { overrides: { showBanner: 0 } })]),
      defs({ hero: gated })
    );

    expect(truthy.document.nodes[0]!.visibility).toEqual(own);
    expect(flatten(falsy.document.nodes)).toHaveLength(3);
  });
});

describe("resolveComponentInstances slots", () => {
  const definition = component([box("d1", [node("fallback")])], {
    slots: { body: { label: "Body", nodeId: "d1", slot: "children" } },
  });

  it("substitutes the instance's slot content for the definition's children", () => {
    const doc = page([
      instance("i1", "hero", {}, { slots: { body: [node("mine")] } }),
    ]);

    const result = resolveComponentInstances(doc, defs({ hero: definition }));

    const children = result.document.nodes[0]!.slots!.children!;
    expect(children.map(entry => entry.id)).toEqual(["mine"]);
  });

  it("keeps the definition's children when the instance supplies none", () => {
    const doc = page([instance("i1", "hero")]);

    const result = resolveComponentInstances(doc, defs({ hero: definition }));

    const children = result.document.nodes[0]!.slots!.children!;
    expect(children).toHaveLength(1);
    expect(children[0]!.instanceOf).toBe("i1");
  });

  it("fills a slot the definition's node stored no entry for", () => {
    const empty = component([node("d1", { type: "core/box" })], {
      slots: { body: { label: "Body", nodeId: "d1", slot: "children" } },
    });
    const doc = page([
      instance("i1", "hero", {}, { slots: { body: [node("mine")] } }),
    ]);

    const result = resolveComponentInstances(doc, defs({ hero: empty }));

    expect(result.document.nodes[0]!.slots!.children!.map(e => e.id)).toEqual([
      "mine",
    ]);
  });

  it("leaves instance slot content unmarked, so the page still owns it", () => {
    const doc = page([
      instance("i1", "hero", {}, { slots: { body: [node("mine")] } }),
    ]);

    const result = resolveComponentInstances(doc, defs({ hero: definition }));

    const mine = flatten(result.document.nodes).find(e => e.id === "mine")!;
    expect(mine.instanceOf).toBeUndefined();
  });
});

describe("resolveComponentInstances refusals", () => {
  it("keeps an instance whose definition is missing, marked and reported", () => {
    const doc = page([node("a"), instance("i1", "gone")]);

    const result = resolveComponentInstances(doc, defs({}));

    expect(result.document.nodes[1]!.unresolvedComponent).toBe("missing");
    expect(result.unresolved).toEqual([
      { instanceId: "i1", componentId: "gone", reason: "missing" },
    ]);
    expect(result.document.nodes[0]!.id).toBe("a");
  });

  it("marks an instance that names no component as malformed", () => {
    const doc = page([
      { id: "i1", type: COMPONENT_INSTANCE_TYPE, version: 1, props: {} },
    ]);

    const result = resolveComponentInstances(doc, defs({}));

    expect(result.unresolved[0]!.reason).toBe("malformed");
    expect(result.referenced).toEqual([]);
  });

  it("refuses a component that reaches itself, and renders the rest", () => {
    const doc = page([node("a"), instance("i1", "loop")]);
    const definitions = defs({
      loop: component([node("d1"), instance("d2", "loop")]),
    });

    const result = resolveComponentInstances(doc, definitions);

    const flat = flatten(result.document.nodes);
    expect(flat.map(e => e.unresolvedComponent)).toEqual([
      undefined,
      undefined,
      "cycle",
    ]);
    expect(result.unresolved.map(e => e.reason)).toEqual(["cycle"]);
  });

  it("refuses the instance that would pass the composed-depth cap", () => {
    const doc = page([instance("i1", "outer")]);
    const definitions = defs({
      outer: component([instance("d1", "inner")]),
      inner: component([node("leaf")]),
    });

    const atCap = resolveComponentInstances(doc, definitions, {
      maxComposedDepth: 2,
    });
    const belowCap = resolveComponentInstances(doc, definitions, {
      maxComposedDepth: 1,
    });

    expect(atCap.unresolved).toEqual([]);
    expect(flatten(atCap.document.nodes)).toHaveLength(1);
    expect(belowCap.unresolved.map(e => e.reason)).toEqual(["composed-depth"]);
  });

  it("refuses a whole instance rather than inlining part of it", () => {
    const doc = page([instance("i1", "big"), instance("i2", "small")]);
    const definitions = defs({
      big: component([node("b1"), node("b2"), node("b3")]),
      small: component([node("s1")]),
    });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 2 },
    });

    expect(result.unresolved).toEqual([
      { instanceId: "i1", componentId: "big", reason: "budget" },
    ]);
    expect(result.document.nodes[0]!.unresolvedComponent).toBe("budget");
    expect(result.document.nodes[1]!.id).not.toBe("i2");
  });

  it("keeps a refused instance's own slot content untouched", () => {
    const doc = page([
      instance("i1", "gone", {}, { slots: { body: [node("mine")] } }),
    ]);

    const result = resolveComponentInstances(doc, defs({}));

    expect(result.document.nodes[0]!.slots!.body!.map(e => e.id)).toEqual([
      "mine",
    ]);
  });
});

describe("resolveComponentInstances nesting", () => {
  it("inlines a component the definition itself references", () => {
    const doc = page([instance("i1", "outer")]);
    const definitions = defs({
      outer: component([box("o1", [instance("o2", "inner")])]),
      inner: component([node("leaf")]),
    });

    const result = resolveComponentInstances(doc, definitions);

    const flat = flatten(result.document.nodes);
    expect(flat).toHaveLength(2);
    expect(result.referenced).toEqual(["outer", "inner"]);
    // The HOST's instance at both depths, not the inner one, which is not a
    // node of the resolved document at all.
    expect(flat.map(e => e.instanceOf)).toEqual(["i1", "i1"]);
  });

  it("resolves an instance inside supplied slot content in the host's scope", () => {
    const doc = page([
      instance(
        "i1",
        "shell",
        {},
        { slots: { body: [instance("i2", "leafy")] } }
      ),
    ]);
    const definitions = defs({
      shell: component([box("s1", [])], {
        slots: { body: { label: "Body", nodeId: "s1", slot: "children" } },
      }),
      leafy: component([node("l1")]),
    });

    // One composed level is all the host content is allowed, and the nested
    // instance sits in the PAGE rather than inside `shell`, so it resolves.
    const result = resolveComponentInstances(doc, definitions, {
      maxComposedDepth: 1,
    });

    expect(result.unresolved).toEqual([]);
    expect(flatten(result.document.nodes)).toHaveLength(2);
  });
});

describe("resolveComponentInstances limits and speculative work", () => {
  const nestedDefs = defs({
    outer: component(
      [instance("o1", "inner", {}, { slots: { body: [node("shared")] } })],
      { slots: { outerBody: { label: "Body", nodeId: "o1", slot: "body" } } }
    ),
    inner: component([box("l1", [])], {
      slots: { body: { label: "Body", nodeId: "l1", slot: "children" } },
    }),
  });

  it("re-identifies the slot children of an instance the definition holds", () => {
    const doc = page([instance("i1", "outer"), instance("i2", "outer")]);

    const result = resolveComponentInstances(doc, nestedDefs);
    const ids = idsOf(result.document);

    expect(new Set(ids).size).toBe(ids.length);
    expect(idsOf(result.document)).not.toContain("shared");
  });

  it("marks a nested instance's default children with the outer instance", () => {
    const doc = page([instance("i1", "outer")]);

    const result = resolveComponentInstances(doc, nestedDefs);

    expect(byInstanceOf(result.document, "i1")).toHaveLength(2);
  });

  it("routes page content through a slot exposed on a nested instance", () => {
    const doc = page([
      instance("i1", "outer", {}, { slots: { outerBody: [node("fromPage")] } }),
    ]);

    const result = resolveComponentInstances(doc, nestedDefs);

    const children = result.document.nodes[0]!.slots!.children!;
    expect(children.map(e => e.id)).toEqual(["fromPage"]);
  });

  it("composes nothing when the host survey stopped at the node budget", () => {
    const doc = page([instance("i1", "hero"), node("a"), node("b")]);
    const definitions = defs({ hero: component([node("d1")]) });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 2 },
    });

    expect(result.document).toBe(doc);
  });

  it("discards the diagnostics of an instance it then refuses", () => {
    const doc = page([instance("i1", "outer")]);
    const definitions = defs({
      outer: component([instance("o1", "gone"), node("d2"), node("d3")]),
    });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 2 },
    });

    expect(result.unresolved).toEqual([
      { instanceId: "i1", componentId: "outer", reason: "budget" },
    ]);
  });

  it("gives back the budget an instance's slot content spent before it failed", () => {
    const definitions = defs({
      big: component([node("b1"), node("b2")]),
      small: component([node("s1"), node("s2"), node("s3")]),
    });
    const doc = page([
      instance("i1", "big", {}, { slots: { any: [instance("i2", "small")] } }),
      instance("i3", "small"),
    ]);

    // Three: the host's own node count, and exactly what `small` costs. The
    // slot content inside `i1` spends all of it and is then thrown away with
    // `i1`, so the sibling fits only if that spend was given back.
    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 3 },
    });

    expect(result.unresolved.map(e => e.instanceId)).toEqual(["i1"]);
    expect(byInstanceOf(result.document, "i3")).toHaveLength(3);
  });

  it("keeps an inlined id stable when an unrelated node joins its definition", () => {
    const inner = component([node("n")]);
    const nested = () => instance("a", "inner");
    const doc = page([instance("i1", "outer")]);

    // The composed id must be a function of the instances above a node and of
    // the definition node itself. Deriving it from the HOST instance instead
    // makes `n` collide with the outer definition's own `n`, and the collision
    // suffix then lands on whichever was minted second — so adding one node to
    // the outer component silently rewrites ids inside a component it merely
    // contains, detaching every rule and overlay keyed to them.
    const without = resolveComponentInstances(
      doc,
      defs({ outer: component([nested(), instance("b", "inner")]), inner })
    );
    const with_ = resolveComponentInstances(
      doc,
      defs({
        outer: component([node("n"), nested(), instance("b", "inner")]),
        inner,
      })
    );

    expect(idsOf(without.document)[0]).toBe(idsOf(with_.document)[1]);
  });

  it("refuses an instance whose definition is deeper than the limits allow", () => {
    const doc = page([instance("i1", "deep")]);
    const definitions = defs({
      deep: component([box("d1", [box("d2", [node("d3")])])]),
    });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxDepth: 2 },
    });

    expect(result.unresolved.map(e => e.reason)).toEqual(["node-depth"]);
    expect(result.document.nodes[0]!.unresolvedComponent).toBe("node-depth");
  });

  it("counts every entry of a definition against the node budget", () => {
    const doc = page([instance("i1", "junk")]);
    const definitions = defs({
      junk: component([
        null,
        null,
        null,
        node("d1"),
      ] as unknown as ResolvedBlockNode[]),
    });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 2 },
    });

    expect(result.unresolved.map(e => e.reason)).toEqual(["budget"]);
  });
});

describe("componentIdsIn", () => {
  it("lists each referenced id once, in first-reached order", () => {
    const nodes = [
      instance("i1", "b"),
      box("x", [instance("i2", "a"), instance("i3", "b")]),
    ];

    expect(componentIdsIn(nodes)).toEqual(["b", "a"]);
  });

  it("ignores an instance that names no component", () => {
    const nodes = [
      { id: "i1", type: COMPONENT_INSTANCE_TYPE, version: 1, props: {} },
      instance("i2", "a"),
    ];

    expect(componentIdsIn(nodes)).toEqual(["a"]);
  });

  it("stops at the node budget rather than walking a whole document", () => {
    const nodes = [node("a"), node("b"), instance("i1", "late")];

    expect(componentIdsIn(nodes, 2)).toEqual([]);
    expect(componentIdsIn(nodes, 3)).toEqual(["late"]);
  });
});
