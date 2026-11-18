// @vitest-environment jsdom
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  embedLinkOp,
  emptyEmbedBoxes,
  linkNote,
} from "./embed-states-model";

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

function embedNode(
  props: Record<string, unknown> = {},
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id: "e1", type: "core/embed", version: 1, props, ...extra };
}

/** What a link's write stores: its props and its base style values. */
function written(document: BlockDocument, link: string) {
  const op = embedLinkOp(document, "e1", link);
  if (op === null || op.kind !== "update") throw new Error("no write");
  return {
    props: op.patch.props,
    base: op.patch.styles?.base?.base,
    hasStyles: op.patch.styles !== undefined,
  };
}

describe("linkNote", () => {
  it.each([
    ["https://youtu.be/dQw4w9WgXcQ", "YouTube detected. Size set from the video."],
    ["https://vimeo.com/76979871", "Vimeo detected. Size set from the video."],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "Spotify detected. Size set from the player."],
    ["https://www.google.com/maps/embed?pb=!1m18", "Google Maps detected. Size set from the map."],
    ["https://example.com/page", "Shown as a plain frame"],
  ])("says what %s is", (link, words) => {
    expect(linkNote(link)).toBe(words);
  });

  it("says nothing with no link", () => {
    expect(linkNote("")).toBeUndefined();
    expect(linkNote("   ")).toBeUndefined();
    expect(linkNote(undefined)).toBeUndefined();
  });
});

describe("embedLinkOp", () => {
  it("stores the link as pasted, with the provider's proportion as a style value", () => {
    const { props, base } = written(
      page(embedNode({ title: "", load: "click" })),
      " https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10 "
    );
    expect(props).toEqual({
      title: "",
      load: "click",
      src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
    });
    expect(base).toEqual({ aspectRatio: "16 / 9" });
  });

  it("gives a Short the portrait proportion, keeping the block's other values", () => {
    const { base } = written(
      page(embedNode({}, { styles: { base: { base: { marginTop: "1rem", height: "152px" } } } })),
      "https://www.youtube.com/shorts/aqz-KE-bpKQ"
    );
    // The height a player link set before goes, so the proportion holds.
    expect(base).toEqual({ marginTop: "1rem", aspectRatio: "9 / 16" });
  });

  it("gives a Spotify player its height, with no proportion", () => {
    const { base } = written(
      page(embedNode({}, { styles: { base: { base: { aspectRatio: "16 / 9" } } } })),
      "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3"
    );
    expect(base).toEqual({ aspectRatio: "auto", height: "352px" });
  });

  it("stores a link nobody owns and leaves the block's shape alone", () => {
    const { props, hasStyles } = written(page(embedNode()), "https://example.com/page");
    expect(props).toEqual({ src: "https://example.com/page" });
    expect(hasStyles).toBe(false);
  });

  it("writes nothing for no link, the same link, or no Embed", () => {
    const document = page(embedNode({ src: "https://youtu.be/dQw4w9WgXcQ" }));
    expect(embedLinkOp(document, "e1", "  ")).toBeNull();
    expect(embedLinkOp(document, "e1", "https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(embedLinkOp(document, "missing", "https://youtu.be/x")).toBeNull();
    const notEmbed = page({ id: "e1", type: "core/image", version: 1, props: {} });
    expect(embedLinkOp(notEmbed, "e1", "https://youtu.be/dQw4w9WgXcQ")).toBeNull();
  });
});

describe("emptyEmbedBoxes", () => {
  it("finds the boxes of this document's Embeds, not a placed component's", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      '<div data-nx-node="e1" data-nx-embed-empty=""></div>',
      '<div data-nx-node="e2" data-nx-embed-empty="" data-nx-instance="c1"></div>',
      '<div data-nx-node="other" data-nx-embed-empty=""></div>',
    ].join("");
    const boxes = emptyEmbedBoxes(
      root,
      page(embedNode(), { ...embedNode(), id: "e2" })
    );
    expect(boxes.map(box => box.nodeId)).toEqual(["e1"]);
  });
});
