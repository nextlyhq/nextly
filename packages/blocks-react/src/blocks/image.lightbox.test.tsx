// @vitest-environment jsdom
/**
 * An Image set to Enlarge, as a published page draws it: the picture is a
 * button that opens the full-size picture over the page in the browser's own
 * popover, with a Close button and the caption, and no script.
 *
 * Drawn through the page renderer with the context a route builds, with the
 * site's copies offered, so the page's picture is a sized copy and the
 * popover's is the original: the full-size file, which only the opened
 * popover fetches.
 *
 * @module blocks/image.lightbox.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { render } from "@testing-library/react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { imageSizingFor, type ImageCopy } from "../image-slot";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { renderImage } from "./image";
import { cssUrl } from "./lightbox";
import { coreBlocks } from "./index";

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

const image = (id: string, props: Record<string, unknown>): BlockNode => ({
  id,
  type: "core/image",
  version: 1,
  props: { mediaId: "photo", alt: "The team on the hill", ...props },
});

/** The page's markup, parsed, for the nodes given. */
async function page(nodes: BlockNode[]): Promise<Document> {
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
          : id === "quoted"
            ? { url: '/media/a"b\\c.jpg', width: 300, height: 200, alt: "" }
            : null,
    }),
    ...imageSizingFor(
      async (source): Promise<readonly ImageCopy[]> =>
        "id" in source
          ? [640, 960, 1280].map(width => ({
              url: `/media/photo-${width}.webp`,
              width,
            }))
          : [],
      BREAKPOINTS,
      nodes,
      true
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
  const html = await new Response(stream).text();
  return new DOMParser().parseFromString(html, "text/html");
}

/** The button that opens a picture, and the popover it names. */
function lightboxOf(doc: Document): {
  opener: HTMLButtonElement;
  popover: HTMLElement;
} {
  const opener = doc.querySelector<HTMLButtonElement>("button[popovertarget]");
  if (opener === null) throw new Error("no button opens the picture");
  const target = opener.getAttribute("popovertarget") ?? "";
  const popover = doc.getElementById(target);
  if (popover === null) throw new Error(`no popover with the id ${target}`);
  return { opener, popover };
}

describe("an Image set to Enlarge, on a published page", () => {
  it("draws the picture as a button, named for its alt text, that opens a popover", async () => {
    const doc = await page([image("pic", { whenClicked: "enlarge" })]);
    const { opener, popover } = lightboxOf(doc);
    expect(opener.getAttribute("type")).toBe("button");
    expect(opener.getAttribute("aria-label")).toBe(
      "Enlarge: The team on the hill"
    );
    // The page's own picture is inside the button: a click anywhere on it.
    expect(opener.querySelector("img")).not.toBeNull();
    // The browser's own popover, closed by a click outside and Escape.
    expect(popover.getAttribute("popover")).toBe("auto");
    // Toggled, the browser's default: the page's picture sits under the
    // backdrop, and a click there lands on this button, so it must close
    // the lightbox as a click anywhere else outside it does.
    expect(opener.hasAttribute("popovertargetaction")).toBe(false);
  });

  it("names a decorative picture's button without alt text", async () => {
    const doc = await page([
      image("pic", { whenClicked: "enlarge", decorative: true }),
    ]);
    expect(lightboxOf(doc).opener.getAttribute("aria-label")).toBe(
      "Enlarge picture"
    );
  });

  it("holds a Close button, the full-size picture and the caption, and nothing else to press", async () => {
    const doc = await page([
      image("pic", { whenClicked: "enlarge", caption: "Our team" }),
    ]);
    const { popover } = lightboxOf(doc);
    const buttons = [...popover.querySelectorAll("button")];
    // Close only: no Previous or Next, which would need a script.
    expect(buttons.map(each => each.textContent)).toEqual(["Close"]);
    const [close] = buttons;
    expect(close?.getAttribute("type")).toBe("button");
    expect(close?.getAttribute("popovertarget")).toBe(popover.id);
    expect(close?.getAttribute("popovertargetaction")).toBe("hide");
    const full = popover.querySelector('[role="img"]');
    expect(full?.getAttribute("aria-label")).toBe("The team on the hill");
    expect(popover.textContent).toContain("Our team");
    // The caption stays under the page's picture too.
    expect(doc.querySelector("figure > figcaption")?.textContent).toBe(
      "Our team"
    );
  });

  it("shows the full-size file in the popover as a background, fetched only when it opens", async () => {
    const doc = await page([image("pic", { whenClicked: "enlarge" })]);
    const { opener, popover } = lightboxOf(doc);
    // No `img` in the popover: with script turned off a browser ignores
    // `loading="lazy"` and fetches every one with the page. A background
    // inside a closed popover, which is not drawn, is fetched on opening.
    expect(popover.querySelector("img")).toBeNull();
    const full = popover.querySelector<HTMLElement>('[role="img"]');
    // The original, never a copy sized to the page.
    expect(full?.style.backgroundImage).toBe('url("/media/photo.jpg")');
    // Its proportion, so the box is the picture's shape before it arrives.
    expect(full?.style.aspectRatio).toBe("3000 / 2000");
    // The control: the page's own picture is an `img` offering the copies,
    // loaded first as the page's first block.
    const shown = opener.querySelector("img");
    expect(shown?.getAttribute("srcset")).toContain(
      "/media/photo-640.webp 640w"
    );
    expect(shown?.getAttribute("loading")).toBe("eager");
  });

  it("hides a decorative picture's full-size view from screen readers", async () => {
    const doc = await page([
      image("pic", { whenClicked: "enlarge", decorative: true }),
    ]);
    const { popover } = lightboxOf(doc);
    expect(popover.querySelector('[role="img"]')).toBeNull();
    expect(
      popover
        .querySelector("[data-nx-lightbox-picture]")
        ?.getAttribute("aria-hidden")
    ).toBe("true");
  });

  it("writes an address with quotes into the background as one CSS string", async () => {
    // The address is content: a quote in it must not end the string and
    // let the rest be read as more CSS. Read from the page's markup as
    // sent, not as a style object re-serializes it.
    const doc = await page([
      image("pic", { mediaId: "quoted", whenClicked: "enlarge" }),
    ]);
    const full = doc.querySelector("[data-nx-lightbox-picture]");
    expect(full?.getAttribute("style")).toContain(
      String.raw`url("/media/a\"b\\c.jpg")`
    );
  });

  it("writes a form feed or a line break in an address as its code, which a CSS string can't hold", () => {
    // Each ends a CSS string, so each is written as its escape, never as
    // itself. Asked of the writer directly: the page's own address check
    // refuses such an address before it is drawn, so no render reaches it.
    expect(cssUrl("/a\fb.jpg")).toBe(String.raw`url("/a\c b.jpg")`);
    expect(cssUrl("/a\nb\rc.jpg")).toBe(String.raw`url("/a\a b\d c.jpg")`);
    expect(cssUrl('/a"b\\c.jpg')).toBe(String.raw`url("/a\"b\\c.jpg")`);
  });

  it("gives each Image's popover an id of its own, from its node", async () => {
    const doc = await page([
      image("first", { whenClicked: "enlarge" }),
      image("second", { whenClicked: "enlarge" }),
    ]);
    const ids = [...doc.querySelectorAll("[popover]")].map(each => each.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const opener of doc.querySelectorAll("button[popovertarget]")) {
      expect(ids).toContain(opener.getAttribute("popovertarget"));
    }
  });

  it("adds no script to the page", async () => {
    const doc = await page([
      image("pic", { whenClicked: "enlarge", caption: "Our team" }),
    ]);
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    // Must-be-found: the lightbox was drawn.
    expect(doc.querySelector("[popover]")).not.toBeNull();
  });

  it("draws no popover where a click does nothing or follows a link", async () => {
    for (const props of [
      { whenClicked: "nothing" },
      { whenClicked: "link", href: "/about" },
      {},
    ]) {
      const doc = await page([image("pic", props)]);
      expect(doc.querySelector("[popover]")).toBeNull();
      expect(doc.querySelector("button")).toBeNull();
    }
  });
});

/** One enlarged Image drawn on its own, with these context fields. */
async function drawnWith(ctx: Record<string, unknown>): Promise<HTMLElement> {
  const { container } = render(
    await renderImage({
      props: { src: "https://example.test/team.png", whenClicked: "enlarge" },
      className: "nx-pb-node1",
      partClass: (part: string) => `part-${part}`,
      node: { id: "pic", type: "core/image", version: 1, props: {} },
      ctx: {
        resolveMedia: async () => null,
        resolveEntryPath: async () => undefined,
        ...ctx,
      },
    } as never)
  );
  return container;
}

describe("an enlarged Image a list draws once per entry", () => {
  const drawnAt = (itemPosition: string) => drawnWith({ itemPosition });

  it("gives each entry's copy its own popover id", async () => {
    const first = (await drawnAt("0")).querySelector("[popover]")?.id;
    const second = (await drawnAt("1")).querySelector("[popover]")?.id;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});

describe("an enlarged Image where an author is looking", () => {
  it("opens nothing on a click, so the click only selects the block", async () => {
    // The canvas draws the page as published, and a click on a picture is
    // how an author selects it: a button naming the popover would open it
    // over the editor instead.
    const canvas = await drawnWith({ diagnostics: true });
    const opener = canvas.querySelector("button[data-nx-enlarge]");
    expect(opener?.getAttribute("aria-label")).toBe("Enlarge picture");
    expect(opener?.hasAttribute("popovertarget")).toBe(false);
    // The control: on a visitor's page the same button opens it.
    const live = await drawnWith({});
    expect(
      live
        .querySelector("button[data-nx-enlarge]")
        ?.getAttribute("popovertarget")
    ).toBe("nx-lightbox-pic");
  });
});
