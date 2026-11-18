/**
 * The starter accessibility check: an image a visitor sees, with no alt text
 * and not marked decorative. Called over stored documents with no DOM.
 *
 * Only what the page itself decides is judged. An image whose picture comes
 * from the media library takes the library's alt text when the page stores
 * none, and a bound alt text is read from an entry, so neither is flagged
 * here; an image with no picture yet draws nothing to describe.
 */
import type {
  AnyBlockDefinition,
  BlockDocument,
  BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { IMAGE_ALT_CHECK } from "./image-alt-check";
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

/** A block with an address but no alt text of its own to judge. */
const FRAME = {
  name: "acme/frame",
  version: 1,
  editor: { label: "Frame" },
  props: { src: { label: "Address", type: "url" } },
  render: () => null,
} as unknown as AnyBlockDefinition;

const BLOCKS = new Map([
  [PICTURE.name, PICTURE],
  [FRAME.name, FRAME],
]);

function picture(
  id: string,
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type: "acme/picture", version: 1, props, ...extra };
}

function findingsOn(nodes: BlockNode[]) {
  const document: BlockDocument = { formatVersion: 1, kind: "page", nodes };
  return runPageChecks({ document, blocks: type => BLOCKS.get(type) }, [
    IMAGE_ALT_CHECK,
  ]).findings;
}

describe("an image with no alt text", () => {
  it("is listed under Accessibility, with its fix in the Content tab's Alt text", () => {
    const [finding, ...rest] = findingsOn([
      picture("img", { src: "https://example.com/team.jpg" }),
    ]);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      group: "accessibility",
      nodeId: "img",
      block: "Picture",
      fix: { tab: "content", id: "alt" },
    });
  });

  it("says what is wrong, why it matters and what to do, in plain words", () => {
    const [finding] = findingsOn([picture("img", { src: "/team.jpg" })]);
    expect(finding?.what).toBe("Image has no alt text");
    expect(finding?.why).toBe(
      "Screen readers can’t describe the picture to people who can’t see it."
    );
    expect(finding?.todo).toBe(
      "Describe the picture in Alt text, or tick “Decorative, no alt text” if it only decorates."
    );
  });

  it("is found inside other blocks too, in page order", () => {
    const findings = findingsOn([
      {
        id: "section",
        type: "acme/frame",
        version: 1,
        props: {},
        slots: { children: [picture("inner", { src: "/a.jpg" })] },
      },
      picture("after", { src: "/b.jpg" }),
    ]);
    expect(findings.map(each => each.nodeId)).toEqual(["inner", "after"]);
  });
});

describe("an image the check leaves alone", () => {
  it.each([
    ["has alt text of its own", { src: "/a.jpg", alt: "The team at launch" }],
    // An empty alt is the block's own way to say "decorative".
    ["stores an empty alt", { src: "/a.jpg", alt: "" }],
    ["is marked decorative", { src: "/a.jpg", decorative: true }],
    // The library's alt text applies while the page stores none, also with
    // an address kept as the file's fallback.
    [
      "takes its picture from the media library",
      { mediaId: "m-1", src: "/fallback.jpg" },
    ],
    ["has no picture yet", {}],
  ])("%s", (_case, props) => {
    expect(findingsOn([picture("img", props)])).toEqual([]);
  });

  it("is listed again once its alt text is cleared", () => {
    expect(findingsOn([picture("img", { src: "/a.jpg", alt: "A" })])).toEqual(
      []
    );
    expect(findingsOn([picture("img", { src: "/a.jpg" })])).toHaveLength(1);
  });

  it("has its alt text bound to a field, read from the entry", () => {
    expect(
      findingsOn([
        picture(
          "img",
          { src: "/a.jpg" },
          { bindings: { alt: { source: "entry", path: "title" } as never } }
        ),
      ])
    ).toEqual([]);
  });

  it("has its picture bound to a field", () => {
    expect(
      findingsOn([
        picture(
          "img",
          { src: "/fallback.jpg" },
          { bindings: { mediaId: { source: "entry", path: "cover" } as never } }
        ),
      ])
    ).toEqual([]);
  });

  it("is a block with no alt text to give", () => {
    expect(
      findingsOn([
        { id: "f", type: "acme/frame", version: 1, props: { src: "/a" } },
      ])
    ).toEqual([]);
  });

  it("is a block the page's blocks don't know", () => {
    expect(
      findingsOn([{ id: "x", type: "acme/gone", version: 1, props: {} }])
    ).toEqual([]);
  });
});
