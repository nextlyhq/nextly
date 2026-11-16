/**
 * An image bound to a media field draws exactly as one whose media was picked,
 * and one bound to a URL field draws the address only when it is an image
 * address the site may load: never `javascript:` or `data:`, never a host
 * outside the site's list, and never a broken element. A record the host
 * can't find shows the binding's fallback, an image address or a media
 * library image, then nothing.
 *
 * Every fixture keeps the record's, the address's and the fallback's values
 * distinct, so an assertion can only pass on the one that should show.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { image } from "./blocks/image";
import {
  createStandaloneContext,
  type PageBindings,
  type ResolvedMedia,
} from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

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

const POSTS: readonly BindingFieldShape[] = [
  { name: "cover", type: "upload", relationTo: "media" },
  { name: "either", type: "upload", relationTo: ["media", "documents"] },
  { name: "attachment", type: "upload", relationTo: "documents" },
  { name: "photo", type: "upload", relationTo: "photos" },
  { name: "photoUrl", type: "url" },
];

/** The host's media library: one record, and nothing for any other id. */
const LIBRARY: Readonly<Record<string, ResolvedMedia>> = {
  m1: {
    url: "https://cdn.example/m1.jpg",
    alt: "Record alt",
    width: 800,
    height: 600,
  },
};

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** An image whose `mediaId` is bound to `path`, typing an address of its own. */
function boundImage(
  path: string,
  extra: { fallback?: string; alt?: string } = {}
): BlockNode {
  return {
    id: "picture",
    type: "core/image",
    version: 1,
    props: {
      src: "https://cdn.example/own.jpg",
      ...(extra.alt === undefined ? {} : { alt: extra.alt }),
    },
    bindings: {
      mediaId: {
        $bind: path,
        ...(extra.fallback === undefined ? {} : { fallback: extra.fallback }),
      },
    },
  };
}

async function render(
  document: BlockDocument,
  entry: Readonly<Record<string, unknown>>,
  remotePatterns?: readonly URL[],
  mediaCollection?: string
): Promise<string> {
  const bindings: PageBindings = {
    entry,
    entryRef: { collection: "posts" },
    ...(mediaCollection === undefined ? {} : { mediaCollection }),
    fieldShapes: {
      fieldsOf: ref =>
        "collection" in ref && ref.collection === "posts" ? POSTS : undefined,
    },
  };
  return await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      bindings={bindings}
      context={createStandaloneContext({
        resolveMedia: id => Promise.resolve(LIBRARY[id] ?? null),
      })}
      {...(remotePatterns === undefined
        ? {}
        : { hostPolicy: { remotePatterns: [...remotePatterns] } })}
    />
  );
}

/** Every `<img>` the page drew, as written. */
function images(html: string): string[] {
  return [...html.matchAll(/<img[^>]*>/g)].map(match => match[0]);
}

/** One attribute of an `<img>`, or nothing when it has none. */
function attribute(tag: string | undefined, name: string): string | undefined {
  return tag === undefined
    ? undefined
    : new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

describe("an image bound to a field", () => {
  it("draws a media field's record as a picked one is drawn: its address, alt text and size", async () => {
    const bound = images(
      await render(page(boundImage("cover")), {
        cover: { id: "m1", filename: "m1.jpg" },
      })
    );
    expect(bound).toHaveLength(1);
    expect(attribute(bound[0], "src")).toBe("https://cdn.example/m1.jpg");
    expect(attribute(bound[0], "alt")).toBe("Record alt");
    expect(attribute(bound[0], "width")).toBe("800");
    expect(attribute(bound[0], "height")).toBe("600");
    // The same element an author picking the record gets, attribute for
    // attribute.
    const picked = images(
      await render(
        page({
          id: "picture",
          type: "core/image",
          version: 1,
          props: { mediaId: "m1", src: "https://cdn.example/own.jpg" },
        }),
        {}
      )
    );
    expect(bound).toEqual(picked);
  });

  it("keeps the block's own alt text over the record's", async () => {
    const tag = images(
      await render(page(boundImage("cover", { alt: "Own alt" })), {
        cover: "m1",
      })
    )[0];
    expect(attribute(tag, "src")).toBe("https://cdn.example/m1.jpg");
    expect(attribute(tag, "alt")).toBe("Own alt");
  });

  it("draws a URL field's image address with the block's alt text and no size of its own", async () => {
    const tag = images(
      await render(page(boundImage("photoUrl", { alt: "Own alt" })), {
        photoUrl: "https://cdn.example/photo.jpg",
      })
    )[0];
    expect(attribute(tag, "src")).toBe("https://cdn.example/photo.jpg");
    expect(attribute(tag, "alt")).toBe("Own alt");
    expect(attribute(tag, "width")).toBeUndefined();
    // Without alt text of its own, an address has none to offer: empty.
    const bare = images(
      await render(page(boundImage("photoUrl")), {
        photoUrl: "/media/photo.jpg",
      })
    )[0];
    expect(attribute(bare, "src")).toBe("/media/photo.jpg");
    expect(attribute(bare, "alt")).toBe("");
  });

  it("never draws javascript: or data: from a URL field: the fallback, or nothing", async () => {
    for (const photoUrl of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    ]) {
      const bare = await render(page(boundImage("photoUrl")), { photoUrl });
      expect(images(bare), photoUrl).toEqual([]);
      // Nor the block's own typed address: the binding names its fallback.
      expect(bare).not.toContain("own.jpg");
      expect(bare).not.toContain(photoUrl);
      const fallen = images(
        await render(
          page(boundImage("photoUrl", { fallback: "/media/fallback.jpg" })),
          { photoUrl }
        )
      );
      expect(
        fallen.map(tag => attribute(tag, "src")),
        photoUrl
      ).toEqual(["/media/fallback.jpg"]);
    }
  });

  it("draws no address from a host outside the site's list, and falls back past it", async () => {
    const listed = [new URL("https://cdn.example/**")];
    const outside = { photoUrl: "https://elsewhere.example/photo.jpg" };
    const bare = await render(page(boundImage("photoUrl")), outside, listed);
    expect(images(bare)).toEqual([]);
    expect(bare).not.toContain("elsewhere.example");
    const fallen = images(
      await render(
        page(
          boundImage("photoUrl", {
            fallback: "https://cdn.example/fallback.jpg",
          })
        ),
        outside,
        listed
      )
    );
    expect(fallen.map(tag => attribute(tag, "src"))).toEqual([
      "https://cdn.example/fallback.jpg",
    ]);
    // CONTROL: a listed host is drawn.
    const inside = images(
      await render(
        page(boundImage("photoUrl")),
        { photoUrl: "https://cdn.example/photo.jpg" },
        listed
      )
    );
    expect(inside.map(tag => attribute(tag, "src"))).toEqual([
      "https://cdn.example/photo.jpg",
    ]);
  });

  it("shows the fallback for a record the host can't find, then nothing, never a broken image", async () => {
    const gone = { cover: "deleted-record" };
    const bare = await render(page(boundImage("cover")), gone);
    expect(images(bare)).toEqual([]);
    expect(bare).not.toContain("own.jpg");
    const fallen = images(
      await render(
        page(boundImage("cover", { fallback: "/media/fallback.jpg" })),
        gone
      )
    );
    expect(fallen.map(tag => attribute(tag, "src"))).toEqual([
      "/media/fallback.jpg",
    ]);
  });

  it("shows the fallback when the field is empty, as any binding does", async () => {
    const fallen = images(
      await render(page(boundImage("cover", { fallback: "/media/f.jpg" })), {
        cover: null,
      })
    );
    expect(fallen.map(tag => attribute(tag, "src"))).toEqual(["/media/f.jpg"]);
  });

  it("draws a media-library fallback as a picked image is drawn, for an empty field and a record the host can't find", async () => {
    for (const entry of [{ cover: null }, { cover: "deleted-record" }]) {
      const tags = images(
        await render(page(boundImage("cover", { fallback: "m1" })), entry)
      );
      // The record's address, alt text and size, never the typed address.
      expect(tags).toHaveLength(1);
      expect(attribute(tags[0], "src")).toBe("https://cdn.example/m1.jpg");
      expect(attribute(tags[0], "alt")).toBe("Record alt");
      expect(attribute(tags[0], "width")).toBe("800");
    }
  });

  it("draws nothing for a media-library fallback the host can't find either, never the typed address", async () => {
    const html = await render(
      page(boundImage("cover", { fallback: "also-deleted" })),
      { cover: "deleted-record" }
    );
    expect(images(html)).toEqual([]);
    expect(html).not.toContain("own.jpg");
  });

  it("shows the image's own picked media when the binding gives nothing and has no fallback", async () => {
    // As any prop shows its own value then: the picked media, never the
    // typed address beside it.
    const own: BlockNode = {
      ...boundImage("photoUrl"),
      props: { mediaId: "m1", src: "https://cdn.example/own.jpg" },
    };
    const tags = images(
      await render(page(own), { photoUrl: "javascript:alert(1)" })
    );
    expect(tags.map(tag => attribute(tag, "src"))).toEqual([
      "https://cdn.example/m1.jpg",
    ]);
  });

  it("draws an upload field that may point at several collections by the media it holds", async () => {
    // Stored and populated as `{ relationTo, value }`.
    for (const either of [
      { relationTo: "media", value: "m1" },
      { relationTo: "media", value: { id: "m1", filename: "m1.jpg" } },
    ]) {
      const tags = images(await render(page(boundImage("either")), { either }));
      expect(tags.map(tag => attribute(tag, "src"))).toEqual([
        "https://cdn.example/m1.jpg",
      ]);
    }
  });

  it("never draws another collection's record as media, by an id the media library happens to share", async () => {
    // "m1" names a document here, not the picture the library holds as m1.
    const fallback = { fallback: "/media/fallback.jpg" };
    const arm = images(
      await render(page(boundImage("either", fallback)), {
        either: { relationTo: "documents", value: "m1" },
      })
    );
    expect(arm.map(tag => attribute(tag, "src"))).toEqual([
      "/media/fallback.jpg",
    ]);
    const other = images(
      await render(page(boundImage("attachment", fallback)), {
        attachment: "m1",
      })
    );
    expect(other.map(tag => attribute(tag, "src"))).toEqual([
      "/media/fallback.jpg",
    ]);
  });

  it("reads media from the collection the host names, and nothing from the default library then", async () => {
    // A site resolving its pictures from "photos": a field to photos draws,
    // and one to the default library names records the lookup won't read.
    const fallback = { fallback: "/media/fallback.jpg" };
    const own = images(
      await render(
        page(boundImage("photo", fallback)),
        { photo: "m1" },
        undefined,
        "photos"
      )
    );
    expect(own.map(tag => attribute(tag, "src"))).toEqual([
      "https://cdn.example/m1.jpg",
    ]);
    const library = images(
      await render(
        page(boundImage("cover", fallback)),
        { cover: "m1" },
        undefined,
        "photos"
      )
    );
    expect(library.map(tag => attribute(tag, "src"))).toEqual([
      "/media/fallback.jpg",
    ]);
  });
});

describe("what a bound image offers the page's metadata", () => {
  it("offers what the page draws: a bound address as an address, then its fallback, never the typed one", () => {
    const offered = image.seo?.(
      {
        mediaId: "https://cdn.example/photo.jpg",
        src: "https://cdn.example/own.jpg",
      },
      {
        bound: {
          mediaId: {
            kind: "image",
            holds: "address",
            from: "value",
            fallback: { holds: "address", value: "/media/fallback.jpg" },
          },
        },
      }
    );
    expect(offered?.image).toEqual([
      { url: "https://cdn.example/photo.jpg" },
      { url: "/media/fallback.jpg" },
    ]);
  });

  it("offers a bound media id as media, and an unbound image as before", () => {
    expect(
      image.seo?.(
        { mediaId: "m1", src: "https://cdn.example/own.jpg" },
        { bound: { mediaId: { kind: "image", holds: "media", from: "value" } } }
      )?.image
    ).toEqual([{ media: "m1" }]);
    // CONTROL: unbound, the picked media and then the typed address.
    expect(
      image.seo?.({ mediaId: "m1", src: "https://cdn.example/own.jpg" })?.image
    ).toEqual([{ media: "m1" }, { url: "https://cdn.example/own.jpg" }]);
  });
});
