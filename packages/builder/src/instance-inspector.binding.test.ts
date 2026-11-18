/**
 * Which of a placement's settings may be bound to data, and what each is
 * bound to now: a text, link or image setting whose component block's prop a
 * field can fill, judged by that prop's own schema, the one the binding is
 * written onto when the component is composed.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectInstance, withPlacementLists } from "./instance-inspector";

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/card-title",
        version: 1,
        description: "A title.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: {
          text: { label: "Text", role: "content", type: "text" },
          href: { label: "Address", role: "content", type: "url" },
          picture: { label: "Picture", role: "content", type: "media" },
          tone: { label: "Tone", type: "select", options: ["light", "dark"] },
          items: { label: "Items", type: "repeater" },
        },
        defaultProps: {},
        render: () => null,
      },
    ] as never,
    { source: "instance-inspector-binding-test" }
  );
});

afterEach(() => clearBlocks());

const CARD: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "t",
      type: "acme/card-title",
      version: 1,
      props: { text: "Card title" },
    },
    { id: "u", type: "acme/unknown", version: 1, props: { text: "x" } },
  ],
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "t",
      propPath: "text",
      type: "text",
    },
    {
      id: "goes",
      label: "Goes to",
      nodeId: "t",
      propPath: "href",
      type: "link",
    },
    {
      id: "pic",
      label: "Picture",
      nodeId: "t",
      propPath: "picture",
      type: "image",
    },
    {
      id: "tone",
      label: "Tone",
      nodeId: "t",
      propPath: "tone",
      type: "select",
      options: [{ value: "light", label: "Light" }],
    },
    {
      id: "shown",
      label: "Shown",
      nodeId: "t",
      propPath: "text",
      type: "visibility",
    },
    // A text setting whose block this build does not know.
    {
      id: "other",
      label: "Other",
      nodeId: "u",
      propPath: "text",
      type: "text",
    },
    // A text setting on a prop no field fills.
    {
      id: "gap",
      label: "Gap",
      nodeId: "t",
      propPath: "items",
      type: "text",
    },
  ],
} as ComponentDocument;

function inspect(
  bindings?: Record<string, unknown>,
  overrides?: Record<string, unknown>,
  definitions: Record<string, ComponentDocument> = { card: CARD }
) {
  const placement = {
    id: "p",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: {
      componentId: "card",
      ...(overrides === undefined ? {} : { overrides }),
    },
    ...(bindings === undefined ? {} : { bindings }),
  } as BlockNode;
  const page = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [placement],
  } as BlockDocument;
  return inspectInstance(page, "p", new Map(Object.entries(definitions)), []);
}

describe("a placement's settings, bound to data", () => {
  it("offers a binding for a text, link or image setting, by its block's prop", () => {
    const rows = inspect()?.rows ?? [];
    expect(
      rows.map(row => [row.id, row.bindable?.type ?? null, row.bindable?.label])
    ).toEqual([
      // Named as the setting, so its controls say the setting's name.
      ["title", "text", "Title"],
      ["goes", "url", "Goes to"],
      ["pic", "media", "Picture"],
      ["tone", null, undefined],
      ["shown", null, undefined],
      ["other", null, undefined],
      ["gap", null, undefined],
    ]);
  });

  it("carries the binding the placement stores for a setting", () => {
    const byTitle = { $bind: "title", source: "item", list: "l" };
    const rows =
      inspect({
        "overrides.title": byTitle,
        "overrides.tone": byTitle,
        // Composing applies no list item binding that names no list.
        "overrides.pic": { $bind: "cover", source: "item" },
      })?.rows ?? [];
    expect(rows.find(row => row.id === "title")?.binding).toEqual(byTitle);
    expect(rows.find(row => row.id === "pic")?.binding).toBeUndefined();
    // A setting no field fills is not shown as bound, whatever is stored.
    expect(rows.find(row => row.id === "tone")?.binding).toBeUndefined();
    expect(rows.find(row => row.id === "goes")?.binding).toBeUndefined();
  });

  it("reads a stored binding that is not a record as none", () => {
    const rows = inspect({ "overrides.title": "title" })?.rows ?? [];
    expect(rows.find(row => row.id === "title")?.binding).toBeUndefined();
  });

  it("shows a bound setting as what the page shows, over another's typed value on the same prop", () => {
    const twice: ComponentDocument = {
      ...CARD,
      exposed: [
        {
          id: "a",
          label: "First",
          nodeId: "t",
          propPath: "text",
          type: "text",
        },
        {
          id: "b",
          label: "Second",
          nodeId: "t",
          propPath: "text",
          type: "text",
        },
      ],
    } as ComponentDocument;
    const bound = { $bind: "title", source: "item", list: "l" };
    const rows =
      inspect({ "overrides.a": bound }, { b: "Typed" }, { card: twice })
        ?.rows ?? [];
    const [first, second] = rows;
    // The binding fills the prop whatever is typed, so the bound row keeps
    // its controls and the typed one says what the page shows instead.
    expect(first?.binding).toEqual(bound);
    expect(first?.shadowedBy).toBeUndefined();
    expect(second?.shadowedBy).toEqual({ id: "a", label: "First" });
  });

  it("follows a setting that feeds a component inside the component to its block's prop", () => {
    const inner: ComponentDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "label",
          type: "acme/card-title",
          version: 1,
          props: { text: "Inner" },
        },
      ],
      exposed: [
        {
          id: "caption",
          label: "Caption",
          nodeId: "label",
          propPath: "text",
          type: "text",
        },
      ],
    } as ComponentDocument;
    const outer: ComponentDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "nested",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "inner" },
        },
      ],
      exposed: [
        {
          id: "headline",
          label: "Headline",
          nodeId: "nested",
          propPath: "overrides.caption",
          type: "text",
        },
      ],
    } as ComponentDocument;
    const rows = inspect(undefined, undefined, { card: outer, inner })?.rows;
    expect(rows?.[0]?.bindable).toMatchObject({
      type: "text",
      label: "Headline",
    });
  });

  it("names the nearest list on a placement's list binding, and leaves a malformed stored one alone", () => {
    const placement = {
      id: "p",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "card" },
    } as BlockNode;
    const page = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "posts",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts" },
          slots: { children: [placement] },
        },
      ],
    } as BlockDocument;
    const op = withPlacementLists(page, {
      kind: "update",
      id: "p",
      patch: {
        bindings: {
          "overrides.title": { $bind: "title", source: "item" },
          "overrides.goes": null,
        } as never,
      },
    });
    expect(op).toEqual({
      kind: "update",
      id: "p",
      patch: {
        bindings: {
          "overrides.title": { $bind: "title", source: "item", list: "posts" },
          "overrides.goes": null,
        },
      },
    });
  });

  describe("a setting that feeds a component inside the component", () => {
    const inner: ComponentDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "label",
          type: "acme/card-title",
          version: 1,
          props: { text: "Inner" },
        },
      ],
      exposed: [
        {
          id: "caption.one",
          label: "Caption",
          nodeId: "label",
          propPath: "text",
          type: "text",
        },
      ],
    } as ComponentDocument;
    const outer: ComponentDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "nested",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "inner" },
        },
      ],
      exposed: [
        {
          id: "headline",
          label: "Headline",
          nodeId: "nested",
          propPath: "overrides.caption.one",
          type: "text",
        },
        {
          id: "shown",
          label: "Shown",
          nodeId: "nested",
          propPath: "visibility",
          type: "visibility",
        },
      ],
    } as ComponentDocument;
    const bound = { $bind: "title", source: "item", list: "l" };

    it("keeps its binding's controls through a dotted id", () => {
      const rows =
        inspect({ "overrides.headline": bound }, undefined, {
          card: outer,
          inner,
        })?.rows ?? [];
      const headline = rows.find(row => row.id === "headline");
      expect(headline?.bindable).toMatchObject({ type: "text" });
      expect(headline?.binding).toEqual(bound);
    });

    it("keeps its binding's controls while the component inside is hidden", () => {
      const rows =
        inspect(
          { "overrides.headline": bound },
          { shown: false },
          { card: outer, inner }
        )?.rows ?? [];
      const headline = rows.find(row => row.id === "headline");
      expect(headline?.bindable).toMatchObject({ type: "text" });
      expect(headline?.binding).toEqual(bound);
    });
  });

  it("keeps a binding's controls on a setting whose block is hidden here", () => {
    const bound = { $bind: "title", source: "item", list: "l" };
    // The Shown setting hides the title block on this placement.
    const rows =
      inspect({ "overrides.title": bound }, { shown: false })?.rows ?? [];
    const title = rows.find(row => row.id === "title");
    expect(title?.bindable?.type).toBe("text");
    expect(title?.binding).toEqual(bound);
  });
});
