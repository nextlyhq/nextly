/**
 * An Image block on a published page offers copies sized to where it sits,
 * and the page's first block's images load first.
 *
 * Rendered through the page renderer with the context a route builds, so the
 * slot each device draws comes from the site's breakpoints and the copies
 * from a stub of the site's media, which records every width asked for.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { imageSizingFor, type ImageCopy } from "../image-slot";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { coreBlocks } from "./index";

const BREAKPOINTS = {
  viewport: [
    { id: "base", label: "Desktop" },
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

/** The widths a site keeps copies at, as core media does. */
const KEPT = [96, 160, 240, 320, 640, 960, 1280, 1920];

const image = (id: string, props: Record<string, unknown>): BlockNode => ({
  id,
  type: "core/image",
  version: 1,
  props: { alt: "A view", ...props },
});

const box = (
  id: string,
  children: BlockNode[],
  type = "core/box"
): BlockNode => ({
  id,
  type,
  version: 1,
  props: { as: "div" },
  slots: { children },
});

async function render(
  nodes: BlockNode[],
  options: { copies?: boolean } = {}
): Promise<{ html: string; asked: { source: unknown; upTo: number }[] }> {
  const asked: { source: unknown; upTo: number }[] = [];
  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  };
  const context = {
    ...createStandaloneContext({
      resolveMedia: async (id: string) =>
        id === "photo"
          ? { url: "/media/photo.jpg", width: 3000, height: 2000, alt: "" }
          : null,
    }),
    ...imageSizingFor(
      options.copies === false
        ? undefined
        : async (source, upTo): Promise<readonly ImageCopy[]> => {
            asked.push({ source, upTo });
            // Only this site's own media has copies; an address on another
            // host is drawn as it is.
            if (!("id" in source)) return [];
            return KEPT.filter(width => width <= upTo).map(width => ({
              url: `/media/photo-${width}.webp`,
              width,
            }));
          },
      BREAKPOINTS,
      nodes
    ),
  };
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      siteStyles={false}
      context={context}
    />,
    {
      onError(error) {
        throw error;
      },
    }
  );
  await stream.allReady;
  return { html: await new Response(stream).text(), asked };
}

/** The attributes of the one `<img>` the page draws. */
function imgOf(html: string): Record<string, string> {
  const tag = /<img\b[^>]*>/.exec(html)?.[0] ?? "";
  return Object.fromEntries(
    // Attribute names are case-insensitive in HTML, and React writes some in
    // camel case (`srcSet`, `fetchPriority`).
    [...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, name, value]) => [
      name.toLowerCase(),
      value.replaceAll("&amp;", "&"),
    ])
  );
}

describe("an Image block's sources", () => {
  it("offer copies sized to the slot on every device, never wider than twice it", async () => {
    // Half of a two-column row: 960px on a desktop, 512 on a tablet, 320 on a phone.
    const { html, asked } = await render([
      box("intro", []),
      box(
        "row",
        [
          box("a", [image("pic", { mediaId: "photo" })], "core/column"),
          box("b", [], "core/column"),
        ],
        "core/columns"
      ),
    ]);
    const img = imgOf(html);
    expect(img.sizes).toBe(
      "(max-width: 640px) 320px, (max-width: 1024px) 512px, 960px"
    );
    expect(asked).toEqual([{ source: { id: "photo" }, upTo: 1920 }]);
    const widths = (img.srcset ?? "")
      .split(", ")
      .map(candidate => Number(candidate.split(" ")[1]?.replace("w", "")));
    expect(widths).toEqual([96, 160, 240, 320, 640, 960, 1280, 1920]);
    expect(Math.max(...widths)).toBeLessThanOrEqual(2 * 960);
    // The fallback `src` is the widest copy, not the 3000px original.
    expect(img.src).toBe("/media/photo-1920.webp");
    // Below the first block, so it waits until it is near.
    expect(img.loading).toBe("lazy");
    expect(img.fetchpriority).toBeUndefined();
  });

  it("is drawn from its original where no copy can be had", async () => {
    const external = "https://images.example/view.jpg";
    const { html } = await render([
      box("intro", []),
      image("pic", { src: external }),
    ]);
    const img = imgOf(html);
    expect(img.src).toBe(external);
    expect(img.srcset).toBeUndefined();
    expect(img.sizes).toBeUndefined();
  });

  it("is drawn as always where the site offers no copies", async () => {
    const { html, asked } = await render(
      [box("intro", []), image("pic", { mediaId: "photo" })],
      { copies: false }
    );
    const img = imgOf(html);
    expect(img.src).toBe("/media/photo.jpg");
    expect(img.srcset).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("loads first inside the page's first block", async () => {
    const { html } = await render([
      box("hero", [image("pic", { mediaId: "photo" })]),
    ]);
    const img = imgOf(html);
    expect(img.loading).toBe("eager");
    expect(img.fetchpriority).toBe("high");
  });
});
