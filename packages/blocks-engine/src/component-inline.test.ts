/**
 * Turning every copy of one component in a document into plain blocks.
 *
 * Each refusal is asserted with the document left as it was, because the
 * caller converts many hosts and must be able to refuse the whole delete
 * before writing any of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inlineComponentInstances, stillReferences } from "./component-inline";
import { planDetach } from "./composition-planners";
import { COMPONENT_INSTANCE_TYPE, DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode, ComponentDocument } from "./document";
import { DEFAULT_LIMITS, MAX_ENVELOPE_ENTRIES } from "./limits";
import { applyOps } from "./ops";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import type { DefinitionsById } from "./resolve-instances";
import { walkNodes } from "./tree";

/**
 * Every `applyOps` call made in this file, counted. Each apply measures the
 * whole page once per op, so the number of applies is what a conversion
 * costs on a large page. The calls go through unchanged.
 */
const applies = vi.hoisted(() => ({ count: 0 }));
vi.mock("./ops", async importOriginal => {
  const actual = await importOriginal<typeof import("./ops")>();
  return {
    ...actual,
    applyOps: (...args: Parameters<typeof actual.applyOps>) => {
      applies.count += 1;
      return actual.applyOps(...args);
    },
  };
});

const node = (id: string, extra: Partial<BlockNode> = {}): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
  ...extra,
});

const box = (id: string, children: BlockNode[]): BlockNode =>
  node(id, { type: "core/box", slots: { children } });

const instance = (
  id: string,
  componentId: string,
  extra: Partial<BlockNode> = {}
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
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

const anyParent = { parentsOf: () => undefined };

/** No block declares a slot, so no slot is locked. */
const noBlocks = { get: () => undefined };

function flatten(nodes: readonly BlockNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  walkNodes([...nodes], n => {
    out.push(n);
  });
  return out;
}

const componentsPlaced = (doc: BlockDocument): unknown[] =>
  flatten(doc.nodes)
    .filter(n => n.type === COMPONENT_INSTANCE_TYPE)
    .map(n => n.props?.componentId);

const marks = (doc: BlockDocument): unknown[] =>
  flatten(doc.nodes)
    .map(n => n.props?.mark)
    .filter(mark => mark !== undefined);

/** Inline `card` with the shared fixtures, keeping a copy to compare against. */
function inlineCard(
  doc: BlockDocument,
  definitions: DefinitionsById,
  limits = DEFAULT_LIMITS
) {
  const before = structuredClone(doc);
  const result = inlineComponentInstances(
    doc,
    "card",
    definitions,
    anyParent,
    noBlocks,
    limits
  );
  return { before, result };
}

const card = component([node("d1", { props: { mark: "card-body" } })]);

const shell = component([box("s1", [node("fallback")])], {
  slots: { body: { label: "Body", nodeId: "s1", slot: "children" } },
});

describe("turning every copy into plain blocks", () => {
  const definitions = defs({
    card,
    shell,
    other: component([node("o1", { props: { mark: "other-body" } })]),
  });

  it("converts every copy and leaves other components linked", () => {
    const doc = page([
      instance("i1", "card"),
      box("b1", [instance("i2", "card")]),
      instance("i3", "other"),
    ]);

    const { result } = inlineCard(doc, definitions);

    expect(result.problem).toBeUndefined();
    expect(result.converted).toBe(2);
    expect(componentsPlaced(result.document!)).toEqual(["other"]);
    expect(marks(result.document!)).toEqual(["card-body", "card-body"]);
  });

  it("converts a copy in another component's filled slot", () => {
    const doc = page([
      instance("i1", "shell", { slots: { body: [instance("i2", "card")] } }),
    ]);

    const { result } = inlineCard(doc, definitions);

    expect(result.converted).toBe(1);
    expect(componentsPlaced(result.document!)).toEqual(["shell"]);
    expect(marks(result.document!)).toEqual(["card-body"]);
  });

  it("converts a copy in a filled slot of a copy of itself, in a second pass", () => {
    // Detaching the outer copy MOVES its slot content, so the inner copy is
    // still a copy afterwards and needs a pass of its own.
    const framed = component([box("f1", [node("f-fallback")])], {
      slots: { body: { label: "Body", nodeId: "f1", slot: "children" } },
    });
    const doc = page([
      instance("outer", "framed", {
        slots: {
          body: [
            instance("inner", "framed", {
              slots: { body: [node("leaf", { props: { mark: "leaf" } })] },
            }),
          ],
        },
      }),
    ]);

    const result = inlineComponentInstances(
      doc,
      "framed",
      defs({ framed }),
      anyParent,
      noBlocks
    );

    expect(result.converted).toBe(2);
    expect(componentsPlaced(result.document!)).toEqual([]);
    expect(marks(result.document!)).toEqual(["leaf"]);
  });

  it("puts in each copy's place exactly what detaching it does", () => {
    // The copied nodes take fresh ids on every detach, so the two are
    // compared without them.
    const doc = page([node("before"), instance("i1", "shell")]);
    const plan = planDetach(doc, "i1", definitions, anyParent);
    const detached = applyOps(doc, plan.pageOps ?? []).document;

    const result = inlineComponentInstances(
      doc,
      "shell",
      definitions,
      anyParent,
      noBlocks
    );

    const withoutIds = (nodes: readonly BlockNode[]) =>
      JSON.stringify(nodes).replace(/"id":"[^"]*"/g, '"id":""');
    expect(plan.problem).toBeUndefined();
    expect(withoutIds(result.document!.nodes)).toBe(withoutIds(detached.nodes));
  });

  it("converts nothing the second time, and hands the document back", () => {
    const doc = page([instance("i1", "card")]);
    const once = inlineCard(doc, definitions).result;

    const twice = inlineCard(once.document!, definitions).result;

    expect(twice.converted).toBe(0);
    expect(twice.document).toBe(once.document);
  });

  it("hands back a document with no copy unchanged", () => {
    const doc = page([instance("i3", "other")]);

    const { result } = inlineCard(doc, definitions);

    expect(result).toEqual({ document: doc, converted: 0 });
    expect(result.document).toBe(doc);
  });
});

describe("what it refuses, changing nothing", () => {
  it("refuses a copy whose definition is missing", () => {
    const doc = page([instance("i1", "card")]);

    const { before, result } = inlineCard(doc, defs({}));

    expect(result).toEqual({ problem: "not-a-component", nodeId: "i1" });
    expect(doc).toEqual(before);
  });

  it("refuses a copy whose definition is unreadable", () => {
    const doc = page([instance("i1", "card")]);

    const { result } = inlineCard(doc, defs({ card: page([node("p1")]) }));

    expect(result).toEqual({ problem: "not-a-component", nodeId: "i1" });
  });

  it("refuses a definition that draws a copy of itself", () => {
    // Detaching it succeeds and leaves the nested copy standing, so a loop
    // that only asked whether copies remain would never end.
    const looping = component([
      node("d1", { props: { mark: "card-body" } }),
      instance("dn", "card"),
    ]);
    const doc = page([instance("i1", "card")]);

    const { result } = inlineCard(doc, defs({ card: looping }));

    expect(result).toEqual({ problem: "not-a-component", nodeId: "i1" });
  });

  it("refuses a locked copy, after converting none of the others", () => {
    const doc = page([
      instance("i1", "card"),
      instance("i2", "card", { locked: true }),
    ]);

    const { before, result } = inlineCard(doc, defs({ card }));

    expect(result).toEqual({ problem: "destination-locked", nodeId: "i2" });
    expect(doc).toEqual(before);
  });

  it("refuses a conversion that would put the document past its limits", () => {
    const big = component(Array.from({ length: 8 }, (_, i) => node(`d${i}`)));
    const doc = page([instance("i1", "card")]);

    const { result } = inlineCard(doc, defs({ card: big }), {
      ...DEFAULT_LIMITS,
      maxNodes: 4,
    });

    expect(result).toEqual({ problem: "exceeds-limits", nodeId: "i1" });
  });

  it("refuses a document it cannot read to the end", () => {
    const doc = page([
      node("n1"),
      node("n2"),
      node("n3"),
      instance("i1", "card"),
    ]);

    const { result } = inlineCard(doc, defs({ card }), {
      ...DEFAULT_LIMITS,
      maxNodes: 2,
    });

    expect(result).toEqual({ problem: "unreadable" });
  });
});

describe("a component reached without a stored copy", () => {
  /** A teaser whose one nested instance the placer may re-point. */
  const teaser = (envelope: Partial<ComponentDocument> = {}) =>
    component([instance("pick", "other")], {
      exposed: [
        {
          id: "which",
          label: "Which card",
          nodeId: "pick",
          propPath: "componentId",
          type: "select",
          options: [
            { value: "card", label: "Card" },
            { value: "other", label: "Other" },
          ],
        },
      ],
      ...envelope,
    });

  const other = component([node("o1")]);

  it("refuses a component whose variant installs it", () => {
    const host = teaser({
      variants: { alt: { label: "Alt", overrides: { which: "card" } } },
    });

    const { result } = inlineCard(host, defs({ card, other }));

    expect(result).toEqual({ problem: "picked-by-override" });
  });

  it("refuses a component whose variants cannot all be read", () => {
    // Every node is read, but a variant past the envelope's bound could be
    // the one installing it.
    const variants = Object.fromEntries(
      Array.from({ length: MAX_ENVELOPE_ENTRIES + 1 }, (_, i) => [
        `v${i}`,
        { label: `V${i}`, overrides: {} },
      ])
    );

    const { result } = inlineCard(teaser({ variants }), defs({ card, other }));

    expect(result).toEqual({ problem: "unreadable" });
  });

  it("refuses a placement whose override installs it", () => {
    const doc = page([
      instance("t1", "teaser", {
        props: { componentId: "teaser", overrides: { which: "card" } },
      }),
    ]);

    const { result } = inlineCard(doc, defs({ card, other, teaser: teaser() }));

    expect(result).toEqual({ problem: "picked-by-override", nodeId: "t1" });
  });

  it("converts when the override installs something else", () => {
    // The control: the same placement, re-pointed elsewhere, reaches no copy.
    const doc = page([
      instance("t1", "teaser", {
        props: { componentId: "teaser", overrides: { which: "other" } },
      }),
      instance("i1", "card"),
    ]);

    const { result } = inlineCard(doc, defs({ card, other, teaser: teaser() }));

    expect(result.converted).toBe(1);
  });
});

describe("a host component exposing a node inside a copy", () => {
  it("refuses when an exposed property points at the copy", () => {
    const host = component([instance("c1", "card")], {
      exposed: [
        {
          id: "style",
          label: "Style",
          nodeId: "c1",
          propPath: "variant",
          type: "text",
        },
      ],
    });

    const { before, result } = inlineCard(host, defs({ card }));

    expect(result).toEqual({ problem: "exposure-points-inside", nodeId: "c1" });
    expect(host).toEqual(before);
  });

  it("refuses when an exposed slot points at the copy", () => {
    const host = component([instance("c1", "shell")], {
      slots: { extra: { label: "Extra", nodeId: "c1", slot: "body" } },
    });

    const result = inlineComponentInstances(
      host,
      "shell",
      defs({ shell }),
      anyParent,
      noBlocks
    );

    expect(result).toEqual({ problem: "exposure-points-inside", nodeId: "c1" });
  });

  it("converts when the exposure points at content the copy's slot moves out", () => {
    // Filled slot content keeps its node ids, so an exposure on it still
    // finds its node once the copy is gone.
    const host = component(
      [instance("c1", "shell", { slots: { body: [node("mine")] } })],
      {
        exposed: [
          {
            id: "text",
            label: "Text",
            nodeId: "mine",
            propPath: "text",
            type: "text",
          },
        ],
      }
    );

    const result = inlineComponentInstances(
      host,
      "shell",
      defs({ shell }),
      anyParent,
      noBlocks
    );

    expect(result.converted).toBe(1);
  });

  it("converts when an exposure already pointed at nothing", () => {
    // Not the conversion's doing, so not a reason to refuse it.
    const host = component([instance("c1", "card")], {
      exposed: [
        {
          id: "gone",
          label: "Gone",
          nodeId: "removed-long-ago",
          propPath: "text",
          type: "text",
        },
      ],
    });

    const { result } = inlineCard(host, defs({ card }));

    expect(result.converted).toBe(1);
  });

  it("refuses an exposure list it cannot read", () => {
    const host = {
      ...component([instance("c1", "card")]),
      exposed: "not a list",
    } as unknown as BlockDocument;

    const { result } = inlineCard(host, defs({ card }));

    expect(result).toEqual({ problem: "unreadable", nodeId: "c1" });
  });
});

describe("a copy standing in a locked slot", () => {
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };

  beforeEach(() => {
    registerBlocks(
      [
        { ...base, name: "acme/headline" },
        { ...base, name: "acme/divider" },
        { ...base, name: "acme/panel" },
        {
          ...base,
          name: "acme/fixed-row",
          slots: {
            items: {
              defaultBlock: [
                { type: "acme/headline" },
                { type: "acme/divider" },
              ],
              lock: "all",
            },
          },
        },
      ] as never,
      { source: "acme" }
    );
  });

  afterEach(() => {
    clearBlocks();
  });

  /** A row that holds the copy where its headline starts. */
  const row = () =>
    page([
      node("row", {
        type: "acme/fixed-row",
        slots: {
          items: [
            instance("i1", "card"),
            node("div", { type: "acme/divider" }),
          ],
        },
      }),
    ]);

  const drawing = (type: string) =>
    defs({ card: component([node("d1", { type })]) });

  it("is a copy the per-copy planner does not refuse", () => {
    // Which is why the whole document is judged: the planner reads no slot
    // lock, and would hand back a plan for this copy.
    expect(
      planDetach(row(), "i1", drawing("acme/panel"), registryNestingSource())
        .problem
    ).toBeUndefined();
  });

  it("refuses when the converted slot no longer holds what the lock fixes", () => {
    const doc = row();
    const before = structuredClone(doc);

    const result = inlineComponentInstances(
      doc,
      "card",
      drawing("acme/panel"),
      registryNestingSource(),
      registryBlockSource()
    );

    expect(result).toEqual({ problem: "destination-locked", nodeId: "row" });
    expect(doc).toEqual(before);
  });

  it("converts when the copy draws the block the slot starts with", () => {
    // The control: the slot ends holding exactly its starting blocks, which
    // breaks no lock.
    const result = inlineComponentInstances(
      row(),
      "card",
      drawing("acme/headline"),
      registryNestingSource(),
      registryBlockSource()
    );

    expect(result.converted).toBe(1);
  });
});

/**
 * Values the op layer will not edit, each holding no copy of the component:
 * a reader that let one through would find nothing and answer as though the
 * document were known not to use it.
 */
const MALFORMED: readonly (readonly [string, () => unknown])[] = [
  ["no format version", () => ({ kind: "page", nodes: [node("n1")] })],
  [
    "a format this version does not know",
    () => ({ formatVersion: 2, kind: "page", nodes: [node("n1")] }),
  ],
  ["no kind", () => ({ formatVersion: 1, nodes: [node("n1")] })],
  [
    "a kind this version does not know",
    () => ({ formatVersion: 1, kind: "widget", nodes: [node("n1")] }),
  ],
  [
    "an envelope value JSON cannot write",
    () => ({ ...page([node("n1")]), settings: { size: 1n } }),
  ],
  [
    "a computed envelope field",
    () =>
      Object.defineProperty({ formatVersion: 1, nodes: [node("n1")] }, "kind", {
        enumerable: true,
        get: () => "page",
      }),
  ],
  ["a forest entry that is not a node", () => page([null as never])],
];

describe("a document the op layer would not edit", () => {
  it.each(MALFORMED)("is refused with %s", (_name, make) => {
    const result = inlineComponentInstances(
      make() as BlockDocument,
      "card",
      defs({ card }),
      anyParent,
      noBlocks
    );

    expect(result).toEqual({ problem: "unusable-document" });
  });

  it.each(MALFORMED)("answers unknown with %s", (_name, make) => {
    expect(stillReferences(make(), "card")).toBe("unknown");
  });

  it("answers no for the same document well formed", () => {
    // The control: what each case above breaks is the only thing wrong.
    const doc = page([node("n1")]);

    expect(stillReferences(doc, "card")).toBe("no");
    expect(inlineCard(doc, defs({ card })).result).toEqual({
      document: doc,
      converted: 0,
    });
  });
});

describe("what converting many copies costs", () => {
  it("applies the ops no more often than detaching each copy does", () => {
    // Each apply measures the whole page, so an extra apply per copy is an
    // extra pass over the page per copy. The planner applies its ops to judge
    // the limits, and the page that produces is the one the conversion keeps.
    const copies = 6;
    const doc = page(
      Array.from({ length: copies }, (_, i) => instance(`i${i}`, "card"))
    );
    applies.count = 0;
    planDetach(doc, "i0", defs({ card }), anyParent);
    const perCopy = applies.count;

    applies.count = 0;
    const { result } = inlineCard(doc, defs({ card }));

    expect(perCopy).toBeGreaterThan(0);
    expect(result.converted).toBe(copies);
    expect(applies.count).toBe(perCopy * copies);
  });
});

describe("whether a document still references a component", () => {
  it("is yes for a stored copy", () => {
    expect(stillReferences(page([instance("i1", "card")]), "card")).toBe("yes");
  });

  it("is yes for a copy a variant installs", () => {
    const host = component([instance("pick", "other")], {
      exposed: [
        {
          id: "which",
          label: "Which",
          nodeId: "pick",
          propPath: "componentId",
          type: "text",
        },
      ],
      variants: { alt: { label: "Alt", overrides: { which: "card" } } },
    });

    expect(stillReferences(host, "card")).toBe("yes");
  });

  it("is no once every copy is converted", () => {
    const doc = page([instance("i1", "card"), instance("i2", "other")]);
    const { result } = inlineCard(doc, defs({ card, other: card }));

    expect(stillReferences(result.document, "card")).toBe("no");
  });

  it("is unknown past the node bound", () => {
    const doc = page([node("n1"), node("n2"), instance("i1", "other")]);

    expect(stillReferences(doc, "card", 2)).toBe("unknown");
  });

  it("is unknown for a value that is not a document", () => {
    expect(stillReferences({ nodes: "none" }, "card")).toBe("unknown");
    expect(stillReferences(null, "card")).toBe("unknown");
  });
});
