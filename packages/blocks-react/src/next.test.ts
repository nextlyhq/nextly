/**
 * `createBlocksPage` — the composition, exercised through the real
 * `createContentRoute` rather than around it.
 *
 * A fake READER is injected and everything above it is production code, so
 * these cover the seam that actually breaks: what the route hands the render,
 * and what the render hands the block renderer. Mocking `createContentRoute`
 * itself would assert only that this file calls a function.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createBlocksPage } from "./next";
import type { DerivedPageSeo } from "./next";
import { coreBlocks } from "./blocks";
import { createBlockResolver } from "./resolver";
import type { PageRendererProps } from "./page-renderer";

/** The core library, so the derivation has real definitions to ask. */
function coreResolver() {
  return createBlockResolver(coreBlocks);
}

const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [],
};

/** A reader answering one page, plus whatever records a test adds. */
function reader(
  entry: Record<string, unknown>,
  records: Record<string, Record<string, unknown>> = {}
) {
  return {
    find: vi.fn(async ({ collection }: { collection: string }) => ({
      // Only the route's primary collection holds the page being rendered; a
      // shadowing probe against another collection finds nothing unless a test
      // says otherwise.
      items: collection === "pages" ? [entry] : [],
      meta: {},
    })),
    findByID: vi.fn(async ({ id }: { id: string }) => records[id] ?? null),
    // A real instance exposes media as its OWN namespace, not as a dynamic
    // collection, so the double has to as well or it certifies a path that
    // fails against the product.
    media: {
      findByID: vi.fn(async ({ id }: { id: string }) => records[id] ?? null),
    },
  } as never;
}

/** Drive the route the way the App Router does. */
async function render(
  config: Parameters<typeof createBlocksPage>[0],
  slug: string[] = ["about"]
): Promise<PageRendererProps> {
  const route = createBlocksPage(config);
  const element = (await route.ContentPage({
    params: { slug },
  })) as ReactElement<PageRendererProps>;
  return element.props;
}

describe("createBlocksPage", () => {
  it("renders the document stored at the named field", async () => {
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: document }),
    });

    expect(props.document).toEqual(document);
  });

  it("renders an empty page when the field is present and empty", async () => {
    // An entry nobody has authored yet is ordinary, not an error.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: null }),
    });

    expect(props.document.nodes).toEqual([]);
    expect(props.document.formatVersion).toBe(DOCUMENT_FORMAT_VERSION);
  });

  it("names the field and the collection when the field is absent", async () => {
    // The alternative is a blank page with no explanation, which is the least
    // debuggable outcome available: a typo here can only ever render nothing.
    await expect(
      render({
        collections: ["pages"],
        field: "body",
        nextly: reader({ slug: "about", content: document }),
      })
    ).rejects.toThrow(/no field "body" on an entry from "pages"/);
  });

  it("surfaces a working draft on the context", async () => {
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader({
        slug: "about",
        content: document,
        _isWorkingDraft: true,
      }),
    });

    expect(props.context?.isWorkingDraft).toBe(true);
    expect(props.context?.entry).toMatchObject({ slug: "about" });
  });

  it("reports the locale the ROUTE read in, not one inferred from the row", async () => {
    // The companion overlay copies localized values onto the entry without
    // stamping which locale produced them, so a row-derived locale is absent on
    // exactly the localized pages that need it.
    const props = await render({
      collections: ["pages"],
      field: "content",
      locale: "fr",
      nextly: reader({ slug: "about", content: document }),
    });

    expect(props.context?.locale).toBe("fr");
  });

  it("resolves media, mapping the record's altText onto alt", async () => {
    // The record stores `altText` and a block asks for `alt`. Letting that fall
    // through renders the file name as alt text, which is an accessibility
    // defect rather than a cosmetic one.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        {
          "media-1": {
            url: "https://cdn.example/a.png",
            altText: "A cat",
            width: 800,
            height: 600,
          },
        }
      ),
    });

    await expect(props.context?.resolveMedia("media-1")).resolves.toEqual({
      url: "https://cdn.example/a.png",
      alt: "A cat",
      width: 800,
      height: 600,
    });
  });

  it("resolves media to null when the record has no usable url", async () => {
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { "media-2": { altText: "no url here" } }
      ),
    });

    await expect(props.context?.resolveMedia("media-2")).resolves.toBeNull();
  });

  it("resolves an entry reference through the route's own slug field", async () => {
    // The same field the route resolves paths by, so a link cannot point
    // somewhere this route would 404 on.
    const props = await render({
      collections: ["pages"],
      field: "content",
      slugField: "permalink",
      nextly: reader(
        { permalink: "about", content: document },
        { "page-9": { permalink: "contact" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "page-9")
    ).resolves.toBe("/contact");
  });

  it("prefers a caller's own resolvers over reading records", async () => {
    const resolveMedia = vi.fn(async () => ({ url: "/custom.png" }));
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: document }),
      resolveMedia,
    });

    await expect(props.context?.resolveMedia("anything")).resolves.toEqual({
      url: "/custom.png",
    });
    expect(resolveMedia).toHaveBeenCalledWith("anything");
  });

  it("reads related records through the instance the route resolved with", async () => {
    // Not a stylistic preference: on a per-tenant setup a second instance is a
    // second DATABASE, so a page and the media it embeds would come from two
    // places and the mismatch would surface as missing images, not an error.
    const instance = reader(
      { slug: "about", content: document },
      { "media-1": { url: "/a.png" } }
    ) as unknown as { media: { findByID: ReturnType<typeof vi.fn> } };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });
    await props.context?.resolveMedia("media-1");

    expect(instance.media.findByID).toHaveBeenCalledWith({ id: "media-1" });
  });

  it("reads default media through the media namespace, not as a collection", async () => {
    // Media is a system table with its own reader. Going through the generic
    // collection path finds nothing on a standard install, so the advertised
    // default resolver would never resolve an ordinary Nextly media record.
    const instance = reader(
      { slug: "about", content: document },
      { "media-1": { url: "/a.png", altText: "A" } }
    ) as unknown as {
      findByID: ReturnType<typeof vi.fn>;
      media: { findByID: ReturnType<typeof vi.fn> };
    };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });
    await expect(props.context?.resolveMedia("media-1")).resolves.toEqual({
      url: "/a.png",
      alt: "A",
    });

    expect(instance.media.findByID).toHaveBeenCalledWith({ id: "media-1" });
    expect(instance.findByID).not.toHaveBeenCalled();
  });

  it("reads a NAMED media collection as a collection", async () => {
    // An explicitly named one IS a dynamic collection — a site storing images
    // of its own — so it must not be sent to the media namespace.
    const instance = reader(
      { slug: "about", content: document },
      { p1: { url: "/own.png" } }
    ) as unknown as {
      findByID: ReturnType<typeof vi.fn>;
      media: { findByID: ReturnType<typeof vi.fn> };
    };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
      mediaCollection: "photos",
    });
    await props.context?.resolveMedia("p1");

    expect(instance.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "photos", id: "p1" })
    );
    expect(instance.media.findByID).not.toHaveBeenCalled();
  });

  it("resolves a homepage reference to the site root", async () => {
    // The content route resolves an empty slug at `/`. Treating it as missing
    // strips the destination from every button pointing at the site root.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { home: { slug: "" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "home")
    ).resolves.toBe("/");
  });

  it("gives no path for an entry this route would not serve", async () => {
    // A link is only useful if the path resolves. Emitting an href the same
    // route answers with notFound() is worse than emitting none — and it
    // publishes a restricted entry's slug to everyone who loads the page.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { secret: { slug: "unreleased", status: "draft" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "secret")
    ).resolves.toBeNull();
  });

  it("derives metadata from the page's own blocks", async () => {
    // The common case: nobody filled the SEO fields in, and the page already
    // contains its title, its opening prose and its first picture.
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "1",
          type: "core/heading",
          version: 1,
          props: { text: "Pricing" },
        },
        {
          id: "2",
          type: "core/text",
          version: 1,
          props: { text: "Plans for every team." },
        },
      ],
    };
    let seen: unknown;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "pricing", content: page }),
      blocks: coreResolver(),
      metadata: (_entry, _ctx, derived) => {
        seen = derived;
        return { title: derived.title };
      },
    });

    const meta = await route.generateMetadata({
      params: { slug: ["pricing"] },
    });

    expect(meta).toEqual({ title: "Pricing" });
    expect(seen).toMatchObject({
      title: "Pricing",
      description: "Plans for every team.",
      canonical: "/pricing",
    });
  });

  it("resolves a derived media id into a URL for the preview image", async () => {
    // A block cannot resolve one — its offer is synchronous so metadata never
    // puts a network call between a crawler and the title — so the route does
    // it, through the same resolver the rendered image uses.
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "1", type: "core/image", version: 1, props: { mediaId: "m1" } },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: page },
        { m1: { url: "https://cdn.example/hero.png" } }
      ),
      blocks: coreResolver(),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe("https://cdn.example/hero.png");
  });

  it("leaves the route's own buildMetadata alone when no metadata hook is given", async () => {
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: document }),
      buildMetadata: () => ({ title: "From the caller" }),
    });

    await expect(
      route.generateMetadata({ params: { slug: ["about"] } })
    ).resolves.toEqual({ title: "From the caller" });
  });

  it("does not derive metadata from a condition-gated block", async () => {
    // The renderer prunes it, so its content is deliberately absent from the
    // HTML. Deriving from it would publish the withheld text as the page title
    // — the same leak PB-D25 closed for CSS.
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "1",
          type: "core/heading",
          version: 1,
          props: { text: "Members only" },
          visibility: { conditions: [{ kind: "always", value: false }] },
        } as never,
        {
          id: "2",
          type: "core/heading",
          version: 1,
          props: { text: "Public" },
        },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: page }),
      blocks: coreResolver(),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.title).toBe("Public");
  });

  it("repairs a malformed stored document instead of failing the route", async () => {
    // A row can predate validation or be hand-edited. Walking one unrepaired
    // throws INSIDE generateMetadata, which fails the page rather than
    // rendering the placeholder the render path would have shown.
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: { nodes: "not an array" } }),
      blocks: coreResolver(),
      metadata: () => ({ title: "survived" }),
    });

    await expect(
      route.generateMetadata({ params: { slug: ["about"] } })
    ).resolves.toEqual({ title: "survived" });
  });

  it("falls back to the image's direct src when the media record is missing", async () => {
    // The renderer does exactly this, so metadata that stopped at the
    // unresolvable id would disagree with the picture on the page.
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "1",
          type: "core/image",
          version: 1,
          props: { mediaId: "gone", src: "/fallback.png" },
        },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: page }),
      blocks: coreResolver(),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe("/fallback.png");
  });

  it("treats a scheme-less relative src as a URL, not a media id", async () => {
    // `assets/hero.png` renders fine through the block, so sending it to the
    // media collection would miss and drop the preview image.
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "1",
          type: "core/image",
          version: 1,
          props: { src: "assets/hero.png" },
        },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const instance = reader({ slug: "about", content: page }) as unknown as {
      findByID: ReturnType<typeof vi.fn>;
    };
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
      blocks: coreResolver(),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe("assets/hero.png");
    expect(instance.findByID).not.toHaveBeenCalled();
  });

  it("derives a title from a heading whose stored text is a number", async () => {
    // The renderer normalizes `2024` to text and shows it, so skipping it here
    // would title the page from a later heading the visitor sees second.
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "1", type: "core/heading", version: 1, props: { text: 2024 } },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "y", content: page }),
      blocks: coreResolver(),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["y"] } });

    expect(seen?.title).toBe("2024");
  });

  it("stays anonymous when resolving a reference", async () => {
    // `mergeConfig` spreads the reader's defaults UNDER the call, so omitting
    // `user` inherits whatever identity the reader was booted with — and this
    // route resolves anonymously. `resolveContent` passes it for that reason.
    const instance = reader(
      { slug: "about", content: document },
      { p1: { slug: "contact" } }
    ) as unknown as { findByID: ReturnType<typeof vi.fn> };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });
    await props.context?.resolveEntryPath("pages", "p1");

    expect(instance.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ user: undefined })
    );
  });

  it("keeps an unpublished reference's href on a draft-serving route", async () => {
    // `draft: true` is a route mounted behind the app's own auth: it serves
    // drafts through a trusted read, so visiting the path works and the button
    // must not lose its destination.
    const props = await render({
      collections: ["pages"],
      field: "content",
      draft: true,
      nextly: reader(
        { slug: "about", content: document },
        { d1: { slug: "unreleased", status: "draft" } }
      ),
    });

    await expect(props.context?.resolveEntryPath("pages", "d1")).resolves.toBe(
      "/unreleased"
    );
  });

  it("gives no path when an earlier collection owns the slug", async () => {
    // The route resolves collections in order and stops at the first match, so
    // this href would navigate to a DIFFERENT document under the same URL.
    const instance = reader(
      { slug: "about", content: document },
      { p9: { slug: "shared" } }
    ) as unknown as { find: ReturnType<typeof vi.fn> };
    instance.find = vi.fn(async ({ collection }: { collection: string }) => ({
      items:
        collection === "pages"
          ? [{ slug: "about", content: document }]
          : [{ slug: "shared" }],
      meta: {},
    }));

    const props = await render({
      collections: ["pages", "posts"],
      field: "content",
      nextly: instance as never,
    });

    await expect(
      props.context?.resolveEntryPath("posts", "p9")
    ).resolves.toBeNull();
  });

  it("passes the stored stylesheet through for the resolved entry", async () => {
    const styles = { css: ".a{color:red}", classes: { n1: "a" } };
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: document }),
      styles: () => styles,
    });

    expect(props.styles).toEqual(styles);
  });
});
