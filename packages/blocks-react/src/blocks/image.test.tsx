// @vitest-environment jsdom
/**
 * Which ELEMENT the image block's defaults land on.
 *
 * `base-styles.test.tsx` derives its checks from every block that declares
 * defaults, and asks whether each declaration reaches the compiled stylesheet.
 * It cannot ask the question this file exists for: a rule can be emitted
 * correctly, against the right class, and still be attached to the wrong
 * element. This block has two render branches — a bare `<img>`, and an `<img>`
 * inside a `<figure>` once it has a caption — and only one of them can be the
 * one the sizing constrains.
 *
 * @module blocks/image.test
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { resolveContentModel } from "@nextlyhq/blocks-engine";

import { image, renderImage } from "./image";

const TYPE_CLASS = "nx-bt-core--image";

async function draw(caption: string, extra = "") {
  const { container } = render(
    await renderImage({
      props: {
        src: "https://example.test/wide.png",
        alt: "a wide asset",
        ...(caption === "" ? {} : { caption }),
      },
      className: `nx-pb-node1 ${TYPE_CLASS}${extra}`,
      // Required by the render contract; these fixtures declare no parts.
      partClass: () => "",
    } as never)
  );
  return container;
}

describe("core/image, whichever branch it renders", () => {
  it("puts the type class on the IMG when there is no caption", async () => {
    const img = (await draw("")).querySelector("img");
    expect(img?.className).toContain(TYPE_CLASS);
  });

  it("puts the type class on the IMG when there IS a caption", async () => {
    // The defect this guards: the class used to move wholesale to the figure,
    // so the block's own `max-width`/`height` constrained the WRAPPER while the
    // image inside kept the intrinsic size its width/height attributes declare
    // — and a captioned asset wider than its column overflowed a figure that
    // measured correctly.
    const container = await draw("a caption");
    expect(container.querySelector("figure")).not.toBeNull();
    expect(container.querySelector("img")?.className).toContain(TYPE_CLASS);
  });

  it("puts the image's look on the IMG when there IS a caption, a shared style on the figure", async () => {
    // Rounded and Circle style the picture itself: on the figure, the corners
    // and the fit would miss the image and catch the caption instead.
    // A shared style named like a look keeps its `nx-c-` name, and the figure.
    const container = await draw(
      "a caption",
      " nx-l-image-rounded nx-c-image-circle nx-c-card"
    );
    expect(container.querySelector("img")?.className).toContain(
      "nx-l-image-rounded"
    );
    const figure = container.querySelector("figure")?.className ?? "";
    expect(figure).not.toContain("nx-l-image-rounded");
    expect(figure).toContain("nx-c-card");
    expect(figure).toContain("nx-c-image-circle");
  });

  it("leaves the node's own classes on the figure, which is the root", async () => {
    // The type class rides both; the per-node class must not, or two elements
    // answer to one node's identity.
    const container = await draw("a caption");
    expect(container.querySelector("figure")?.className).toContain(
      "nx-pb-node1"
    );
    expect(container.querySelector("img")?.className).not.toContain(
      "nx-pb-node1"
    );
  });
});

/** The image drawn with the given props, its parts named for what they are. */
async function drawWith(
  props: Record<string, unknown>,
  resolveEntryPath: (
    collection: string,
    id: string
  ) => Promise<string | null> = async () => null
) {
  const { container } = render(
    await renderImage({
      props: {
        src: "https://example.test/team.png",
        alt: "The team",
        ...props,
      },
      className: `nx-pb-node1 ${TYPE_CLASS}`,
      partClass: (part: string) => `part-${part}`,
      ctx: { resolveMedia: async () => null, resolveEntryPath },
    } as never)
  );
  return container;
}

describe("core/image with a link", () => {
  it("is the link, holding the picture, where it has no caption", async () => {
    const container = await drawWith({ href: "/about" });
    const link = container.firstElementChild;
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe("/about");
    // The node's identity is the link's, the root; the picture inherits its
    // fit and focal point through its part.
    expect(link?.className).toContain("nx-pb-node1");
    const img = link?.querySelector("img");
    expect(img?.className).toContain("part-picture");
    expect(img?.className).not.toContain("nx-pb-node1");
    // The alt text is what names the link.
    expect(img?.getAttribute("alt")).toBe("The team");
  });

  it("links only the picture, leaving the caption outside the link", async () => {
    const container = await drawWith({ href: "/about", caption: "Our team" });
    const figure = container.querySelector("figure");
    expect(figure?.className).toContain("nx-pb-node1");
    const link = figure?.querySelector("a");
    expect(link?.querySelector("img")).not.toBeNull();
    expect(link?.querySelector("figcaption")).toBeNull();
    expect(figure?.querySelector(":scope > figcaption")?.textContent).toBe(
      "Our team"
    );
  });

  it("links to an entry by its path, and opens a new tab safely", async () => {
    const container = await drawWith(
      { entryCollection: "pages", entryId: "p1", target: "_blank" },
      async () => "/about-us"
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/about-us");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("draws no link for an address it will not follow", async () => {
    const container = await drawWith({ href: "javascript:alert(1)" });
    expect(container.querySelector("a")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("IMG");
  });

  it("lets a captioned picture take its fit and focal point from the figure", async () => {
    // The node's Style values land on the root, the figure, where `object-fit`
    // does nothing; the picture inherits them through its part.
    const container = await drawWith({ caption: "Our team" });
    expect(container.querySelector("img")?.className).toContain("part-picture");
  });
});

describe("core/image as content", () => {
  it("is interactive content while it links, so a link cannot hold it", () => {
    // A linked image inside a linked card would nest one link in another,
    // which HTML parsing breaks apart.
    const model = (props: Record<string, unknown>) =>
      resolveContentModel(image.contentModel as never, props).is;
    expect(model({ href: "/about" })).toContain("interactive");
    expect(model({ entryCollection: "pages", entryId: "p1" })).toContain(
      "interactive"
    );
    expect(model({})).not.toContain("interactive");
    expect(model({ href: "javascript:alert(1)" })).not.toContain("interactive");
  });

  it("names a link whose picture has no alt text by its caption, else its address", async () => {
    // A link holding only a decorative picture would have no name at all.
    const captioned = await drawWith({
      href: "/about",
      alt: "",
      caption: "Our team",
    });
    expect(captioned.querySelector("a")?.getAttribute("aria-label")).toBe(
      "Our team"
    );
    const bare = await drawWith({ href: "/about", decorative: true });
    expect(bare.querySelector("a")?.getAttribute("aria-label")).toBe("/about");
    // With alt text the picture names it, and the link says nothing over it.
    const named = await drawWith({ href: "/about" });
    expect(named.querySelector("a")?.hasAttribute("aria-label")).toBe(false);
  });
});
