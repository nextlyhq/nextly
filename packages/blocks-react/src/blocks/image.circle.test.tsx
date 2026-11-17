// @vitest-environment jsdom
/**
 * Circle on a 16:9 picture, as a visitor's page draws it: the rules that
 * reach the `<img>` crop it to a square (a 1 / 1 proportion, the picture
 * covering it) and round it, in every branch the picture renders, while the
 * file's own 1600 × 900 size stays on the element to reserve its space. The
 * browser test `builder-image-when-clicked.spec.ts` measures the drawn box.
 *
 * @module blocks/image.circle.test
 */
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  blockLooks,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import { PageRenderer } from "../page-renderer";
import type { BlockResolver } from "../resolver";

import { coreBlocks } from "./index";

const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};
const circle = blockLooks(coreBlocks).find(
  look => look.id === "look:core/image:circle"
) as NamedClass;

/** The published page of one Circle Image of a 16:9 library file. */
async function page(props: Record<string, unknown>): Promise<Document> {
  const document = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/image",
        version: 1,
        props: { mediaId: "m1", ...props },
        classes: [circle.id],
      },
    ],
  } as unknown as BlockDocument;
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={resolver}
      context={
        {
          resolveMedia: async () => ({
            url: "https://example.test/wide.png",
            width: 1600,
            height: 900,
            alt: "A wide view",
          }),
          resolveEntryPath: async () => "/about",
        } as never
      }
      // As a published route hands the site's styles over.
      siteStyles={{
        breakpoints: {
          viewport: [{ id: "base", label: "Desktop" }],
          container: [],
        },
        classes: [circle],
      }}
    />
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  return new DOMParser().parseFromString(html, "text/html");
}

/** The declarations of every rule matching `element`, in sheet order. */
function declarationsOn(doc: Document, element: Element): Map<string, string> {
  const css = [...doc.querySelectorAll("style")]
    .map(style => style.textContent ?? "")
    .join("\n");
  const found = new Map<string, string>();
  for (const match of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    let matches = false;
    try {
      matches = element.matches(selector);
    } catch {
      matches = false;
    }
    if (!matches) continue;
    for (const declaration of (match[2] ?? "").split(";")) {
      const [property, ...value] = declaration.split(":");
      if (property === undefined || value.length === 0) continue;
      found.set(property.trim(), value.join(":").trim());
    }
  }
  return found;
}

describe("Circle on a 16:9 picture, on the published path", () => {
  for (const [name, props] of [
    ["on its own", {}],
    ["captioned", { caption: "Our team" }],
    ["linked", { href: "/about" }],
    ["captioned and linked", { caption: "Our team", href: "/about" }],
  ] as const) {
    it(`is cropped to a round square when ${name}`, async () => {
      const doc = await page(props);
      const picture = doc.querySelector(".nx-pb-page img");
      if (picture === null) throw new Error("no picture drawn");
      // The file is 16:9, and says so, so the space is reserved before it loads.
      expect(picture.getAttribute("width")).toBe("1600");
      expect(picture.getAttribute("height")).toBe("900");
      const declared = declarationsOn(doc, picture);
      // The proportion the box takes is square, whatever the file's, and the
      // picture covers it rather than being squeezed into it.
      expect(declared.get("aspect-ratio")).toBe("1 / 1");
      expect(declared.get("object-fit")).toBe("cover");
      expect(declared.get("border-radius")).toBe("9999px");
      // Nothing sets a height that would stretch the square: its own, or, in
      // a link, the link's, which has none of its own and so is the square's.
      expect(["auto", "100%"]).toContain(declared.get("height") ?? "auto");
    });
  }
});
