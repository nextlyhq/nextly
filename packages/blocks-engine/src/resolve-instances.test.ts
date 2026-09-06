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
import { DEFAULT_LIMITS, MAX_ENVELOPE_ENTRIES } from "./limits";
import { isConditionGated } from "./visibility";
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

/**
 * A node carrying a stored shape the published type forbids.
 *
 * Documents arrive from a database, an import or an older writer, so the
 * resolver's contract is to survive shapes `BlockNode` cannot express — and a
 * test that can only build well-typed nodes cannot reach the branches that
 * exist for them. The hop through `unknown` is the assertion that this value
 * came from storage rather than from a caller.
 */
const stored = (base: ResolvedBlockNode, extra: Record<string, unknown>) =>
  ({ ...base, ...extra }) as unknown as ResolvedBlockNode;

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
      // `big` must EXPOSE the slot, or its content is never resolved at all
      // and there is no spend to give back.
      big: component([box("b1", []), node("b2"), node("b3")], {
        slots: { any: { label: "Any", nodeId: "b1", slot: "children" } },
      }),
      small: component([node("s1"), node("s2"), node("s3"), node("s4")]),
    });
    const doc = page([
      instance("i1", "big", {}, { slots: { any: [instance("i2", "small")] } }),
      instance("i3", "small"),
    ]);

    // Sized so the sibling fits ONLY if the slot content's spend comes back:
    // the host holds three nodes, so composition starts with three left, `i1`
    // spends four of them on slot content that is then thrown away with it,
    // and `i3` needs four.
    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 6 },
    });

    expect(result.unresolved.map(e => e.instanceId)).toEqual(["i1"]);
    expect(byInstanceOf(result.document, "i3")).toHaveLength(4);
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

describe("resolveComponentInstances what an instance carries", () => {
  it("leaves a condition-gated instance standing rather than expanding it", () => {
    const gate = { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] };
    const doc = page([
      { ...instance("i1", "hero"), visibility: gate },
      node("plain"),
    ]);
    const definitions = defs({ hero: component([node("d1"), node("d2")]) });

    const result = resolveComponentInstances(doc, definitions);

    // The gate has to survive INTO the tree the later pass prunes. Expanding
    // and dropping it serves restricted content to everyone.
    expect(result.document.nodes.map(e => e.id)).toEqual(["i1", "plain"]);
    expect(result.document.nodes[0]!.visibility).toEqual(gate);
    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual([]);
  });

  it("leaves an instance standing under a gated ANCESTOR too", () => {
    // Gating is inherited: `pruneHiddenNodes` drops a gated node with its whole
    // subtree, so an instance under one reaches no reader either way. Reading
    // its definition here reports a component nobody receives — a publish check
    // rejects on it and a cache tag tracks it — and reports it differently from
    // the identical instance gated directly.
    const gate = { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] };
    const doc = page([box("wrap", [instance("i1", "hero")], gate)]);
    const definitions = defs({ hero: component([node("d1"), node("d2")]) });

    const result = resolveComponentInstances(doc, definitions);

    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual([]);
    expect(result.document).toBe(doc);
  });

  it("leaves an instance standing under a gated ancestor INSIDE a definition", () => {
    // Gating is inherited the same way wherever the container sits. A
    // definition's own gated box is dropped with its subtree by the same pass,
    // so an instance inside it reaches no reader — and the host walk's rule
    // means nothing if the definition walk descends anyway.
    const gate = { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] };
    const doc = page([instance("i1", "outer")]);
    const definitions = defs({
      outer: component([box("d1", [instance("d2", "gone")], gate)]),
    });

    const result = resolveComponentInstances(doc, definitions);

    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual(["outer"]);
  });

  it("does not resolve slot content aimed at a gated target", () => {
    // The instance's own content, handed to a region the definition gates. The
    // node it was placed in is dropped with its subtree, so the content reaches
    // no reader — and resolving it first records the components inside it as
    // read and as unresolvable, which is the same publish rejection and the
    // same cache tag, arrived at from the page's side instead of the
    // definition's.
    const gate = { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] };
    const definition = component([box("d1", [node("fallback")], gate)], {
      slots: { body: { label: "Body", nodeId: "d1", slot: "children" } },
    });
    const doc = page([
      instance("i1", "hero", {}, { slots: { body: [instance("s1", "gone")] } }),
    ]);

    const result = resolveComponentInstances(doc, defs({ hero: definition }));

    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual(["hero"]);
  });

  it("still resolves slot content aimed at a target that survives", () => {
    // The control. Without it the rule above passes on an implementation that
    // drops instance slot content altogether, which is the whole feature.
    const definition = component([box("d1", [node("fallback")])], {
      slots: { body: { label: "Body", nodeId: "d1", slot: "children" } },
    });
    const doc = page([
      instance(
        "i1",
        "hero",
        {},
        { slots: { body: [instance("s1", "inner")] } }
      ),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: definition, inner: component([node("d9")]) })
    );

    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual(["hero", "inner"]);
    // Composed, and recorded as belonging to the page's own instance node —
    // the content is the PAGE's, so `instanceOf` names `s1` rather than the
    // component that received it.
    expect(
      result.document.nodes[0]!.slots!.children!.map(e => e.instanceOf)
    ).toEqual(["s1"]);
  });

  it("fits a composition whose slot content releases the room it needs", () => {
    // Two nodes stored — the instance and the content it supplies — and two
    // nodes composed. The supplied instance resolves to an empty component, so
    // replacing it FREES the slot it occupied, and the definition's own two
    // nodes fit exactly. Whether that room arrives before or after the
    // definition's siblings are cloned is an ordering detail of this module,
    // and a page must not be refused over it.
    const outer = component([node("sib"), box("d1", [])], {
      slots: { body: { label: "Body", nodeId: "d1", slot: "children" } },
    });
    const doc = page([
      instance(
        "i1",
        "outer",
        {},
        { slots: { body: [instance("s1", "inner")] } }
      ),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({ outer, inner: component([]) }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 2 } }
    );

    expect(result.unresolved).toEqual([]);
    expect(flatten(result.document.nodes)).toHaveLength(2);
    // An empty component contributes nothing either way, so the node count
    // alone cannot tell composition from DISCARDING the supplied content —
    // which is the plausible wrong implementation, and the one that costs a
    // page its content. Only a record of having read `inner` separates them.
    expect(result.referenced).toEqual(["outer", "inner"]);
  });

  it("composes the page's slot content ONCE, however deep it is placed", () => {
    // The page supplies content to a slot that `outer` forwards into a nested
    // component. Composing where it is placed means it passes through two
    // expansions, and the second must leave it alone: content already composed
    // still holds any instance that could not be resolved, so composing it
    // again refuses that instance a second time and reports it twice.
    const inner = component([box("d2", [node("fb")])], {
      slots: { region: { label: "Region", nodeId: "d2", slot: "children" } },
    });
    const outer = component([instance("n1", "inner")], {
      slots: { body: { label: "Body", nodeId: "n1", slot: "region" } },
    });
    const doc = page([
      instance(
        "i1",
        "outer",
        {},
        { slots: { body: [instance("s1", "gone")] } }
      ),
    ]);

    const result = resolveComponentInstances(doc, defs({ outer, inner }));

    expect(result.unresolved).toEqual([
      { instanceId: "s1", componentId: "gone", reason: "missing" },
    ]);
  });

  it("stops the slot prepass at the cap the clone will refuse at", () => {
    // A definition wider than the page's whole node allowance, with the slot
    // target last. The depth bound says nothing about BREADTH, so without a
    // work bound the prepass walks every sibling — hundreds of thousands of
    // them in a definition nothing validated — to prepare content the clone
    // refuses a moment later for `budget`.
    const definition = component(
      [node("a"), node("b"), node("c"), node("d"), box("target", [])],
      { slots: { tail: { label: "Tail", nodeId: "target", slot: "children" } } }
    );
    const doc = page([
      instance("i1", "hero", {}, { slots: { tail: [instance("s1", "deep")] } }),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: definition, deep: component([]) }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 4 } }
    );

    // The instance is refused either way — the definition cannot fit. What is
    // asserted is that `deep` was never READ to find that out.
    expect(result.unresolved.map(e => e.reason)).toEqual(["budget"]);
    expect(result.referenced).toEqual(["hero"]);
  });

  it("keeps condition-gated nodes charged against the prepass cap", () => {
    // A gate and an override both stop a node being served, and the clone
    // treats them differently: it emits NOTHING for an override that hides,
    // and gives the charge back — but it emits the node itself, still gated,
    // for a condition, and keeps the charge. A prepass that refunds both reads
    // an arbitrarily wide definition for free.
    const gate = { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] };
    const definition = component(
      [
        node("g1", { visibility: gate }),
        node("g2", { visibility: gate }),
        node("g3", { visibility: gate }),
        node("g4", { visibility: gate }),
        node("sib"),
        box("target", []),
      ],
      { slots: { tail: { label: "Tail", nodeId: "target", slot: "children" } } }
    );
    const doc = page([
      instance("i1", "hero", {}, { slots: { tail: [instance("s1", "deep")] } }),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: definition, deep: component([]) }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 2 } }
    );

    expect(result.unresolved.map(e => e.reason)).toEqual(["budget"]);
    expect(result.referenced).toEqual(["hero"]);
  });

  it("crosses nodes an override removed to reach a later slot target", () => {
    // The clone gives back the charge for a node that emits nothing, so four
    // overridden-away roots cost the composed document nothing and the result
    // fits. A prepass counter that charges them anyway stops before the slot
    // target, the content is composed at placement instead, and the ordering
    // this pass exists to fix comes back — as a refusal.
    const definition = component(
      [
        node("h1"),
        node("h2"),
        node("h3"),
        node("h4"),
        node("sib"),
        box("target", []),
      ],
      {
        exposed: ["h1", "h2", "h3", "h4"].map((nodeId, index) => ({
          id: `x${String(index + 1)}`,
          label: `Show ${nodeId}`,
          nodeId,
          // Carried because the published type requires it of every exposure;
          // a `visibility` one decides whether the node is served at all, so
          // `applyExposure` answers before it reads a path.
          propPath: "hidden",
          type: "visibility" as const,
        })),
        slots: { tail: { label: "Tail", nodeId: "target", slot: "children" } },
      }
    );
    const doc = page([
      instance(
        "i1",
        "hero",
        { overrides: { x1: false, x2: false, x3: false, x4: false } },
        { slots: { tail: [instance("s1", "empty")] } }
      ),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({ hero: definition, empty: component([]) }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 2 } }
    );

    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual(["hero", "empty"]);
  });

  const twoSlotDefinition = () =>
    component([box("t", [])], {
      slots: {
        grow: { label: "Grow", nodeId: "t", slot: "a" },
        shrink: { label: "Shrink", nodeId: "t", slot: "b" },
      },
    });

  const twoSlotPage = () =>
    page([
      instance(
        "i1",
        "hero",
        {},
        {
          slots: {
            grow: [instance("g", "big")],
            shrink: [
              instance("e1", "empty"),
              instance("e2", "empty"),
              instance("e3", "empty"),
            ],
          },
        }
      ),
    ]);

  it("retries a slot a sibling has since made room for", () => {
    // The growing slot is declared first, so it is composed while the three
    // empty components that will free its room have not been reached yet. It
    // is refused, they compose, and the retry finds it fits after all — so the
    // order two independent slots were declared in stops deciding whether the
    // page renders.
    const result = resolveComponentInstances(
      twoSlotPage(),
      defs({
        hero: twoSlotDefinition(),
        big: component([node("b1"), node("b2"), node("b3"), node("b4")]),
        empty: component([]),
      }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 6 } }
    );

    expect(result.unresolved).toEqual([]);
  });

  it("CONTROL: still refuses a page whose composed tree cannot fit", () => {
    // Twice the definition, so no amount of retrying pays for it. Without this
    // the rule above passes on an implementation that simply stops refusing.
    const result = resolveComponentInstances(
      twoSlotPage(),
      defs({
        hero: twoSlotDefinition(),
        big: component([
          node("b1"),
          node("b2"),
          node("b3"),
          node("b4"),
          node("b5"),
          node("b6"),
          node("b7"),
          node("b8"),
        ]),
        empty: component([]),
      }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 6 } }
    );

    expect(result.unresolved.map(e => e.reason)).toEqual(["budget"]);
  });

  it("reports a starved instance ONCE when the retry fails too", () => {
    // The retry re-walks the same content, so a second refusal records a
    // second entry saying what the first already said. A publish check reading
    // the list would count one problem twice.
    const result = resolveComponentInstances(
      twoSlotPage(),
      defs({
        hero: twoSlotDefinition(),
        big: component([
          node("b1"),
          node("b2"),
          node("b3"),
          node("b4"),
          node("b5"),
          node("b6"),
          node("b7"),
          node("b8"),
        ]),
        empty: component([]),
      }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 6 } }
    );

    expect(result.unresolved).toHaveLength(1);
  });

  it("does not let one starved child take its owner down with it", () => {
    // Slot content holding a growing instance and then a MISSING one. Each
    // child fails for its own reason and neither reason is the owner's: a
    // component that cannot fit and a component nobody published are both
    // facts about the children, and promoting either into a refusal of the
    // node that holds them costs a reader the whole component instead of the
    // two blocks that could not be drawn.
    const definition = component([box("t", [])], {
      slots: { hole: { label: "Hole", nodeId: "t", slot: "a" } },
    });
    const doc = page([
      instance(
        "i1",
        "hero",
        {},
        { slots: { hole: [instance("g", "big"), instance("m", "gone")] } }
      ),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({
        hero: definition,
        big: component([node("b1"), node("b2"), node("b3")]),
      }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 3 } }
    );

    // The owner renders. Each child reports its own cause, and neither is
    // promoted into a refusal of the component that holds them.
    expect(result.unresolved).toEqual([
      { instanceId: "g", componentId: "big", reason: "budget" },
      { instanceId: "m", componentId: "gone", reason: "missing" },
    ]);
  });

  it("retries across slots exposed on DIFFERENT definition nodes", () => {
    // The two regions sit on two different nodes, so the walk reaches them one
    // after the other. Retrying the first the moment it is composed asks again
    // before the second has released anything, and the declaration order still
    // decides — the retry has to wait for the whole prepass.
    const definition = component([box("t1", []), box("t2", [])], {
      slots: {
        grow: { label: "Grow", nodeId: "t1", slot: "a" },
        shrink: { label: "Shrink", nodeId: "t2", slot: "b" },
      },
    });
    const doc = page([
      instance(
        "i1",
        "hero",
        {},
        {
          slots: {
            grow: [instance("g", "big")],
            shrink: [
              instance("e1", "empty"),
              instance("e2", "empty"),
              instance("e3", "empty"),
            ],
          },
        }
      ),
    ]);

    const result = resolveComponentInstances(
      doc,
      defs({
        hero: definition,
        big: component([node("b1"), node("b2"), node("b3"), node("b4")]),
        empty: component([]),
      }),
      { limits: { ...DEFAULT_LIMITS, maxNodes: 7 } }
    );

    expect(result.unresolved).toEqual([]);
  });

  it("does not compose content bound for a default subtree the page replaced", () => {
    // Two exposed slots: one on a container, one on a node sitting inside that
    // container's DEFAULT children. Filling the outer slot replaces those
    // children wholesale, so the inner target is never placed — and the clone
    // knows that, because it stops copying a stored slot the plan replaces.
    const definition = component(
      [box("outer-box", [box("inner-box", [node("fb")])])],
      {
        slots: {
          shell: { label: "Shell", nodeId: "outer-box", slot: "children" },
          buried: { label: "Buried", nodeId: "inner-box", slot: "children" },
        },
      }
    );
    const doc = page([
      instance(
        "i1",
        "hero",
        {},
        {
          slots: {
            shell: [node("mine")],
            buried: [instance("s1", "gone")],
          },
        }
      ),
    ]);

    const result = resolveComponentInstances(doc, defs({ hero: definition }));

    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual(["hero"]);
  });

  it("still composes an instance under an UNGATED container inside a definition", () => {
    // The control for the rule above, on the definition side.
    const doc = page([instance("i1", "outer")]);
    const definitions = defs({
      outer: component([box("d1", [instance("d2", "inner")])]),
      inner: component([node("d3")]),
    });

    const result = resolveComponentInstances(doc, definitions);

    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual(["outer", "inner"]);
  });

  it("still composes an instance under an ancestor that is NOT gated", () => {
    // The control. Without it the rule above passes on an implementation that
    // refuses to descend into any container at all, which costs every page
    // every component it holds below the top level.
    const doc = page([box("wrap", [instance("i1", "hero")])]);
    const definitions = defs({ hero: component([node("d1"), node("d2")]) });

    const result = resolveComponentInstances(doc, definitions);

    expect(result.referenced).toEqual(["hero"]);
    expect(flatten(result.document.nodes)).toHaveLength(3);
  });

  it("carries an instance's per-breakpoint hiding onto every root", () => {
    const doc = page([
      {
        ...instance("i1", "hero"),
        visibility: { devices: { mobile: false, desktop: true } },
      },
    ]);
    const definitions = defs({ hero: component([node("d1"), node("d2")]) });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes).toHaveLength(2);
    // The whole setting travels, both values. Hiding inherits to narrower
    // breakpoints until a `true` ends the band, so copying only the `false`
    // would hide the component further than the author asked. What an instance
    // may NOT do is re-show a breakpoint the definition explicitly hid, which
    // the case below pins.
    expect(nodes.map(e => e.visibility?.devices)).toEqual([
      { mobile: false, desktop: true },
      { mobile: false, desktop: true },
    ]);
  });

  it("does not let an instance re-show a root its definition hid", () => {
    const doc = page([
      {
        ...instance("i1", "hero"),
        visibility: { devices: { mobile: true } },
      },
    ]);
    const definitions = defs({
      hero: component([
        node("d1", { visibility: { devices: { mobile: false } } }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[0]!.visibility?.devices?.mobile).toBe(false);
  });

  it("gives each instance its own DOM ids for one definition", () => {
    const doc = page([instance("i1", "hero"), instance("i2", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", { cssId: "signup", attributes: { ID: "signup" } }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[0]!.cssId).not.toBe(nodes[1]!.cssId);
    expect(nodes[0]!.attributes!.ID).not.toBe(nodes[1]!.attributes!.ID);
    // Derived from the original, so it stays recognisable in a URL fragment.
    expect(nodes[0]!.cssId).toContain("signup");
  });

  it("maps one definition's repeated DOM id to a single replacement", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", { cssId: "dup" }),
        node("d2", { cssId: "dup" }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    // The pair addressed one target before composition and must after.
    expect(nodes[0]!.cssId).toBe(nodes[1]!.cssId);
  });
});

describe("resolveComponentInstances bounds", () => {
  it("counts the host's surviving nodes against the composition budget", () => {
    const doc = page([node("keep"), instance("i1", "hero")]);
    const definitions = defs({
      hero: component([node("d1"), node("d2"), node("d3")]),
    });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 3 },
    });

    expect(flatten(result.document.nodes)).toHaveLength(2);
    expect(result.unresolved.map(e => e.reason)).toEqual(["budget"]);
  });

  it("spends the slot the replaced instance itself gives up", () => {
    const doc = page([node("keep"), instance("i1", "hero")]);
    const definitions = defs({ hero: component([node("d1"), node("d2")]) });

    // Two host nodes and a two-node definition under a cap of three: it fits
    // only because the instance node is replaced rather than added to.
    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 3 },
    });

    expect(flatten(result.document.nodes)).toHaveLength(3);
    expect(result.unresolved).toEqual([]);
  });

  it("never resolves slot content the definition no longer exposes", () => {
    const doc = page([
      instance(
        "i1",
        "hero",
        {},
        { slots: { gone: [instance("i2", "absent")] } }
      ),
    ]);
    const definitions = defs({ hero: component([node("d1")]) });

    const result = resolveComponentInstances(doc, definitions);

    expect(result.unresolved).toEqual([]);
    expect(result.referenced).toEqual(["hero"]);
  });

  it("refuses an oversized overrides record rather than applying part of it", () => {
    const overrides: Record<string, unknown> = { headline: "APPLIED" };
    for (let i = 0; i < MAX_ENVELOPE_ENTRIES + 1; i += 1) {
      overrides[`k${i}`] = i;
    }
    const definition = component([node("d1", { props: { text: "base" } })], {
      exposed: [
        {
          id: "headline",
          label: "H",
          nodeId: "d1",
          propPath: "text",
          type: "text",
        },
      ],
    });
    const doc = page([instance("i1", "hero", { overrides })]);

    const result = resolveComponentInstances(doc, defs({ hero: definition }));

    // Applying a prefix would make which overrides an author gets depend on
    // key enumeration order.
    expect(result.document.nodes[0]!.props.text).toBe("base");
  });

  it("calls a definition that is not a component document unreadable", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({ hero: page([node("d1")]) });

    const result = resolveComponentInstances(doc, definitions);

    // A page filed under a component's id is a fault in THAT document, not in
    // the instance naming it — the discrimination `malformed` cannot make.
    expect(result.unresolved.map(e => e.reason)).toEqual(["unreadable"]);
    expect(idsOf(result.document)).toEqual(["i1"]);
  });
});

describe("a node that spells a DOM id twice and renders one", () => {
  it("leaves a SHADOWED attribute id alone, and every reference to it", () => {
    // The measured reproduction. `cssId` shadows the bag, so this node renders
    // `actual` and never `hero` — and `hero` was therefore a reference to an
    // element in the HOST, which resolved before composition. Scoping it points
    // it at an id nothing renders, which is strictly worse than leaving it.
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", {
          cssId: "actual",
          attributes: { id: "hero", "aria-describedby": "hero" },
        }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[0]!.cssId).toContain("actual");
    expect(nodes[0]!.cssId).not.toBe("actual");
    expect(nodes[0]!.attributes!.id).toBe("hero");
    expect(nodes[0]!.attributes!["aria-describedby"]).toBe("hero");
  });

  it("moves both spellings together when they carry one value", () => {
    // Nothing is shadowed here: the two spell the SAME id, so the node renders
    // it and both have to arrive at one replacement, or the copy answers to two
    // addresses where the original answered to one.
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", { cssId: "signup", attributes: { id: "signup" } }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[0]!.attributes!.id).toBe(nodes[0]!.cssId);
    expect(nodes[0]!.cssId).not.toBe("signup");
  });

  it("scopes an id the node carries ONLY in its attribute bag", () => {
    // Nothing shadows it, so this bag id is what the node renders — and two
    // instances of one definition would otherwise both put it on the page.
    const doc = page([instance("i1", "hero"), instance("i2", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", { attributes: { id: "hero", "aria-describedby": "hero" } }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[0]!.attributes!.id).not.toBe("hero");
    expect(nodes[0]!.attributes!.id).toContain("hero");
    expect(nodes[0]!.attributes!.id).not.toBe(nodes[1]!.attributes!.id);
    // And the reference inside the definition follows it, since the id it named
    // IS the one this node renders.
    expect(nodes[0]!.attributes!["aria-describedby"]).toBe(
      nodes[0]!.attributes!.id
    );
  });

  it("scopes nothing for a node that renders no id at all", () => {
    // An empty `cssId` still SHADOWS, so this node emits no usable id — and a
    // bag value nothing renders must not reach the memo that rewrites
    // references, for the reason the shadowed case above gives.
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([
        stored(node("d1") as ResolvedBlockNode, {
          cssId: "",
          attributes: { id: "hero", "aria-describedby": "hero" },
        }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[0]!.attributes!.id).toBe("hero");
    expect(nodes[0]!.attributes!["aria-describedby"]).toBe("hero");
  });
});

describe("resolveComponentInstances defensive reads and references", () => {
  it("rewrites an IDREF attribute to the id it now points at", () => {
    const doc = page([instance("i1", "hero"), instance("i2", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", { cssId: "help" }),
        node("d2", { attributes: { "aria-describedby": "help" } }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    // The reference must resolve to its target INSIDE the same instance.
    expect(nodes[1]!.attributes!["aria-describedby"]).toBe(nodes[0]!.cssId);
    expect(nodes[3]!.attributes!["aria-describedby"]).toBe(nodes[2]!.cssId);
    // And the two instances must not both point at one target.
    expect(nodes[1]!.attributes!["aria-describedby"]).not.toBe(
      nodes[3]!.attributes!["aria-describedby"]
    );
    // A reference pointing at the ORIGINAL is the silent failure: it resolves
    // to nothing and the element simply loses its accessible description.
    expect(nodes[1]!.attributes!["aria-describedby"]).not.toBe("help");
  });

  it("survives an instance whose stored visibility is null", () => {
    const doc = page([stored(instance("i1", "hero"), { visibility: null })]);
    const definitions = defs({ hero: component([node("d1")]) });

    expect(() => resolveComponentInstances(doc, definitions)).not.toThrow();
  });

  it("keeps a malformed root envelope fail-closed while merging devices", () => {
    const doc = page([
      {
        ...instance("i1", "hero"),
        visibility: { devices: { mobile: false } },
      },
    ]);
    const definitions = defs({
      hero: component([stored(node("d1"), { visibility: "restricted" })]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    // `isConditionGated` reads an unreadable envelope as GATED. Normalising it
    // into a plain object with no `conditions` makes the later pass serve what
    // was withheld.
    expect(isConditionGated(nodes[0]!)).toBe(true);
  });

  it("refunds nodes discarded with an unexposed slot", () => {
    const doc = page([
      instance("i1", "hero", {}, { slots: { gone: [node("x"), node("y")] } }),
    ]);
    const definitions = defs({ hero: component([node("d1"), node("d2")]) });

    // Host holds three nodes; two of them are discarded with the unexposed
    // slot, so a two-node definition fits under a cap of three.
    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 3 },
    });

    expect(result.unresolved).toEqual([]);
    expect(flatten(result.document.nodes)).toHaveLength(2);
  });

  it("never mints a DOM id the host page already carries", () => {
    const definitions = defs({
      hero: component([node("d1", { cssId: "signup" })]),
    });
    const minted = resolveComponentInstances(
      page([instance("i1", "hero")]),
      definitions
    ).document.nodes[0]!.cssId!;

    const doc = page([node("host", { cssId: minted }), instance("i1", "hero")]);
    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[0]!.cssId).toBe(minted);
    expect(nodes[1]!.cssId).not.toBe(minted);
  });

  it("rewrites an id reference nested inside a slot", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([
        box("c1", [
          node("d1", { cssId: "help" }),
          node("d2", { attributes: { "aria-describedby": "help" } }),
        ]),
      ]),
    });

    const kids = resolveComponentInstances(doc, definitions).document.nodes[0]!
      .slots!.children!;

    // A rewrite that only walks the roots leaves every nested reference
    // dangling, which is most of them: a component's markup is a tree.
    expect(kids[1]!.attributes!["aria-describedby"]).toBe(kids[0]!.cssId);
  });

  it("refunds only the slots it discards, never the ones it uses", () => {
    const doc = page([
      instance("i1", "hero", {}, { slots: { body: [node("x"), node("y")] } }),
    ]);
    const definitions = defs({
      hero: component([box("c1", []), node("d2")], {
        slots: { body: { label: "Body", nodeId: "c1", slot: "children" } },
      }),
    });

    // The instance's two slot nodes ARE in the result, so refunding them would
    // buy room the document then spends twice and overrun the cap.
    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 3 },
    });

    expect(flatten(result.document.nodes).length).toBeLessThanOrEqual(3);
  });

  it("leaves an id reference the definition does not own alone", () => {
    const doc = page([
      node("outside", { cssId: "app-status" }),
      instance("i1", "hero"),
    ]);
    const definitions = defs({
      hero: component([
        node("d1", {
          cssId: "own",
          attributes: { "aria-controls": "own app-status" },
        }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    // The first token addresses the definition's own node and moves; the
    // second addresses the host page and must not, or a working relationship
    // is broken by a copy that had nothing to do with it.
    expect(nodes[1]!.attributes!["aria-controls"]).toBe(
      `${nodes[1]!.cssId} app-status`
    );
  });
});

describe("resolveComponentInstances ownership and cost", () => {
  it("leaves a host slot child's reference pointing at the host", () => {
    const doc = page([
      node("h", { cssId: "shared" }),
      instance(
        "i1",
        "hero",
        {},
        {
          slots: {
            body: [
              node("mine", { attributes: { "aria-describedby": "shared" } }),
            ],
          },
        }
      ),
    ]);
    const definitions = defs({
      hero: component([box("c1", []), node("d2", { cssId: "shared" })], {
        slots: { body: { label: "B", nodeId: "c1", slot: "children" } },
      }),
    });

    const flat = flatten(
      resolveComponentInstances(doc, definitions).document.nodes
    );
    const mine = flat.find(e => e.id === "mine")!;

    // Host content is the page's own. Rewriting it against the DEFINITION's
    // map redirects a working reference at a node the host never named.
    expect(mine.attributes!["aria-describedby"]).toBe("shared");
  });

  it("does not charge the budget for a node an override hides", () => {
    const doc = page([
      node("keep"),
      instance("i1", "hero", { overrides: { gone: false } }),
    ]);
    const definitions = defs({
      hero: component([node("d1"), node("d2")], {
        exposed: [
          {
            id: "gone",
            label: "G",
            nodeId: "d1",
            propPath: "x",
            type: "visibility",
          },
        ],
      }),
    });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 2 },
    });

    // The composed document holds the host node and one definition node.
    expect(result.unresolved).toEqual([]);
    expect(flatten(result.document.nodes)).toHaveLength(2);
  });

  it("merges devices onto a root whose visibility is stored null", () => {
    const doc = page([
      stored(instance("i1", "hero"), {
        visibility: { devices: { mobile: false } },
      }),
    ]);
    const definitions = defs({
      hero: component([stored(node("d1"), { visibility: null })]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    // `isConditionGated` reads null exactly like an absent envelope, so the
    // merge must too — refusing it silently drops the author's hiding.
    expect(nodes[0]!.visibility?.devices?.mobile).toBe(false);
  });
});

describe("resolveComponentInstances references, bands and cost", () => {
  it("points a fragment link at the id it now names", () => {
    const doc = page([instance("i1", "hero"), instance("i2", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", { cssId: "pricing" }),
        node("d2", { props: { href: "#pricing", label: "See" } }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[1]!.props.href).toBe(`#${String(nodes[0]!.cssId)}`);
    expect(nodes[3]!.props.href).toBe(`#${String(nodes[2]!.cssId)}`);
  });

  it("leaves a fragment that names nothing in the component alone", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", { cssId: "own" }),
        node("d2", { props: { href: "#elsewhere", text: "#1 seller" } }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[1]!.props.href).toBe("#elsewhere");
    expect(nodes[1]!.props.text).toBe("#1 seller");
  });

  it("rewrites a fragment nested inside a prop", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = defs({
      hero: component([
        node("d1", { cssId: "pricing" }),
        node("d2", {
          props: { cta: { links: [{ href: "#pricing" }] } },
        }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;
    const cta = nodes[1]!.props.cta as { links: { href: string }[] };

    // A block's props are a tree, not a flat record — a fragment reached only
    // through a record and an array is the ordinary shape, not the exotic one.
    expect(cta.links[0]!.href).toBe(`#${String(nodes[0]!.cssId)}`);
  });

  it("calls a definition supplied as null unreadable, not missing", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = new Map<string, BlockDocument>([
      ["hero", null as unknown as BlockDocument],
    ]);

    const result = resolveComponentInstances(doc, definitions);

    // Present-and-unreadable, so the key's PRESENCE is what separates it from
    // absent — a falsy value would read as absent to anything asking the map
    // for the value instead.
    expect(result.unresolved.map(e => e.reason)).toEqual(["unreadable"]);
  });

  it("keeps the true that ends an instance's hidden band", () => {
    const doc = page([
      stored(instance("i1", "hero"), {
        visibility: { devices: { tablet: false, mobile: true } },
      }),
    ]);
    const definitions = defs({ hero: component([node("d1")]) });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    // Hiding inherits to narrower breakpoints until a `true` ends the band, so
    // dropping the `true` hides the component further than the author asked.
    expect(nodes[0]!.visibility?.devices).toEqual({
      tablet: false,
      mobile: true,
    });
  });

  it("will not let an instance re-show a breakpoint the definition hid", () => {
    const doc = page([
      stored(instance("i1", "hero"), {
        visibility: { devices: { mobile: true } },
      }),
    ]);
    const definitions = defs({
      hero: component([
        node("d1", { visibility: { devices: { mobile: false } } }),
      ]),
    });

    const nodes = resolveComponentInstances(doc, definitions).document.nodes;

    expect(nodes[0]!.visibility?.devices?.mobile).toBe(false);
  });

  it("refunds slot content dropped with a hidden slot target", () => {
    const doc = page([
      instance(
        "i1",
        "hero",
        { overrides: { hide: false } },
        { slots: { body: [node("x"), node("y")] } }
      ),
    ]);
    const definitions = defs({
      hero: component([box("c1", []), node("r1"), node("r2")], {
        slots: { body: { label: "B", nodeId: "c1", slot: "children" } },
        exposed: [
          {
            id: "hide",
            label: "H",
            nodeId: "c1",
            propPath: "p",
            type: "visibility",
          },
        ],
      }),
    });

    const result = resolveComponentInstances(doc, definitions, {
      limits: { ...DEFAULT_LIMITS, maxNodes: 3 },
    });

    // The two supplied children go with the hidden target, so their charge has
    // to come back or the two visible roots are refused for room they freed.
    expect(result.unresolved).toEqual([]);
    expect(flatten(result.document.nodes)).toHaveLength(2);
  });

  it("calls a supplied-but-unreadable definition unreadable", () => {
    const doc = page([instance("i1", "hero")]);
    const definitions = new Map<string, BlockDocument>([
      [
        "hero",
        { formatVersion: 1, kind: "component" } as unknown as BlockDocument,
      ],
    ]);

    const result = resolveComponentInstances(doc, definitions);

    // `missing` asks somebody to publish or restore a component; a supplied
    // record that cannot be read is a document fault, and offering the wrong
    // remedy is the whole reason the reasons are a closed list.
    expect(result.unresolved.map(e => e.reason)).toEqual(["unreadable"]);
  });
});

describe("how a resolution reaches a definition", () => {
  it("asks a lookup for a definition only when it is about to read one", () => {
    // A caller that prepares its definitions cannot predict which ones a
    // resolution will read — an override may name a different component than
    // the definition stored, and the composition cap stops a chain long before
    // a catalog does. Asking here is what makes preparation and reachability
    // one answer instead of two that disagree.
    const asked: string[] = [];
    const stored = new Map<string, BlockDocument>([
      ["a", component([instance("n1", "b")])],
      ["b", component([node("d1")])],
      ["unused", component([node("d2")])],
    ]);

    const result = resolveComponentInstances(page([instance("i1", "a")]), {
      has: id => stored.has(id),
      get: id => {
        asked.push(id);
        return stored.get(id);
      },
    });

    // Once each, and only for what is reached: `unused` is in the map and is
    // never asked for.
    expect(asked).toEqual(["a", "b"]);
    expect(result.unresolved).toEqual([]);
  });

  it("reads a definition once, so a lookup cannot change under the run", () => {
    // Nothing in the contract makes a lookup pure, and the source that fetches
    // is the one most likely not to be: validating one read and expanding a
    // second means the value that was checked is not the value that is used.
    let reads = 0;
    const definition = component([node("d1")]);

    const result = resolveComponentInstances(page([instance("i1", "hero")]), {
      has: () => true,
      get: () => {
        reads += 1;
        return reads === 1 ? definition : undefined;
      },
    });

    expect(result.unresolved).toEqual([]);
    expect(flatten(result.document.nodes)).toHaveLength(1);
  });

  it("gives two instances of one component the SAME answer", () => {
    // Reading once per instance rather than once per run lets a stateful
    // lookup contradict itself inside one page: the first instance draws the
    // component and the second reports it unreadable. Whatever a lookup
    // answers, a resolution has to answer one thing about one component.
    const definition = component([node("d1")]);
    let reads = 0;

    const result = resolveComponentInstances(
      page([instance("i1", "hero"), instance("i2", "hero")]),
      {
        has: () => true,
        get: () => {
          reads += 1;
          return reads === 1 ? definition : undefined;
        },
      }
    );

    expect(result.unresolved).toEqual([]);
    expect(flatten(result.document.nodes)).toHaveLength(2);
  });

  it("takes `has` as the answer even when `get` produces nothing", () => {
    // The two are different questions. A lookup that answered presence from
    // whether a document came back would report a corrupt definition as one
    // nobody supplied, and send whoever is debugging to publish a component
    // that is already there.
    const result = resolveComponentInstances(page([instance("i1", "hero")]), {
      has: () => true,
      get: () => undefined,
    });

    expect(result.unresolved.map(e => e.reason)).toEqual(["unreadable"]);
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
