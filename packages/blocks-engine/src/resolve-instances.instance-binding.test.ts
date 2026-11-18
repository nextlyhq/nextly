/**
 * A placement's setting bound to data: `bindings["overrides.<id>"]` on the
 * placement is written, when the component is composed, onto the prop of the
 * component's own block that the setting fills, so the bound value is read
 * there as any block's binding is (a list's entry, the page, a Single).
 */
import { describe, expect, it } from "vitest";

import {
  type Binding,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ExposedProperty,
} from "./document";
import { planDetach } from "./composition-planners";
import { COLLECTION_LIST_TYPE, LIST_ENTRY_SLOT } from "./list-query";
import { applyOps } from "./ops";
import {
  resolveComponentInstances,
  type ResolvedBlockNode,
} from "./resolve-instances";

const heading = (
  id: string,
  props: Record<string, unknown> = {},
  bindings?: Record<string, Binding>
): BlockNode => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, ...props },
  ...(bindings === undefined ? {} : { bindings }),
});

const placement = (
  id: string,
  componentId: string,
  props: Record<string, unknown> = {},
  bindings?: Record<string, unknown>
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...props },
  ...(bindings === undefined
    ? {}
    : { bindings: bindings as Record<string, Binding> }),
});

const exposure = (
  id: string,
  nodeId: string,
  propPath: string,
  type: ExposedProperty["type"] = "text"
): ExposedProperty => ({ id, label: id, nodeId, propPath, type });

const component = (
  nodes: BlockNode[],
  exposed: ExposedProperty[]
): ComponentDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
  exposed,
});

const list = (id: string, children: BlockNode[]): BlockNode => ({
  id,
  type: COLLECTION_LIST_TYPE,
  version: 1,
  props: { query: { collection: "posts" } },
  slots: { [LIST_ENTRY_SLOT]: children },
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

function flatten(nodes: readonly ResolvedBlockNode[]): ResolvedBlockNode[] {
  return nodes.flatMap(entry => [
    entry,
    ...Object.values(entry.slots ?? {}).flatMap(children => flatten(children)),
  ]);
}

/** The composed copy of a component's block, found by its stored id. */
function composedOf(
  nodes: readonly ResolvedBlockNode[],
  storedText: string
): ResolvedBlockNode | undefined {
  return flatten(nodes).find(
    entry => entry.instanceOf !== undefined && entry.props.text === storedText
  );
}

const CARD = component(
  [heading("title"), heading("summary"), heading("aside")],
  [
    exposure("headline", "title", "text"),
    exposure("blurb", "summary", "text"),
    exposure("shown", "aside", "text", "visibility"),
  ]
);

/** Each post's title, from the list the placement sits in, named. */
const byItemTitle: Binding = { $bind: "title", source: "item", list: "posts" };

function compose(
  document: BlockDocument,
  components: Record<string, ComponentDocument> = { card: CARD }
): ResolvedBlockNode[] {
  return resolveComponentInstances(
    document,
    new Map(Object.entries(components))
  ).document.nodes as ResolvedBlockNode[];
}

describe("a placement's setting bound to data", () => {
  it("binds the component block's prop the setting fills", () => {
    const nodes = compose(
      page([
        list("posts", [
          placement("p1", "card", {}, { "overrides.headline": byItemTitle }),
        ]),
      ])
    );
    expect(composedOf(nodes, "title")?.bindings).toEqual({
      text: byItemTitle,
    });
    // The setting it does not bind keeps what it had: no binding.
    expect(composedOf(nodes, "summary")?.bindings).toBeUndefined();
  });

  it("keeps the placement's stored value under the binding, as its own value", () => {
    const nodes = compose(
      page([
        list("posts", [
          placement(
            "p1",
            "card",
            { overrides: { headline: "Typed on the page" } },
            { "overrides.headline": byItemTitle }
          ),
        ]),
      ])
    );
    const title = flatten(nodes).find(
      entry => entry.bindings?.text !== undefined
    );
    expect(title?.props.text).toBe("Typed on the page");
    expect(title?.bindings).toEqual({ text: byItemTitle });
  });

  it("wins over the component block's own binding of that prop, and keeps its others", () => {
    const own: Binding = { $bind: "name", source: "site" };
    const level: Binding = { $bind: "level", source: "entry" };
    const bound = component(
      [heading("title", {}, { text: own, level })],
      [exposure("headline", "title", "text")]
    );
    const nodes = compose(
      page([
        list("posts", [
          placement("p1", "card", {}, { "overrides.headline": byItemTitle }),
        ]),
      ]),
      { card: bound }
    );
    expect(composedOf(nodes, "title")?.bindings).toEqual({
      text: byItemTitle,
      level,
    });
  });

  it("reads the placement's list in a block inside the component's own list", () => {
    // The Card lists its tags; its title sits inside that list, so a binding
    // with no list named would read a tag there.
    const tagged = component(
      [list("tags", [heading("title")])],
      [exposure("headline", "title", "text")]
    );
    const nodes = compose(
      page([
        list("posts", [
          placement("p1", "card", {}, { "overrides.headline": byItemTitle }),
        ]),
      ]),
      { card: tagged }
    );
    expect(composedOf(nodes, "title")?.bindings).toEqual({
      text: byItemTitle,
    });
  });

  it("writes nothing for a list item binding that names no list", () => {
    const nodes = compose(
      page([
        list("posts", [
          placement(
            "p1",
            "card",
            {},
            { "overrides.headline": { $bind: "title", source: "item" } }
          ),
        ]),
      ])
    );
    expect(composedOf(nodes, "title")?.bindings).toBeUndefined();
  });

  it("binds a setting whose id holds a dot", () => {
    const dotted = component(
      [heading("title")],
      [exposure("hero.title", "title", "text")]
    );
    const nodes = compose(
      page([
        list("posts", [
          placement("p1", "card", {}, { "overrides.hero.title": byItemTitle }),
        ]),
      ]),
      { card: dotted }
    );
    expect(composedOf(nodes, "title")?.bindings).toEqual({
      text: byItemTitle,
    });
  });

  it("names the page's list as stored, never as a list of the component", () => {
    // The component holds a block whose id is the page list's: a binding
    // naming the page's list must not be followed to that block's copy.
    const clash = component(
      [heading("title"), heading("posts")],
      [exposure("headline", "title", "text")]
    );
    const outer: Binding = { $bind: "title", source: "item", list: "posts" };
    const nodes = compose(
      page([
        list("posts", [
          list("inner", [
            placement("p1", "card", {}, { "overrides.headline": outer }),
          ]),
        ]),
      ]),
      { card: clash }
    );
    expect(composedOf(nodes, "title")?.bindings).toEqual({ text: outer });
  });

  it("binds each placement on its own: one placement's binding is not another's", () => {
    const nodes = compose(
      page([
        list("posts", [
          placement("p1", "card", {}, { "overrides.headline": byItemTitle }),
          placement("p2", "card"),
        ]),
      ])
    );
    const titles = flatten(nodes).filter(
      entry => entry.instanceOf !== undefined && entry.props.text === "title"
    );
    expect(titles.map(entry => entry.bindings)).toEqual([
      { text: byItemTitle },
      undefined,
    ]);
    // Nor is the stored component written through.
    expect(CARD.nodes[0]?.bindings).toBeUndefined();
  });

  it("writes nothing for a key that names no setting it can bind", () => {
    const nodes = compose(
      page([
        list("posts", [
          placement(
            "p1",
            "card",
            {},
            {
              // A setting the component does not have.
              "overrides.gone": byItemTitle,
              // A visibility setting decides whether a block is shown.
              "overrides.shown": byItemTitle,
              // Not a setting's key at all.
              overrides: byItemTitle,
              "overrides.headline.more": byItemTitle,
              text: byItemTitle,
            }
          ),
        ]),
      ])
    );
    for (const entry of flatten(nodes)) {
      expect(entry.bindings).toBeUndefined();
    }
  });

  it("writes nothing for a stored binding that is not a record", () => {
    const nodes = compose(
      page([
        list("posts", [
          placement("p1", "card", {}, { "overrides.headline": "title" }),
        ]),
      ])
    );
    expect(composedOf(nodes, "title")?.bindings).toBeUndefined();
  });

  it("reaches a component inside the component, through the setting that drives it", () => {
    const inner = component(
      [heading("label")],
      [exposure("caption", "label", "text")]
    );
    const outer = component(
      [placement("nested", "inner")],
      [exposure("headline", "nested", "overrides.caption")]
    );
    const nodes = compose(
      page([
        list("posts", [
          placement("p1", "outer", {}, { "overrides.headline": byItemTitle }),
        ]),
      ]),
      { inner, outer }
    );
    expect(composedOf(nodes, "label")?.bindings).toEqual({
      text: byItemTitle,
    });
  });

  it("keeps the binding on the block when the placement is detached", () => {
    const stored = page([
      list("posts", [
        placement("p1", "card", {}, { "overrides.headline": byItemTitle }),
      ]),
    ]);
    const plan = planDetach(stored, "p1", new Map([["card", CARD]]), {
      parentsOf: () => undefined,
    });
    if (plan.pageOps === undefined) throw new Error(String(plan.problem));
    const detached = applyOps(stored, plan.pageOps).document;
    const title = flatten(detached.nodes as ResolvedBlockNode[]).find(
      entry => entry.props.text === "title"
    );
    expect(title?.bindings).toEqual({ text: byItemTitle });
  });
});
