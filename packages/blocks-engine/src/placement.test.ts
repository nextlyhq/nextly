/**
 * The one placement rule, driven through the real registry with fixture
 * blocks, so the rule is observed reading definitions as the editor and the
 * server do rather than through a stub that restates them.
 *
 * The core blocks' own declarations are judged pair by pair in
 * `blocks-react`, which owns them; this file holds the rule's mechanics.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ContentModel } from "./content-model";
import { resolveContentModel, UNDECLARED_CONTENT_MODEL } from "./content-model";
import { COMPONENT_INSTANCE_TYPE, DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import {
  canPlace,
  canPlaceIn,
  declaredSlotNames,
  placementTracker,
  type PlacementSources,
} from "./placement";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/** A container whose `link` prop makes it render an `<a>`. */
const linkable = (props: { link?: string }): ContentModel =>
  typeof props.link === "string" && props.link !== ""
    ? { is: ["flow", "interactive"], accepts: { without: ["interactive"] } }
    : { is: ["flow"] };

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "t/box",
        slots: { children: {} },
        contentModel: linkable,
      },
      {
        ...base,
        name: "t/button",
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
      { ...base, name: "t/heading", contentModel: () => ({ is: ["flow"] }) },
      {
        ...base,
        name: "t/footer",
        slots: { children: {} },
        contentModel: () => ({
          is: ["flow", "footer"],
          accepts: { without: ["header", "footer"] },
        }),
      },
      {
        ...base,
        name: "t/label",
        slots: { children: {} },
        contentModel: () => ({
          is: ["flow", "phrasing"],
          accepts: { content: "phrasing" },
        }),
      },
      // A plugin block that declares nothing at all.
      { ...base, name: "t/plain", slots: { children: {} } },
      { ...base, name: "t/only-items", slots: { items: {} } },
    ] as never,
    { source: "test" }
  );
});

afterEach(() => {
  clearBlocks();
});

function sources(components?: Map<string, BlockDocument>): PlacementSources {
  return {
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
    ...(components === undefined ? {} : { components }),
  };
}

let next = 0;
function node(
  type: string,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode {
  next += 1;
  return {
    id: `n${next}`,
    type,
    version: 1,
    props,
    ...(slots ? { slots } : {}),
  };
}

const into = (parent: BlockNode, slot = "children") =>
  ({ kind: "slot", parent, slot, inherited: [] }) as const;

describe("canPlace: the content model", () => {
  it("refuses a Button inside a linked box and names the box", () => {
    const linked = node("t/box", { link: "/go" });
    const verdict = canPlace([node("t/button")], into(linked), sources());
    expect(verdict).toMatchObject({
      allowed: false,
      reason: "content-model",
      blockType: "t/button",
      kind: "interactive",
      refusedBy: { type: "t/box", id: linked.id },
    });
  });

  it("allows the same Button inside the same box with its link off", () => {
    expect(
      canPlace([node("t/button")], into(node("t/box")), sources())
    ).toEqual({
      allowed: true,
    });
  });

  it("refuses a Button any depth below a link, through blocks that refuse nothing", () => {
    const linked = node(
      "t/box",
      { link: "/go" },
      {
        children: [node("t/plain", {}, { children: [] })],
      }
    );
    const plain = linked.slots?.children[0] as BlockNode;
    const document = [linked];
    const verdict = canPlaceIn(
      document,
      [node("t/button")],
      { kind: "slot", parentId: plain.id, slot: "children" },
      sources()
    );
    expect(verdict).toMatchObject({
      reason: "content-model",
      refusedBy: { id: linked.id },
    });
  });

  it("refuses moving a box that holds a Button under a link, naming the Button", () => {
    const holder = node("t/box", {}, { children: [node("t/button")] });
    const verdict = canPlace(
      [holder],
      into(node("t/box", { link: "/go" })),
      sources()
    );
    expect(verdict).toMatchObject({
      reason: "content-model",
      blockType: "t/button",
    });
  });

  it("refuses a footer inside a footer", () => {
    const verdict = canPlace(
      [node("t/footer")],
      into(node("t/footer")),
      sources()
    );
    expect(verdict).toMatchObject({ reason: "content-model", kind: "footer" });
  });

  it("lets a block that declares nothing go inside a link: it is flow, not interactive", () => {
    expect(
      canPlace(
        [node("t/plain")],
        into(node("t/box", { link: "/go" })),
        sources()
      )
    ).toEqual({ allowed: true });
  });

  it("takes only phrasing children into a phrasing container", () => {
    const label = node("t/label");
    expect(canPlace([node("t/plain")], into(label), sources())).toMatchObject({
      reason: "phrasing-only",
      parentType: "t/label",
    });
    expect(canPlace([node("t/button")], into(label), sources())).toEqual({
      allowed: true,
    });
  });
});

describe("canPlace: declared slots", () => {
  it("refuses a slot the parent does not declare", () => {
    const verdict = canPlace(
      [node("t/heading")],
      into(node("t/box"), "aside"),
      sources()
    );
    expect(verdict).toMatchObject({
      reason: "undeclared-slot",
      parentType: "t/box",
      slot: "aside",
    });
  });

  it("refuses any block under a block that holds none", () => {
    const verdict = canPlace(
      [node("t/button")],
      into(node("t/heading")),
      sources()
    );
    expect(verdict).toMatchObject({
      reason: "holds-no-blocks",
      parentType: "t/heading",
    });
  });

  it("names a container's only slot whatever it is called", () => {
    expect(declaredSlotNames(node("t/only-items"), sources())).toEqual([
      "items",
    ]);
    expect(
      canPlace(
        [node("t/heading")],
        into(node("t/only-items"), "items"),
        sources()
      )
    ).toEqual({ allowed: true });
  });

  it("does not refuse a parent no definition carries: its slots are unknown", () => {
    expect(
      canPlace([node("t/heading")], into(node("t/missing")), sources())
    ).toEqual({
      allowed: true,
    });
  });
});

/** A component whose box (link on or off) exposes its children as `body`. */
function component(
  link: string | undefined,
  allow?: readonly string[]
): BlockDocument {
  const doc = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      { id: "inner", type: "t/box", version: 1, props: link ? { link } : {} },
      { id: "cta", type: "t/heading", version: 1, props: {} },
    ],
    slots: {
      body: {
        label: "Body",
        nodeId: "inner",
        slot: "children",
        ...(allow ? { allow } : {}),
      },
    },
  };
  return doc as unknown as BlockDocument;
}

const instance = (componentId: string) =>
  node(COMPONENT_INSTANCE_TYPE, { componentId });

describe("canPlace: component placements", () => {
  it("declares the slots its component exposes, and refuses any other", () => {
    const components = new Map([["c", component(undefined)]]);
    expect(declaredSlotNames(instance("c"), sources(components))).toEqual([
      "body",
    ]);
    expect(
      canPlace(
        [node("t/heading")],
        into(instance("c"), "children"),
        sources(components)
      )
    ).toMatchObject({ reason: "undeclared-slot" });
  });

  it("refuses a type the exposed slot excludes, though the inner slot takes anything", () => {
    const components = new Map([["c", component(undefined, ["t/heading"])]]);
    const at = into(instance("c"), "body");
    expect(canPlace([node("t/heading")], at, sources(components))).toEqual({
      allowed: true,
    });
    expect(canPlace([node("t/button")], at, sources(components))).toMatchObject(
      {
        reason: "not-allowed-in-slot",
        permitted: ["t/heading"],
      }
    );
  });

  it("carries what the component's inner chain refuses into the exposed slot", () => {
    const components = new Map([["c", component("/go")]]);
    expect(
      canPlace(
        [node("t/button")],
        into(instance("c"), "body"),
        sources(components)
      )
    ).toMatchObject({
      reason: "content-model",
      refusedBy: { type: "t/box" },
    });
  });

  it("counts what a component renders when the placement goes under a link", () => {
    const buttons = component(undefined);
    (buttons.nodes as BlockNode[]).push({
      id: "b",
      type: "t/button",
      version: 1,
      props: {},
    });
    const components = new Map([["c", buttons]]);
    expect(
      canPlace(
        [instance("c")],
        into(node("t/box", { link: "/go" })),
        sources(components)
      )
    ).toMatchObject({
      reason: "content-model",
      blockType: COMPONENT_INSTANCE_TYPE,
    });
  });

  it("leaves a placement's slots unknown, not refused, without the component", () => {
    expect(
      canPlace([node("t/heading")], into(instance("gone"), "x"), sources())
    ).toEqual({
      allowed: true,
    });
  });
});

describe("placementTracker", () => {
  function signatures(nodes: readonly BlockNode[]): Map<string, string> {
    const tracker = placementTracker(sources());
    const found = new Map<string, string>();
    const queue: { node: BlockNode; parent?: BlockNode; slot?: string }[] =
      nodes.map(n => ({
        node: n,
      }));
    for (const { node: at, parent, slot } of queue) {
      const tracked = tracker.visit(at, parent, slot);
      if (tracked !== undefined) found.set(at.id, tracked.signature);
      for (const [name, children] of Object.entries(at.slots ?? {})) {
        for (const child of children)
          queue.push({ node: child, parent: at, slot: name });
      }
    }
    return found;
  }

  it("judges a node where it sits, with what its ancestors refuse", () => {
    const button = node("t/button");
    const linked = node("t/box", { link: "/go" }, { children: [button] });
    const tracker = placementTracker(sources());
    tracker.visit(linked, undefined, undefined);
    expect(tracker.visit(button, linked, "children")?.verdict).toMatchObject({
      reason: "content-model",
    });
  });

  it("gives the same placement the same signature, and a changed ancestor a new one", () => {
    const button = node("t/button");
    const linked = node("t/box", { link: "/go" }, { children: [button] });
    const before = signatures([linked]).get(button.id);
    expect(signatures([structuredClone(linked)]).get(button.id)).toBe(before);
    // The same ids, the same types, but the ancestor's settings changed what
    // it is: the break is no longer the stored one.
    const relinked = { ...structuredClone(linked), props: {} };
    expect(signatures([relinked]).get(button.id)).not.toBe(before);
  });

  it("gives a subtree moved under another ancestor a new signature", () => {
    const button = node("t/button");
    const first = node("t/box", { link: "/a" }, { children: [button] });
    const second = node("t/box", { link: "/a" }, { children: [] });
    const before = signatures([first, second]).get(button.id);
    const moved = [
      { ...first, slots: { children: [] } },
      { ...second, slots: { children: [button] } },
    ];
    expect(signatures(moved).get(button.id)).not.toBe(before);
  });
});

describe("resolveContentModel", () => {
  it("reads a throwing, pending or malformed declaration as undeclared", () => {
    for (const declaration of [
      () => {
        throw new Error("boom");
      },
      () => Promise.resolve({ is: ["interactive"] }),
      () => ({ is: ["clickable"] }),
      () => ({ is: [] }),
      () => ({ is: ["flow"], accepts: { content: "inline" } }),
      () => ({ is: ["flow"], accepts: { without: ["interactive", "button"] } }),
    ]) {
      expect(resolveContentModel(declaration, {})).toBe(
        UNDECLARED_CONTENT_MODEL
      );
    }
  });

  it("normalises a declaration's lists into one order", () => {
    expect(
      resolveContentModel(
        () => ({
          is: ["interactive", "flow", "flow"],
          accepts: { without: ["main", "interactive"] },
        }),
        {}
      )
    ).toEqual({
      is: ["flow", "interactive"],
      content: "flow",
      without: ["interactive", "main"],
    });
  });
});

describe("resolveContentModel containment", () => {
  it("reads an answer whose fields throw when read as undeclared", () => {
    const hostile = new Proxy(
      {},
      {
        // Answers `then` like a plain object, so only the fields read during
        // normalisation throw.
        get(_target, key) {
          if (key === "then") return undefined;
          throw new Error("boom");
        },
      }
    );
    expect(resolveContentModel(() => hostile, {})).toBe(
      UNDECLARED_CONTENT_MODEL
    );
  });
});

describe("canPlace: a placement is what it composes to", () => {
  it("counts an override that switches the inner box's link on", () => {
    const exposing = component(undefined) as unknown as {
      exposed?: unknown;
    };
    exposing.exposed = [
      {
        id: "go",
        label: "Link",
        type: "text",
        nodeId: "inner",
        propPath: "link",
      },
    ];
    const components = new Map([["c", exposing as unknown as BlockDocument]]);
    const placed = node(COMPONENT_INSTANCE_TYPE, {
      componentId: "c",
      overrides: { go: "/go" },
    });
    expect(
      canPlace([node("t/button")], into(placed, "body"), sources(components))
    ).toMatchObject({ reason: "content-model" });
  });

  it("takes phrasing from its roots, not from a phrasing block inside a flow root", () => {
    const flowRoot = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "wrap",
          type: "t/box",
          version: 1,
          props: {},
          slots: {
            children: [{ id: "b", type: "t/button", version: 1, props: {} }],
          },
        },
      ],
    } as unknown as BlockDocument;
    const components = new Map([["c", flowRoot]]);
    expect(
      canPlace([instance("c")], into(node("t/label")), sources(components))
    ).toMatchObject({ reason: "phrasing-only" });
  });
});

describe("canPlace: a block that draws nothing", () => {
  it("is no content, so a link refuses it only once it draws", () => {
    registerBlocks(
      [
        {
          ...base,
          name: "t/frame",
          rendersNothing: (props: { src?: string }) => !props.src,
          contentModel: () => ({ is: ["flow", "interactive"] }),
        },
      ] as never,
      { source: "test" }
    );
    const linked = node("t/box", { link: "/go" });
    expect(canPlace([node("t/frame")], into(linked), sources())).toEqual({
      allowed: true,
    });
    expect(
      canPlace(
        [node("t/frame", { src: "https://example.com" })],
        into(linked),
        sources()
      )
    ).toMatchObject({ reason: "content-model" });
  });
});

describe("canPlace: a placement's phrasing ignores roots that draw nothing", () => {
  it("takes a component of an empty frame and a Button into a phrasing slot", () => {
    registerBlocks(
      [
        {
          ...base,
          name: "t/frame",
          rendersNothing: (props: { src?: string }) => !props.src,
          contentModel: () => ({ is: ["flow", "interactive"] }),
        },
      ] as never,
      { source: "test" }
    );
    const pair = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        { id: "f", type: "t/frame", version: 1, props: {} },
        { id: "b", type: "t/button", version: 1, props: {} },
      ],
    } as unknown as BlockDocument;
    expect(
      canPlace(
        [instance("c")],
        into(node("t/label")),
        sources(new Map([["c", pair]]))
      )
    ).toEqual({ allowed: true });
  });
});

describe("resolveContentModel: what a container accepts", () => {
  it.each([
    [{ is: ["flow"], accepts: { content: "phrasing" } }, "phrasing", []],
    [{ is: ["flow"], accepts: { without: ["form"] } }, "flow", ["form"]],
    [{ is: ["flow"], accepts: {} }, "flow", []],
  ])("reads %j", (answer, content, without) => {
    expect(resolveContentModel(() => answer, {})).toMatchObject({
      content,
      without,
    });
  });

  it.each([
    { is: ["flow"], accepts: null },
    { is: ["flow"], accepts: "phrasing" },
  ])("reads %j as undeclared", answer => {
    expect(resolveContentModel(() => answer, {})).toBe(
      UNDECLARED_CONTENT_MODEL
    );
  });
});

describe("canPlace: a placement's name rules are its composed roots'", () => {
  it("is refused at the top level, and taken by the slot that allows its root", () => {
    registerBlocks(
      [
        { ...base, name: "t/row", slots: { children: { allow: ["t/col"] } } },
        { ...base, name: "t/col", parent: ["t/row"], slots: { children: {} } },
      ] as never,
      { source: "test" }
    );
    const colRooted = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [{ id: "c", type: "t/col", version: 1, props: {} }],
    } as unknown as BlockDocument;
    const components = new Map([["c", colRooted]]);
    expect(
      canPlace([instance("c")], { kind: "root" }, sources(components))
    ).toMatchObject({
      reason: "restricted-at-root",
      blockType: "t/col",
    });
    expect(
      canPlace([instance("c")], into(node("t/row")), sources(components))
    ).toEqual({
      allowed: true,
    });
  });
});

describe("canPlace: a cycle of component placements", () => {
  it("reads the placement that closes the cycle as a placeholder, in bounded work", () => {
    const placing = (id: string, componentId: string) => ({
      id,
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId },
    });
    const a = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "wrap",
          type: "t/box",
          version: 1,
          props: {},
          slots: { children: [placing("ib", "b")] },
        },
      ],
    } as unknown as BlockDocument;
    const b = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [placing("ia", "a")],
    } as unknown as BlockDocument;
    const known = new Map([
      ["a", a],
      ["b", b],
    ]);
    let asked = 0;
    const counting = {
      has: (id: string) => (asked++, known.has(id)),
      get: (id: string) => (asked++, known.get(id)),
    };
    expect(
      canPlace([instance("a")], into(node("t/box")), {
        nesting: registryNestingSource(),
        definitions: registryBlockSource(),
        components: counting,
      })
    ).toEqual({ allowed: true });
    expect(asked).toBeLessThan(100);
  });
});
