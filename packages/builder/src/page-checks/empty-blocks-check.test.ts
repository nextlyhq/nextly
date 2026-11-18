/**
 * Blocks left empty: an Image with no picture, a Button with no link, and a
 * Collection list with no source, each found only where nothing supplies the
 * missing part (a stored value or a field it is bound to), and each opening
 * the setting that fixes it. Called over stored documents with no DOM.
 */
import type {
  AnyBlockDefinition,
  Binding,
  BlockDocument,
  BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { EMPTY_BLOCKS_CHECK } from "./empty-blocks-check";
import { runPageChecks } from "./page-checks";

/** A block declaring an image's props as `core/image` declares them. */
const PICTURE = {
  name: "acme/picture",
  version: 1,
  editor: { label: "Picture" },
  props: {
    mediaId: { label: "Image", role: "content", type: "media" },
    src: { label: "Image address", role: "content", type: "url" },
    alt: { label: "Alt text", role: "content", type: "text" },
    decorative: { label: "Decorative, no alt text", type: "checkbox" },
  },
  render: () => null,
} as unknown as AnyBlockDefinition;

const BLOCKS = new Map([[PICTURE.name, PICTURE]]);

function node(
  id: string,
  type: string,
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props, ...extra };
}

function foundOn(nodes: BlockNode[]) {
  const document: BlockDocument = { formatVersion: 1, kind: "page", nodes };
  return runPageChecks({ document, blocks: type => BLOCKS.get(type) }, [
    EMPTY_BLOCKS_CHECK,
  ]).findings.map(({ nodeId, what, fix }) => ({ nodeId, what, fix }));
}

const FIELD: Binding = { $bind: "cover" };

describe("an Image with no picture", () => {
  it("is found where it has neither a library file nor an address", () => {
    expect(
      foundOn([node("i1", "acme/picture", { mediaId: "", src: " " })])
    ).toEqual([
      {
        nodeId: "i1",
        what: "Image has no picture",
        fix: { tab: "content", id: "mediaId" },
      },
    ]);
  });

  it("is not found with a file, an address, or a field supplying either", () => {
    expect(
      foundOn([
        node("i1", "acme/picture", { mediaId: "m-1" }),
        node("i2", "acme/picture", { src: "/harbour.jpg" }),
        node("i3", "acme/picture", {}, { bindings: { mediaId: FIELD } }),
        node("i4", "acme/picture", {}, { bindings: { src: FIELD } }),
      ])
    ).toEqual([]);
  });
});

describe("a Button with no link", () => {
  it("is found with no address and no entry, opening the link setting", () => {
    expect(
      foundOn([node("b1", "core/button", { label: "Go", href: "" })])
    ).toEqual([
      {
        nodeId: "b1",
        what: "Button has no link",
        fix: { tab: "content", id: "href" },
      },
    ]);
  });

  it("is not found with an address, an entry, a bound link, or a form job", () => {
    expect(
      foundOn([
        node("b1", "core/button", { href: "/signup" }),
        node("b2", "core/button", { entryCollection: "posts", entryId: "p-1" }),
        node("b3", "core/button", {}, { bindings: { href: FIELD } }),
        node("b4", "core/button", { type: "submit" }),
        node("b5", "core/button", { type: "reset" }),
      ])
    ).toEqual([]);
  });

  it("is found with an address the page would never link to", () => {
    expect(
      foundOn([
        node("b1", "core/button", { href: "javascript:alert(1)" }),
        node("b2", "core/button", { href: "blob:https://example.com/1" }),
      ]).map(each => each.nodeId)
    ).toEqual(["b1", "b2"]);
  });

  it("is found with an entry's collection but no entry", () => {
    expect(
      foundOn([node("b1", "core/button", { entryCollection: "posts" })])
    ).toHaveLength(1);
  });
});

describe("a Collection list with no source", () => {
  it("is found naming no collection, related entries or custom source", () => {
    expect(
      foundOn([
        node("l1", "core/collection-loop", { collection: "  ", limit: 3 }),
      ])
    ).toEqual([
      {
        nodeId: "l1",
        what: "Collection list has no source",
        fix: { tab: "content", id: "collection" },
      },
    ]);
  });

  it("is not found with a collection, related entries or a custom source", () => {
    expect(
      foundOn([
        node("l1", "core/collection-loop", { collection: "posts" }),
        node("l2", "core/collection-loop", {
          collection: "tags",
          relation: { of: "entry", field: "tags" },
        }),
        node("l3", "core/collection-loop", {
          namedQuery: { name: "latest", params: {} },
        }),
      ])
    ).toEqual([]);
  });
});

it("finds empty blocks inside other blocks, in page order", () => {
  const box = node(
    "box",
    "core/section",
    {},
    {
      slots: {
        children: [
          node("b1", "core/button", {}),
          node("i1", "acme/picture", {}),
        ],
      },
    }
  );
  expect(foundOn([box]).map(each => each.nodeId)).toEqual(["b1", "i1"]);
});
