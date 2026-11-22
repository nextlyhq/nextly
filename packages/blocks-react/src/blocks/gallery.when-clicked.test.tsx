// @vitest-environment jsdom
/**
 * A Gallery's "When clicked", and the pictures in it that follow it.
 *
 * A picture whose own "When clicked" is unset and holds no link follows the
 * gallery it sits in: set to Enlarge, every such picture opens the lightbox.
 * A picture's own choice, or its link, always wins. Drawn through the page
 * renderer, as a published page draws a gallery and its Image children.
 *
 * @module blocks/gallery.when-clicked.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  resolveContentModel,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { gallery } from "./gallery";
import { coreBlocks } from "./index";
import { whenClickedOf } from "./props";

const picture = (
  id: string,
  props: Record<string, unknown> = {}
): BlockNode => ({
  id,
  type: "core/image",
  version: 1,
  props: { mediaId: "photo", alt: `Picture ${id}`, ...props },
});

/** A published page holding one gallery of these pictures, parsed. */
async function page(
  galleryProps: Record<string, unknown>,
  pictures: BlockNode[]
): Promise<Document> {
  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "g",
        type: "core/gallery",
        version: 1,
        props: { as: "div", ...galleryProps },
        slots: { children: pictures },
      },
    ],
  };
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      siteStyles={false}
      context={createStandaloneContext({
        resolveMedia: async () => ({
          url: "/media/photo.jpg",
          width: 1600,
          height: 900,
          alt: "",
        }),
        resolveEntryPath: async () => "/about",
      })}
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

/** The pictures that open a lightbox, and those that follow a link, by alt. */
function clicks(doc: Document): { enlarge: string[]; link: string[] } {
  return {
    enlarge: [...doc.querySelectorAll("button[popovertarget] img")].map(
      each => each.getAttribute("alt") ?? ""
    ),
    link: [...doc.querySelectorAll("a[href] img")].map(
      each => each.getAttribute("alt") ?? ""
    ),
  };
}

describe("what a click on a picture does, inside a gallery", () => {
  it("follows the gallery while the picture says nothing and holds no link", () => {
    expect(whenClickedOf({}, "enlarge")).toBe("enlarge");
    expect(whenClickedOf({}, "nothing")).toBe("nothing");
    // The picture's own choice wins, Nothing included.
    expect(whenClickedOf({ whenClicked: "nothing" }, "enlarge")).toBe(
      "nothing"
    );
    expect(whenClickedOf({ whenClicked: "link", href: "/a" }, "enlarge")).toBe(
      "link"
    );
    // A link the picture holds, with no choice stored, still links.
    expect(whenClickedOf({ href: "/a" }, "enlarge")).toBe("link");
    // Outside a gallery, unset is Nothing, as before.
    expect(whenClickedOf({})).toBe("nothing");
  });
});

describe("a gallery set to Enlarge, on a published page", () => {
  it("enlarges every picture that follows it, and links the one set to Link", async () => {
    const doc = await page({ whenClicked: "enlarge" }, [
      picture("1"),
      picture("2", { whenClicked: "link", href: "/about" }),
      picture("3"),
    ]);
    expect(clicks(doc)).toEqual({
      enlarge: ["Picture 1", "Picture 3"],
      link: ["Picture 2"],
    });
  });

  it("leaves a picture set to Nothing still", async () => {
    const doc = await page({ whenClicked: "enlarge" }, [
      picture("1", { whenClicked: "nothing" }),
      picture("2"),
    ]);
    expect(clicks(doc)).toEqual({ enlarge: ["Picture 2"], link: [] });
  });

  it("enlarges nothing while the gallery says Nothing, or nothing at all", async () => {
    for (const props of [{ whenClicked: "nothing" }, {}]) {
      const doc = await page(props, [picture("1"), picture("2")]);
      expect(clicks(doc)).toEqual({ enlarge: [], link: [] });
      // Must-be-found: the pictures were drawn.
      expect(doc.querySelectorAll("img")).toHaveLength(2);
    }
  });

  it("still enlarges a picture set to Enlarge in a gallery that says Nothing", async () => {
    const doc = await page({ whenClicked: "nothing" }, [
      picture("1", { whenClicked: "enlarge" }),
    ]);
    expect(clicks(doc).enlarge).toEqual(["Picture 1"]);
  });
});

describe("core/gallery's When clicked setting", () => {
  const props = gallery.props as Record<string, Record<string, unknown>>;

  it("offers Nothing and Enlarge, plainly named", () => {
    expect(props.whenClicked).toMatchObject({
      label: "When clicked",
      type: "select",
      options: ["nothing", "enlarge"],
      optionLabels: { nothing: "Nothing", enlarge: "Enlarge" },
    });
  });

  it("stores no choice on a new gallery, which reads as Nothing", () => {
    expect(gallery.defaultProps).not.toHaveProperty("whenClicked");
    expect(gallery.example?.props ?? {}).not.toHaveProperty("whenClicked");
  });

  it("is interactive content while its pictures enlarge, so no link holds it", () => {
    const is = (galleryProps: Record<string, unknown>) =>
      resolveContentModel(gallery.contentModel as never, {
        as: "div",
        ...galleryProps,
      }).is;
    expect(is({ whenClicked: "enlarge" })).toContain("interactive");
    expect(is({ whenClicked: "nothing" })).not.toContain("interactive");
    expect(is({})).not.toContain("interactive");
  });
});
