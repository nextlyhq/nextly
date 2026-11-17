/**
 * An Image with no picture: nothing on a page a visitor is served, and on the
 * editor's canvas a box the editor draws its choices over.
 *
 * - A new Image stores no address: it is placed with its defaults and its
 *   example, and neither names a file.
 * - With nothing chosen, the published page draws nothing where it sits, and
 *   the canvas (`diagnostics`) draws an empty box, 16:9 until the block sets
 *   its own proportion.
 * - A library file the library no longer has draws nothing on the published
 *   page too, and the canvas's box says the file is missing.
 * - A bound Image is left to its binding, which has a Fallback of its own.
 *
 * @module blocks/image.empty.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext, type ResolvedMedia } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { sharedStyleInputsId } from "../shared-style-inputs";
import { compileContextFor, drawlessTestFor } from "../styles-block-inputs";

import { coreBlocks } from "./index";
import { image, renderImage } from "./image";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

const resolver = createBlockResolver(coreBlocks);

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

/** One library file, and nothing for any other id. */
const LIBRARY: Readonly<Record<string, ResolvedMedia>> = {
  kept: { url: "https://cdn.example/kept.jpg", width: 800, height: 600 },
};

function imageNode(
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id: "picture", type: "core/image", version: 1, props, ...extra };
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** The page as a visitor is served it, or as the canvas draws it. */
async function draw(
  document: BlockDocument,
  where: "published" | "canvas"
): Promise<string> {
  return await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      styleContext={{ breakpoints: BREAKPOINTS }}
      {...(where === "canvas" ? { nodeAttribute: true } : {})}
      context={createStandaloneContext({
        resolveMedia: id => Promise.resolve(LIBRARY[id] ?? null),
        ...(where === "canvas" ? { diagnostics: true } : {}),
      })}
    />
  );
}

/** The props a new Image is placed with: its defaults, then its example. */
const PLACED: Record<string, unknown> = {
  ...image.defaultProps,
  ...image.example?.props,
};

describe("a new core/image", () => {
  it("is placed with no file address and no library file", () => {
    expect(PLACED).not.toHaveProperty("src");
    expect(PLACED).not.toHaveProperty("mediaId");
  });

  it("draws an empty box on the canvas, in the block's own classes", async () => {
    const drawn = (await renderImage({
      props: PLACED,
      className: "nx-pb-node1 nx-bt-core--image",
      partClass: (part: string) => `nx-bp-core--image__${part}`,
      ctx: createStandaloneContext({ diagnostics: true }),
    } as never)) as ReactElement<Record<string, unknown>> | null;
    expect(drawn?.type).toBe("div");
    expect(drawn?.props["data-nx-image-empty"]).toBe("empty");
    expect(drawn?.props.className).toBe(
      "nx-pb-node1 nx-bt-core--image nx-bp-core--image__empty"
    );
  });
});

describe("core/image with no picture, on the published path", () => {
  it("draws nothing where an Image with nothing chosen sits", async () => {
    const html = await draw(page(imageNode(PLACED)), "published");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-nx-image-empty");
  });

  it("draws nothing for a library file the library no longer has", async () => {
    const html = await draw(
      page(imageNode({ mediaId: "deleted" })),
      "published"
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-nx-image-empty");
  });

  it("still draws a library file the library has", async () => {
    // The positive control: the same path draws a picture that is there.
    const html = await draw(page(imageNode({ mediaId: "kept" })), "published");
    expect(html).toContain('src="https://cdn.example/kept.jpg"');
  });
});

describe("core/image with no picture, on the canvas", () => {
  it("draws the empty box, addressed as the node", async () => {
    const html = await draw(page(imageNode(PLACED)), "canvas");
    expect(html).not.toContain("<img");
    expect(html).toMatch(/<div[^>]*data-nx-node="picture"[^>]*>/);
    expect(html).toMatch(/data-nx-image-empty="empty"/);
  });

  it("says a library file the library no longer has is missing", async () => {
    const html = await draw(page(imageNode({ mediaId: "deleted" })), "canvas");
    expect(html).not.toContain("<img");
    expect(html).toMatch(/data-nx-image-empty="missing"/);
  });

  it("draws the picture, not the box, once the file is there", async () => {
    const html = await draw(page(imageNode({ mediaId: "kept" })), "canvas");
    expect(html).toContain('src="https://cdn.example/kept.jpg"');
    expect(html).not.toContain("data-nx-image-empty");
  });

  it("leaves a bound Image to its binding", async () => {
    // No entry to read: the binding draws nothing, and its Fallback, not
    // this box, is what an author sets for that.
    const html = await draw(
      page(imageNode({}, { bindings: { mediaId: { $bind: "entry.cover" } } })),
      "canvas"
    );
    expect(html).not.toContain("data-nx-image-empty");
  });
});

/** Every rule of the page's sheet, as selector and body, in order. */
function rulesIn(html: string): { selector: string; body: string }[] {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map(match => match[1] ?? "")
    .join("\n");
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(match => ({
    selector: (match[1] ?? "").trim(),
    body: (match[2] ?? "").trim(),
  }));
}

describe("the empty box's size", () => {
  it("is 16:9 and as wide as its column by default, at no weight", async () => {
    const html = await draw(page(imageNode(PLACED)), "canvas");
    const rule = rulesIn(html).find(({ selector }) =>
      selector.includes("nx-bp-core--image--empty")
    );
    expect(rule?.body).toMatch(/aspect-ratio:\s*16 \/ 9/);
    expect(rule?.body).toMatch(/width:\s*100%/);
    // Inside `:where()`, so a proportion or a width set on the block itself
    // outweighs it.
    expect(rule?.selector).toMatch(/:where\([^)]*nx-bp-core--image--empty/);
  });

  it("takes the proportion the block sets, on the box itself", async () => {
    const html = await draw(
      page(
        imageNode(PLACED, {
          styles: { base: { base: { aspectRatio: "1 / 1" } } },
        })
      ),
      "canvas"
    );
    const box = /<div class="([^"]*)" data-nx-image-empty/.exec(html)?.[1];
    const own = box?.split(" ").find(name => name.startsWith("nx-pb-"));
    const rule = rulesIn(html).find(({ body }) =>
      /aspect-ratio:\s*1 \/ 1/.test(body)
    );
    expect(own).toBeDefined();
    // The node's own rule, outside any `:where()`, on a class the box wears.
    expect(rule?.selector).toContain(`.${own}`);
    expect(rule?.selector.startsWith(":where(")).toBe(false);
  });
});

describe("a sheet stored before an empty Image drew its box", () => {
  /**
   * The Image as it was: no `empty` part, and a declaration that a picture
   * with no source draws nothing, so its own rules were held back.
   */
  const { empty: _box, ...partsBefore } = image.parts ?? {};
  const before = createBlockResolver(
    coreBlocks.map(block =>
      block.name === "core/image"
        ? {
            ...block,
            parts: partsBefore,
            rendersNothing: (props: Record<string, unknown>) =>
              props.mediaId === undefined && props.src === undefined,
          }
        : block
    ) as never
  );

  function stampOf(
    document: BlockDocument,
    blocks: typeof resolver
  ): string | undefined {
    return sharedStyleInputsId(
      compileContextFor(
        { breakpoints: BREAKPOINTS },
        document,
        blocks,
        drawlessTestFor(blocks),
        undefined
      ) as never
    );
  }

  it("no longer matches the stamp of a page holding an Image, so it is compiled again", () => {
    // No new encoding is needed: the Image's parts are among the inputs a
    // stored sheet is stamped with, and the box's part moves the stamp of
    // every page that holds an Image, filled or empty.
    for (const props of [PLACED, { mediaId: "kept" }]) {
      const document = page(imageNode(props));
      expect(stampOf(document, resolver)).toBeDefined();
      expect(stampOf(document, resolver)).not.toBe(stampOf(document, before));
    }
  });

  it("is still the sheet of a page holding no Image", () => {
    const document = page({
      id: "words",
      type: "core/text",
      version: 1,
      props: { text: "Words" },
    });
    expect(stampOf(document, resolver)).toBe(stampOf(document, before));
  });
});
