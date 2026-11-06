/**
 * The editor's map from a composed node's props to the placement's exposures.
 *
 * The canvas edits a value inside a component through it, so what matters is
 * that it names the exposure the page shows, that it covers the host
 * placement's own component and nothing nested, and that a render never
 * carries it.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ExposedProperty,
} from "./document";
import {
  resolveComponentInstances,
  type ResolvedBlockNode,
} from "./resolve-instances";

const text = (id: string, props: Record<string, unknown> = {}): BlockNode => ({
  id,
  type: "core/text",
  version: 1,
  props: { text: id, ...props },
});

const placement = (
  id: string,
  componentId: string,
  props: Record<string, unknown> = {}
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...props },
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

/** The composed node whose text prop reads `marker`. */
function nodeShowing(
  nodes: readonly ResolvedBlockNode[],
  marker: string
): ResolvedBlockNode | undefined {
  return flatten(nodes).find(entry => entry.props.text === marker);
}

const HEADER = component(
  [text("title"), text("subtitle")],
  [
    exposure("headline", "title", "text"),
    exposure("tone", "title", "tone", "select"),
    // A propPath on a visibility row is ignored by the writer; it maps nothing.
    exposure("shown", "subtitle", "text", "visibility"),
  ]
);

describe("the exposure map on composed nodes", () => {
  it("maps each exposed prop to its exposure id, in editor mode", () => {
    const { document } = resolveComponentInstances(
      page([placement("p1", "header")]),
      new Map([["header", HEADER]]),
      { exposures: true }
    );
    const title = nodeShowing(document.nodes, "title");
    expect(title?.instanceOf).toBe("p1");
    expect(title?.exposedProps).toEqual({
      text: { id: "headline", type: "text" },
      tone: { id: "tone", type: "select" },
    });
    // Visibility drives the node itself, so it is keyed by `visibility`
    // whatever the stored path says, never by the prop it names.
    expect(nodeShowing(document.nodes, "subtitle")?.exposedProps).toEqual({
      visibility: { id: "shown", type: "visibility" },
    });
  });

  it("is absent from a render's output", () => {
    const { document } = resolveComponentInstances(
      page([placement("p1", "header")]),
      new Map([["header", HEADER]])
    );
    const composed = flatten(document.nodes);
    expect(composed.length).toBeGreaterThan(0);
    for (const entry of composed) expect("exposedProps" in entry).toBe(false);
    expect(JSON.stringify(document)).not.toContain("exposedProps");
  });

  it("drops a map stored on a definition's node, in a render and in the editor", () => {
    // A stored node carrying a field the stored format does not declare, as
    // an import or a hand edit can leave one.
    const plain = {
      ...text("plain"),
      exposedProps: { text: { id: "x", type: "text" } },
    };
    const forged = component(
      [text("title"), plain as BlockNode],
      [exposure("headline", "title", "text")]
    );
    for (const exposures of [false, true]) {
      const { document } = resolveComponentInstances(
        page([placement("p1", "forged")]),
        new Map([["forged", forged]]),
        { exposures }
      );
      expect(nodeShowing(document.nodes, "plain")?.exposedProps).toBe(
        undefined
      );
    }
  });

  it("names the exposure the page shows when two point at one prop", () => {
    const twin = component(
      [text("title")],
      [exposure("first", "title", "text"), exposure("second", "title", "text")]
    );
    const lookup = new Map([["twin", twin]]);
    const read = (props: Record<string, unknown>) =>
      nodeShowing(
        resolveComponentInstances(
          page([placement("p1", "twin", props)]),
          lookup,
          { exposures: true }
        ).document.nodes,
        props.overrides === undefined
          ? "title"
          : String(Object.values(props.overrides as object)[0])
      )?.exposedProps?.text?.id;

    // Neither set: the last declared is the one an edit makes visible.
    expect(read({})).toBe("second");
    // Only the first set: it is what the page shows, so it is what is edited.
    expect(read({ overrides: { first: "Shown" } })).toBe("first");
  });

  it("maps no node of a component nested inside the placed one", () => {
    const inner = component(
      [text("inner")],
      [exposure("innerText", "inner", "text")]
    );
    const outer = component(
      [text("outer"), placement("nested", "inner")],
      [exposure("outerText", "outer", "text")]
    );
    const { document } = resolveComponentInstances(
      page([placement("p1", "outer")]),
      new Map([
        ["inner", inner],
        ["outer", outer],
      ]),
      { exposures: true }
    );
    expect(nodeShowing(document.nodes, "outer")?.exposedProps).toEqual({
      text: { id: "outerText", type: "text" },
    });
    const nested = nodeShowing(document.nodes, "inner");
    expect(nested?.instanceOf).toBe("p1");
    expect(nested?.exposedProps).toBe(undefined);
  });

  it("maps a nested component's node to the host exposure that drives it", () => {
    const inner = component(
      [text("inner")],
      [exposure("innerText", "inner", "text")]
    );
    // The host exposes the nested placement's own field, through its
    // `overrides`; that is the only way a nested field is reached.
    const outer = component(
      [placement("nested", "inner")],
      [exposure("outerText", "nested", "overrides.innerText")]
    );
    const lookup = new Map([
      ["inner", inner],
      ["outer", outer],
    ]);
    const mapped = resolveComponentInstances(
      page([placement("p1", "outer")]),
      lookup,
      { exposures: true }
    ).document;
    expect(nodeShowing(mapped.nodes, "inner")?.exposedProps).toEqual({
      text: { id: "outerText", type: "text" },
    });

    // And the host exposure's value is what that node shows.
    const edited = resolveComponentInstances(
      page([placement("p1", "outer", { overrides: { outerText: "Set" } })]),
      lookup,
      { exposures: true }
    ).document;
    expect(nodeShowing(edited.nodes, "Set")?.exposedProps).toEqual({
      text: { id: "outerText", type: "text" },
    });
  });

  it("maps a placement inside a page's slot content to that placement", () => {
    const { document } = resolveComponentInstances(
      page([
        {
          id: "box",
          type: "core/box",
          version: 1,
          props: {},
          slots: { children: [placement("p2", "header")] },
        },
      ]),
      new Map([["header", HEADER]]),
      { exposures: true }
    );
    const title = nodeShowing(document.nodes, "title");
    expect(title?.instanceOf).toBe("p2");
    expect(title?.exposedProps?.text?.id).toBe("headline");
  });
});
