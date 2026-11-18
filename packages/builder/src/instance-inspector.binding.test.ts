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

import { inspectInstance } from "./instance-inspector";

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

function inspect(bindings?: Record<string, unknown>) {
  const placement = {
    id: "p",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "card" },
    ...(bindings === undefined ? {} : { bindings }),
  } as BlockNode;
  const page = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [placement],
  } as BlockDocument;
  return inspectInstance(page, "p", new Map([["card", CARD]]), []);
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
    const byTitle = { $bind: "title", source: "item" };
    const rows =
      inspect({ "overrides.title": byTitle, "overrides.tone": byTitle })
        ?.rows ?? [];
    expect(rows.find(row => row.id === "title")?.binding).toEqual(byTitle);
    // A setting no field fills is not shown as bound, whatever is stored.
    expect(rows.find(row => row.id === "tone")?.binding).toBeUndefined();
    expect(rows.find(row => row.id === "goes")?.binding).toBeUndefined();
  });

  it("reads a stored binding that is not a record as none", () => {
    const rows = inspect({ "overrides.title": "title" })?.rows ?? [];
    expect(rows.find(row => row.id === "title")?.binding).toBeUndefined();
  });
});
