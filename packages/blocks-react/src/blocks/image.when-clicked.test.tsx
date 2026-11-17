// @vitest-environment jsdom
/**
 * What a click on an Image does, as its stored "When clicked" says, and what
 * its panel is declared with.
 *
 * One reading (`whenClickedOf`) answers the question for the render, the
 * content model and the editor's panel. Unset, it reads as Link while a link
 * is set and as Nothing otherwise, so an Image stored before the setting
 * existed renders exactly as it did.
 *
 * @module blocks/image.when-clicked.test
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { resolveContentModel } from "@nextlyhq/blocks-engine";

import { image, renderImage } from "./image";
import { whenClickedOf } from "./props";

const TYPE_CLASS = "nx-bt-core--image";

async function draw(props: Record<string, unknown>) {
  const { container } = render(
    await renderImage({
      props: {
        src: "https://example.test/team.png",
        alt: "The team",
        ...props,
      },
      className: `nx-pb-node1 ${TYPE_CLASS}`,
      partClass: (part: string) => `part-${part}`,
      ctx: {
        resolveMedia: async () => null,
        resolveEntryPath: async () => "/about-us",
      },
    } as never)
  );
  return container;
}

const interactive = (props: Record<string, unknown>) =>
  resolveContentModel(image.contentModel as never, props).is.includes(
    "interactive"
  );

describe("what a click on an Image does", () => {
  it("reads a stored choice as it is", () => {
    expect(whenClickedOf({ whenClicked: "nothing", href: "/a" })).toBe(
      "nothing"
    );
    expect(whenClickedOf({ whenClicked: "link" })).toBe("link");
    expect(whenClickedOf({ whenClicked: "enlarge", href: "/a" })).toBe(
      "enlarge"
    );
  });

  it("reads unset as Link while a link is set, else Nothing", () => {
    expect(whenClickedOf({ href: "/about" })).toBe("link");
    expect(whenClickedOf({ entryCollection: "pages", entryId: "p1" })).toBe(
      "link"
    );
    expect(whenClickedOf({})).toBe("nothing");
    // An address the page would never follow is no link.
    expect(whenClickedOf({ href: "javascript:alert(1)" })).toBe("nothing");
  });

  it("reads a stored value it does not know as unset", () => {
    expect(whenClickedOf({ whenClicked: "zoom", href: "/a" })).toBe("link");
    expect(whenClickedOf({ whenClicked: 3 })).toBe("nothing");
  });
});

describe("core/image's link follows When clicked", () => {
  it("links, as before, where an Image stored before the choice holds a link", async () => {
    const link = (await draw({ href: "/about" })).firstElementChild;
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe("/about");
  });

  it("links where Link is chosen", async () => {
    const container = await draw({ whenClicked: "link", href: "/about" });
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/about");
  });

  it("draws no link where Nothing is chosen, whatever link is kept", async () => {
    const container = await draw({
      whenClicked: "nothing",
      href: "/about",
      entryCollection: "pages",
      entryId: "p1",
    });
    expect(container.querySelector("a")).toBeNull();
    const img = container.firstElementChild;
    expect(img?.tagName).toBe("IMG");
    // Unwrapped, the picture is the root and wears the node's own classes.
    expect(img?.className).toContain("nx-pb-node1");
  });

  it("draws no link where Enlarge is chosen", async () => {
    const container = await draw({ whenClicked: "enlarge", href: "/about" });
    expect(container.querySelector("a")).toBeNull();
  });

  it("is interactive content while it links or enlarges, and not otherwise", () => {
    expect(interactive({ href: "/about" })).toBe(true);
    expect(interactive({ whenClicked: "link", href: "/about" })).toBe(true);
    // Link chosen with nothing to follow draws no link.
    expect(interactive({ whenClicked: "link" })).toBe(false);
    expect(interactive({ whenClicked: "nothing", href: "/about" })).toBe(false);
    expect(interactive({ whenClicked: "enlarge" })).toBe(true);
  });
});

describe("core/image's caption and alt text, in every branch", () => {
  for (const [name, props] of [
    ["unlinked", {}],
    ["linked", { href: "/about" }],
    ["set to Nothing with a link kept", { whenClicked: "nothing", href: "/a" }],
    ["set to Enlarge", { whenClicked: "enlarge" }],
  ] as const) {
    it(`renders the caption as the picture's figcaption when ${name}`, async () => {
      const container = await draw({ ...props, caption: "Our team" });
      const figure = container.firstElementChild;
      expect(figure?.tagName).toBe("FIGURE");
      expect(figure?.querySelector("img")).not.toBeNull();
      expect(figure?.querySelector(":scope > figcaption")?.textContent).toBe(
        "Our team"
      );
    });

    it(`always renders alt, empty when decorative, when ${name}`, async () => {
      const decorative = await draw({ ...props, decorative: true });
      expect(decorative.querySelector("img")?.getAttribute("alt")).toBe("");
      const unsaid = await draw({ ...props, alt: undefined });
      expect(unsaid.querySelector("img")?.hasAttribute("alt")).toBe(true);
      expect(unsaid.querySelector("img")?.getAttribute("alt")).toBe("");
    });
  }
});

describe("core/image's settings, as the panel is given them", () => {
  const props = image.props as Record<string, Record<string, unknown>>;

  it("offers When clicked as Nothing, Link and Enlarge, in its own section", () => {
    expect(props.whenClicked).toMatchObject({
      label: "When clicked",
      section: "When clicked",
      type: "select",
      options: ["nothing", "link", "enlarge"],
      optionLabels: { nothing: "Nothing", link: "Link", enlarge: "Enlarge" },
    });
  });

  it("places the shared link settings under When clicked", () => {
    for (const name of ["href", "entryCollection", "entryId", "target", "rel"])
      expect(props[name]?.section).toBe("When clicked");
  });

  it("names the alt text, the decorative mark and the caption plainly", () => {
    expect(props.alt?.label).toBe("Alt text");
    expect(props.decorative?.label).toBe("Decorative, no alt text");
    expect(props.caption).toMatchObject({
      label: "Caption",
      section: "Caption",
    });
  });

  it("stores no choice on a new Image, so one in a gallery follows it", () => {
    expect(image.defaultProps).not.toHaveProperty("whenClicked");
    expect(image.example?.props ?? {}).not.toHaveProperty("whenClicked");
  });
});
