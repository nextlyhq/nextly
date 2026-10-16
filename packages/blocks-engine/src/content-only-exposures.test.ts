/**
 * Which of a component's exposed fields reach past a `contentOnly` lock.
 *
 * A component can expose a field of a node that sits inside a slot locked
 * `contentOnly`. A placement's value for it is written into that node, so an
 * exposure of anything but content offers every placement a change the lock
 * refuses. This finds those exposures, so the component's save can say so.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { contentOnlyExposures } from "./content-only-exposures";
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockNode,
  type ComponentDocument,
  type ExposedProperty,
} from "./document";
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

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
      },
      { ...base, name: "acme/box", slots: { children: {} } },
      {
        ...base,
        name: "acme/sealed",
        slots: {
          body: { defaultBlock: [{ type: "acme/box" }], lock: "contentOnly" },
        },
      },
      {
        ...base,
        name: "acme/fixed",
        slots: {
          body: { defaultBlock: [{ type: "acme/headline" }], lock: "all" },
        },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

const headline = (id: string): BlockNode => ({
  id,
  type: "acme/headline",
  version: 1,
  props: {},
});

/** A sealed block holding a box (inheriting the lock) holding a headline. */
const sealed = (): BlockNode => ({
  id: "s1",
  type: "acme/sealed",
  version: 1,
  props: {},
  slots: {
    body: [
      {
        id: "b1",
        type: "acme/box",
        version: 1,
        props: {},
        slots: { children: [headline("h1")] },
      },
    ],
  },
});

const exposing = (
  nodes: BlockNode[],
  exposed: Partial<ExposedProperty>[]
): ComponentDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes,
    exposed: exposed.map((entry, index) => ({
      id: `e${index}`,
      label: `Field ${index}`,
      type: "text",
      ...entry,
    })),
  }) as ComponentDocument;

function found(doc: ComponentDocument) {
  return contentOnlyExposures(doc, {
    definitions: registryBlockSource(),
    nesting: registryNestingSource(),
  });
}

describe("contentOnlyExposures", () => {
  it("finds an exposure of a prop that is not content, inside a contentOnly area at any depth", () => {
    const doc = exposing(
      [sealed()],
      [{ nodeId: "h1", propPath: "align", type: "select" }]
    );
    expect(found(doc)).toEqual([
      expect.objectContaining({
        exposureId: "e0",
        nodeId: "h1",
        propPath: "align",
        slot: "body",
        holderType: "acme/sealed",
      }),
    ]);
  });

  it("leaves an exposure of content alone there", () => {
    const doc = exposing([sealed()], [{ nodeId: "h1", propPath: "text" }]);
    expect(found(doc)).toEqual([]);
  });

  it("leaves an exposure outside any contentOnly area alone, under another lock or none", () => {
    const fixed: BlockNode = {
      id: "f1",
      type: "acme/fixed",
      version: 1,
      props: {},
      slots: { body: [headline("h2")] },
    };
    const doc = exposing(
      [fixed, headline("h3")],
      [
        { nodeId: "h2", propPath: "align", type: "select" },
        { nodeId: "h3", propPath: "align", type: "select" },
      ]
    );
    expect(found(doc)).toEqual([]);
  });

  it("leaves an exposure alone beneath a slot its block does not declare", () => {
    // Children stored under an undeclared slot are not drawn, so no lock
    // reaches them, as validation reads it.
    const stray = sealed();
    const box = stray.slots!.body![0]!;
    box.slots = { ...box.slots, stray: [headline("h9")] };
    const doc = exposing(
      [stray],
      [{ nodeId: "h9", propPath: "align", type: "select" }]
    );
    expect(found(doc)).toEqual([]);
  });

  it("finds an exposure of a nested value of a prop that is not content", () => {
    const doc = exposing(
      [sealed()],
      [{ nodeId: "h1", propPath: "align.desktop" }]
    );
    expect(found(doc).map(entry => entry.exposureId)).toEqual(["e0"]);
  });
});
