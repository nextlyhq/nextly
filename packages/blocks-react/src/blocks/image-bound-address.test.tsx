/**
 * An image bound through a relation to an address field: a post's author's
 * avatar, kept as a URL rather than in the media library.
 *
 * A URL field says its value is an address, but a value stored before the
 * field was one, or written past its check, can be anything: a bare filename
 * left by an import is the common case. Such a value names no address a page
 * can load (it would resolve against whichever page draws it), so the image
 * shows the binding's fallback, or nothing, and never an `<img>` pointing at
 * the filename.
 *
 * Every fixture keeps the stored value, the fallback and the address typed on
 * the block distinct, so an assertion can only pass on the one that should
 * show.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext, type PageBindings } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";

const POSTS: readonly BindingFieldShape[] = [
  { name: "title", type: "text" },
  { name: "author", type: "relationship", relationTo: "authors" },
];

const AUTHORS: readonly BindingFieldShape[] = [
  { name: "name", type: "text" },
  { name: "avatarUrl", type: "url" },
];

const OWN = "https://cdn.example/own-avatar.png";
const FALLBACK = "/media/default-avatar.png";

/** The author's avatar: the image's address bound to `author.avatarUrl`. */
function avatar(fallback?: string, own?: string): BlockNode {
  return {
    id: "avatar",
    type: "core/image",
    version: 1,
    props: { alt: "The author", ...(own === undefined ? {} : { src: own }) },
    bindings: {
      mediaId: {
        $bind: "author.avatarUrl",
        ...(fallback === undefined ? {} : { fallback }),
      },
    },
  };
}

async function render(node: BlockNode, avatarUrl: unknown): Promise<string> {
  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "template",
    nodes: [node],
  };
  const bindings: PageBindings = {
    entry: {
      title: "A post",
      author: { id: "a1", name: "Jane Smith", avatarUrl },
    },
    entryRef: { collection: "posts" },
    fieldShapes: {
      fieldsOf: ref =>
        "collection" in ref
          ? ref.collection === "posts"
            ? POSTS
            : ref.collection === "authors"
              ? AUTHORS
              : undefined
          : undefined,
    },
  };
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      siteStyles={false}
      bindings={bindings}
      context={createStandaloneContext({})}
    />,
    {
      onError(error) {
        throw error;
      },
    }
  );
  await stream.allReady;
  return await new Response(stream).text();
}

/** The address of every `<img>` the page drew. */
function sources(html: string): string[] {
  return [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map(m => m[1]!);
}

describe("an avatar bound to the author's address", () => {
  it("draws a full address as it is", async () => {
    expect(
      sources(await render(avatar(FALLBACK), "https://cdn.example/jane.svg"))
    ).toEqual(["https://cdn.example/jane.svg"]);
  });

  it("draws a path on the site as it is", async () => {
    expect(sources(await render(avatar(FALLBACK), "/media/jane.svg"))).toEqual([
      "/media/jane.svg",
    ]);
  });

  it("draws the fallback for a bare filename, never the filename", async () => {
    const html = await render(avatar(FALLBACK, OWN), "author-jane.svg");
    expect(sources(html)).toEqual([FALLBACK]);
    expect(html).not.toContain("author-jane.svg");
  });

  it("draws no image for a bare filename when the binding has no fallback, not even the address typed beside it", async () => {
    // A bound prop shows its own value when the binding gives nothing, and an
    // image's own value is its picked media, never the address typed beside
    // it, which the binding replaced.
    const html = await render(avatar(undefined, OWN), "author-jane.svg");
    expect(sources(html)).toEqual([]);
    expect(html).not.toContain("author-jane.svg");
    expect(html).not.toContain(OWN);
  });
});
