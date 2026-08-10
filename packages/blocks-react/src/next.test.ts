/**
 * `createBlocksPage` — the composition, exercised through the real
 * `createContentRoute` rather than around it.
 *
 * A fake READER is injected and everything above it is production code, so
 * these cover the seam that actually breaks: what the route hands the render,
 * and what the render hands the block renderer. Mocking `createContentRoute`
 * itself would assert only that this file calls a function.
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createBlocksPage, DEFAULT_MAX_QUERIES } from "./next";
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
  // Records as a reader actually returns them: the id is a FIELD on the row,
  // not merely the key it was stored under. A double that omitted it would
  // certify a caller that can never identify which row answered.
  const rows: Record<string, unknown>[] = Object.entries(records).map(
    ([id, record]) => ({ id, ...record })
  );

  // The reader owns lifecycle filtering, so the double has to as well — one
  // that ignored `status` would certify a path the product filters out.
  const hidden = (row: Record<string, unknown>, status?: string): boolean =>
    status !== undefined &&
    status !== "all" &&
    typeof row.status === "string" &&
    row.status !== status;

  return {
    find: vi.fn(
      async ({
        collection,
        where,
        status,
      }: {
        collection: string;
        where?: Record<string, { equals?: unknown }>;
        status?: string;
      }) => {
        // A lookup BY ID is a reference resolution.
        const byId = where?.id?.equals;
        if (typeof byId === "string") {
          const found = records[byId];
          return {
            items:
              found && !hidden(found, status) ? [{ id: byId, ...found }] : [],
            meta: {},
          };
        }

        // Anything else is a stored-column query — the route resolving its own
        // path, or an ownership probe. A real reader ANDs every key and
        // understands each operator, so this does too: a double that read only
        // the first key would confirm an ownership question it never asked, and
        // one that answered with the route's page regardless of the value would
        // certify a resolver that never checks what it was handed.
        const clauses = Object.entries(where ?? {});
        const matches = (row: Record<string, unknown>): boolean =>
          clauses.every(([field, condition]) => {
            const test = condition as Record<string, unknown> | undefined;
            if (test && "equals" in test) return row[field] === test.equals;
            if (test && "less_than" in test) {
              return String(row[field]) < String(test.less_than);
            }
            return false;
          });

        const match = rows.find(row => matches(row) && !hidden(row, status));
        if (match) return { items: [match], meta: {} };
        // The route's own page answers a SINGLE-key lookup only. A compound
        // probe that found nothing means nothing matched, and falling through
        // to the entry would answer "yes" to a question about another row.
        return {
          items: clauses.length === 1 && collection === "pages" ? [entry] : [],
          meta: {},
        };
      }
    ),
    findByID: vi.fn(async ({ id }: { id: string }) => records[id] ?? null),
    // A real instance exposes media as its OWN namespace, not as a dynamic
    // collection, so the double has to as well or it certifies a path that
    // fails against the product.
    media: {
      findByID: vi.fn(async ({ id }: { id: string }) => records[id] ?? null),
    },
  } as never;
}

/**
 * A reader over STORED rows, with an `afterRead` hook applied to what it hands
 * back.
 *
 * The distinction the ownership probes depend on: queries match the stored
 * columns, and the hook only reshapes the returned row. A double that applied
 * the hook before matching would be modelling a database that does not exist,
 * and would certify a resolver that reads identity out of hook output.
 */
function compoundReader(
  stored: Record<string, unknown>[],
  afterRead: (row: Record<string, unknown>) => Record<string, unknown>
) {
  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown> | undefined
  ): boolean =>
    Object.entries(where ?? {}).every(([field, condition]) => {
      const test = condition as Record<string, unknown> | undefined;
      if (test && "equals" in test) return row[field] === test.equals;
      if (test && "less_than" in test) {
        return String(row[field]) < String(test.less_than);
      }
      return false;
    });

  return {
    find: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
      // Sorted by stored id, which is how the route settles a duplicate slug.
      const hits = stored
        .filter(row => matches(row, where))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const first = hits[0];
      return {
        items: first ? [afterRead({ content: document, ...first })] : [],
        meta: {},
      };
    }),
    findByID: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
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
          "11111111-1111-4111-8111-111111111111": {
            url: "https://cdn.example/a.png",
            altText: "A cat",
            width: 800,
            height: 600,
          },
        }
      ),
    });

    await expect(
      props.context?.resolveMedia("11111111-1111-4111-8111-111111111111")
    ).resolves.toEqual({
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
        { "22222222-2222-4222-8222-222222222222": { altText: "no url here" } }
      ),
    });

    await expect(
      props.context?.resolveMedia("22222222-2222-4222-8222-222222222222")
    ).resolves.toBeNull();
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
      { "11111111-1111-4111-8111-111111111111": { url: "/a.png" } }
    ) as unknown as { media: { findByID: ReturnType<typeof vi.fn> } };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });
    await props.context?.resolveMedia("11111111-1111-4111-8111-111111111111");

    expect(instance.media.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" })
    );
  });

  it("reads default media through the media namespace, not as a collection", async () => {
    // Media is a system table with its own reader. Going through the generic
    // collection path finds nothing on a standard install, so the advertised
    // default resolver would never resolve an ordinary Nextly media record.
    const instance = reader(
      { slug: "about", content: document },
      {
        "11111111-1111-4111-8111-111111111111": { url: "/a.png", altText: "A" },
      }
    ) as unknown as {
      findByID: ReturnType<typeof vi.fn>;
      media: { findByID: ReturnType<typeof vi.fn> };
    };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });
    await expect(
      props.context?.resolveMedia("11111111-1111-4111-8111-111111111111")
    ).resolves.toEqual({
      url: "/a.png",
      alt: "A",
    });

    expect(instance.media.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" })
    );
    expect(instance.findByID).not.toHaveBeenCalled();
  });

  it("reads a NAMED media collection as a collection", async () => {
    // An explicitly named one IS a dynamic collection — a site storing images
    // of its own — so it must not be sent to the media namespace.
    const instance = reader(
      { slug: "about", content: document },
      { "66666666-6666-4666-8666-666666666666": { url: "/own.png" } }
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
    await props.context?.resolveMedia("66666666-6666-4666-8666-666666666666");

    expect(instance.findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "photos",
        id: "66666666-6666-4666-8666-666666666666",
      })
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
        {
          id: "1",
          type: "core/image",
          version: 1,
          props: { mediaId: "33333333-3333-4333-8333-333333333333" },
        },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: page },
        {
          "33333333-3333-4333-8333-333333333333": {
            url: "https://cdn.example/hero.png",
          },
        }
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
          props: {
            mediaId: "44444444-4444-4444-8444-444444444444",
            src: "/fallback.png",
          },
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
      { "66666666-6666-4666-8666-666666666666": { slug: "contact" } }
    ) as unknown as { find: ReturnType<typeof vi.fn> };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });
    await props.context?.resolveEntryPath(
      "pages",
      "66666666-6666-4666-8666-666666666666"
    );

    expect(instance.find).toHaveBeenCalledWith(
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

  it("describes nothing when the stored format is unsupported", async () => {
    // The renderer shows only its unsupported-format placeholder, so a title
    // derived from the nodes inside would describe content never displayed.
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader({
        slug: "about",
        content: {
          formatVersion: 999,
          kind: "page",
          nodes: [
            {
              id: "1",
              type: "core/heading",
              version: 1,
              props: { text: "Hi" },
            },
          ],
        },
      }),
      metadata: (_e, _c, derived) => ({ title: derived.title ?? "none" }),
    });

    await expect(
      route.generateMetadata({ params: { slug: ["about"] } })
    ).resolves.toEqual({ title: "none" });
  });

  it("falls back to a later image when the first cannot be resolved", async () => {
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "1",
          type: "core/image",
          version: 1,
          props: { mediaId: "44444444-4444-4444-8444-444444444444" },
        },
        {
          id: "2",
          type: "core/image",
          version: 1,
          props: { mediaId: "55555555-5555-4555-8555-555555555555" },
        },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader(
        { slug: "about", content: page },
        { "55555555-5555-4555-8555-555555555555": { url: "/second.png" } }
      ),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe("/second.png");
  });

  it("sanitizes with the caps the style context carries", async () => {
    // The renderer uses `limits ?? styleContext.limits ?? DEFAULT`. Omitting the
    // styleContext fallback derived metadata from a DIFFERENT tree than the one
    // rendered — so this pins that the styleContext value is the one applied.
    //
    // A cap of 1 makes the two answers differ: under it only the first node
    // survives and there is no title, while under the default both survive and
    // the second node supplies one. A cap that changed nothing would pass
    // whether or not the fallback is consulted.
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      styleContext: { limits: { ...DEFAULT_LIMITS, maxNodes: 1 } } as never,
      nextly: reader({
        slug: "about",
        content: {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "page",
          nodes: [
            { id: "a", type: "core/box", version: 1, props: {} },
            {
              id: "b",
              type: "core/heading",
              version: 1,
              props: { text: "Beyond the cap" },
            },
          ],
        },
      }),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.title).toBeUndefined();
  });

  it("gives no path for a collection this route does not serve", async () => {
    // The route searches only its configured collections, so the href would
    // 404 or open an unrelated entry that happens to share the slug.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { x1: { slug: "elsewhere" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("posts", "x1")
    ).resolves.toBeNull();
  });

  it("keeps a link from a status-less collection holding a `status` field", async () => {
    // Nextly supports an ordinary string field named `status`. Judging it as
    // the lifecycle column made the route drop links to entries it happily
    // serves — so lifecycle filtering belongs to the reader, not to us. A
    // status-LESS collection answers regardless of the scope requested.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { a1: { slug: "archive", status: "archived" } }
      ),
      status: "all",
    });

    await expect(props.context?.resolveEntryPath("pages", "a1")).resolves.toBe(
      "/archive"
    );
  });
  it("gives no path for a reserved route path", async () => {
    // `ContentPage` refuses these before resolving anything, and they may lead
    // into a route the application owns.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { r1: { slug: "robots.txt" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "r1")
    ).resolves.toBeNull();
  });

  it("answers null rather than throwing for a stale reference", async () => {
    // `resolveEntryPath` promises null. The built-in button catches everything,
    // so a throw looked harmless; a custom block would get a rejected promise.
    const instance = reader({
      slug: "about",
      content: document,
    }) as unknown as {
      find: (args: { where?: { id?: unknown } }) => Promise<unknown>;
    };
    const base = instance.find.bind(instance);
    instance.find = async (args: { where?: { id?: unknown } }) => {
      // Only a reference lookup rejects; the route's own path read must still
      // succeed, or the test would prove nothing about the reference path.
      if (args.where?.id !== undefined) throw new Error("NOT_FOUND");
      return base(args);
    };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });

    await expect(
      props.context?.resolveEntryPath(
        "pages",
        "44444444-4444-4444-8444-444444444444"
      )
    ).resolves.toBeNull();
  });

  it("keeps a UUID-shaped direct src instead of looking it up", async () => {
    // No shape predicate can get this right, which is why provenance travels:
    // the block read this out of `src`, so it is an address however it looks.
    const uuidLikeSrc = "550e8400-e29b-41d4-a716-446655440000";
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "1",
          type: "core/image",
          version: 1,
          props: { src: uuidLikeSrc },
        },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const instance = reader({ slug: "about", content: page }) as unknown as {
      media: { findByID: ReturnType<typeof vi.fn> };
    };
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: instance as never,
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe(uuidLikeSrc);
    expect(instance.media.findByID).not.toHaveBeenCalled();
  });

  it("keeps an extensionless relative image source", async () => {
    // The renderer accepts a bare `hero` as an <img src>, so classifying it as
    // a media id sent it to the media reader, missed, and dropped the preview.
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "1", type: "core/image", version: 1, props: { src: "hero" } },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader({ slug: "about", content: page }),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe("hero");
  });

  it("percent-encodes each canonical segment", async () => {
    // Next hands this route the DECODED segments while the request used their
    // encoded form, so a slug holding `?` would produce a canonical a URL
    // consumer reads as a query rather than as the page's path.
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader({ slug: "faq?all", content: document }),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["help", "faq?all"] } });

    expect(seen?.canonical).toBe("/help/faq%3Fall");
  });

  it("omits the canonical for a slug holding a dot segment", async () => {
    // A canonical claims where this page lives, and every candidate answer for
    // such a slug names a DIFFERENT route: URL resolution removes `.` and `..`
    // before the request is sent, so `/pages/../admin` is fetched as `/admin`.
    // Percent-encoding does not rescue it either — the URL standard counts
    // `%2e` as a dot for exactly this purpose. Saying nothing is the only
    // honest answer, and the KEY is absent rather than undefined so a caller's
    // own canonical is not erased by spreading this over it.
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader({ slug: "pages/../admin", content: document }),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({
      params: { slug: ["pages", "..", "admin"] },
    });

    expect(seen).toBeDefined();
    expect("canonical" in (seen ?? {})).toBe(false);
  });

  it("omits the canonical for a slug the route would normalize", async () => {
    // Next answers `/a//b` with a 308 to `/a/b`, and the lookup then asks for
    // the slug `a/b`, which this entry does not have. The normalized path names
    // a page the route answers with notFound(); the raw one redirects away from
    // it. Neither is where this page lives.
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader({ slug: "a//b", content: document }),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["a", "", "b"] } });

    expect("canonical" in (seen ?? {})).toBe(false);
  });

  it("gives no path for a referenced slug the route would normalize", async () => {
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { doubled: { slug: "a//b" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "doubled")
    ).resolves.toBeNull();
  });

  it("keeps searching when a caller's resolver answers without a usable url", async () => {
    // `resolveMedia` may be the caller's own, so its answer is third-party data
    // however the type reads: a JavaScript one returning a missing `Map.get`
    // answers `undefined`. The RENDERER treats that as unresolved and falls back
    // to the block's own `src`, so counting it as a hit would leave metadata
    // describing no image while the page displays one.
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/image",
          version: 1,
          props: { mediaId: "44444444-4444-4444-8444-444444444444" },
        },
        {
          id: "n2",
          type: "core/image",
          version: 1,
          props: { src: "/later.png" },
        },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader({ slug: "about", content: page }),
      // Answering the way an untyped implementation does. Built through
      // `JSON.parse` because that is genuinely how a record with a missing
      // field arrives, and it needs no cast to express: a JavaScript resolver
      // returning a partial record, or a missing `Map.get`, produces exactly
      // this class of answer.
      resolveMedia: async () => JSON.parse('{"alt":"no url here"}'),
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe("/later.png");
  });

  it("keeps a link when a hook rewrites the ids it returns", async () => {
    // Ownership is settled on STORED columns, so what `afterRead` does to the
    // `id` it RETURNS cannot reach the decision. This double rewrites every
    // returned id and the link still resolves.
    const stored = [
      { id: "home", slug: "about" },
      { id: "p9", slug: "contact" },
    ];
    const instance = compoundReader(stored, row => ({
      ...row,
      id: `hook:${String(row.id)}`,
    })) as unknown as { find: ReturnType<typeof vi.fn> };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });

    await expect(props.context?.resolveEntryPath("pages", "p9")).resolves.toBe(
      "/contact"
    );
  });
  it("is not fooled by a hook that maps different rows onto one id", async () => {
    // The case that defeats comparing two POST-hook identities: a non-injective
    // rewrite makes two DIFFERENT stored rows compare equal, so a reference to
    // the losing duplicate would emit an href that opens the winner. Asking the
    // database about the stored id instead cannot be fooled by it.
    const stored = [
      { id: "home", slug: "about" },
      { id: "aaa", slug: "shared" },
      { id: "bbb", slug: "shared" },
    ];
    const instance = compoundReader(stored, row => ({
      ...row,
      id: "same-for-everyone",
    })) as unknown as { find: ReturnType<typeof vi.fn> };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });

    // `aaa` is the row the route serves for this slug, so it keeps its link.
    await expect(props.context?.resolveEntryPath("pages", "aaa")).resolves.toBe(
      "/shared"
    );
    // `bbb` is the duplicate the route would NOT serve.
    await expect(
      props.context?.resolveEntryPath("pages", "bbb")
    ).resolves.toBeNull();
  });
  it("gives a routed page a finite query budget", async () => {
    // `core/collection-loop` claims from `ctx.queries` before each read and its
    // check is `ctx.queries?.take() === false`, so an ABSENT budget reads as
    // unlimited. Depth becomes multiplication: nested loops over a hundred
    // entries each turn one page view into millions of reads, and a route
    // helper is where a page becomes reachable by anyone holding a URL.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader({ slug: "about", content: document }),
    });

    expect(props.context?.queries).toBeDefined();
    expect(props.context?.queries?.take()).toBe(true);
  });

  it("stops granting reads once the budget is spent", async () => {
    const props = await render({
      collections: ["pages"],
      field: "content",
      maxQueries: 2,
      nextly: reader({ slug: "about", content: document }),
    });

    expect(props.context?.queries?.take()).toBe(true);
    expect(props.context?.queries?.take()).toBe(true);
    expect(props.context?.queries?.take()).toBe(false);
  });

  it("falls back to the default when maxQueries is not a number", async () => {
    // `Number(process.env.MAX_QUERIES)` on an unset variable is `NaN`, and every
    // comparison against it is false — so `remaining <= 0` never fires and the
    // budget silently becomes unlimited. A configuration mistake would defeat
    // the bound entirely.
    const props = await render({
      collections: ["pages"],
      field: "content",
      maxQueries: Number.NaN,
      nextly: reader({ slug: "about", content: document }),
    });

    const budget = props.context?.queries;
    for (let i = 0; i < DEFAULT_MAX_QUERIES; i += 1) {
      expect(budget?.take()).toBe(true);
    }
    expect(budget?.take()).toBe(false);
  });

  it("spends the page budget on media reads too", async () => {
    // The budget is documented as covering the reads one page render performs.
    // A page whose images all resolve through the media library spends the same
    // budget a loop does, so counting only loop reads would leave the
    // documented bound false.
    const id = "33333333-3333-4333-8333-333333333333";
    const props = await render({
      collections: ["pages"],
      field: "content",
      maxQueries: 1,
      nextly: reader(
        { slug: "about", content: document },
        { [id]: { url: "/a.png" } }
      ),
    });

    await expect(props.context?.resolveMedia(id)).resolves.toEqual({
      url: "/a.png",
    });
    // Budget spent: the next read resolves to no picture rather than issuing.
    await expect(props.context?.resolveMedia(id)).resolves.toBeNull();
  });

  it("withholds a link once the page budget is spent", async () => {
    // `resolveEntryPath` performs a read plus two ownership probes, so a loop
    // over N entries whose template holds one link is about 3N reads — exactly
    // the amplification the budget exists to bound. An exhausted budget
    // withholds the href, the direction every other uncertainty here takes.
    const props = await render({
      collections: ["pages"],
      field: "content",
      // ONE read: enough for the entry lookup, so the ownership probes are
      // what run out. A budget of zero would stop before the probes and pass
      // this test without ever reaching the claim it is about.
      maxQueries: 1,
      nextly: reader(
        { slug: "about", content: document },
        { p9: { slug: "contact" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "p9")
    ).resolves.toBeNull();
  });

  it("gives each render its OWN budget", async () => {
    // One budget shared across requests would spend itself on the first few
    // pages and serve every later request truncated — a fault that grows with
    // uptime and vanishes on restart.
    const config = {
      collections: ["pages"],
      field: "content",
      maxQueries: 1,
      nextly: reader({ slug: "about", content: document }),
    };
    const route = createBlocksPage(config);

    const first = (await route.ContentPage({
      params: { slug: ["about"] },
    })) as ReactElement<PageRendererProps>;
    const second = (await route.ContentPage({
      params: { slug: ["about"] },
    })) as ReactElement<PageRendererProps>;

    expect(first.props.context?.queries?.take()).toBe(true);
    expect(first.props.context?.queries?.take()).toBe(false);
    // The second render is unaffected by what the first spent.
    expect(second.props.context?.queries?.take()).toBe(true);
  });

  it("forwards the host policy to the renderer", async () => {
    // Site-operator posture, not content: an embed needing `allow-same-origin`
    // for an approved origin loses that capability if moving behind this route
    // helper silently drops the policy the standalone renderer was given.
    const hostPolicy = { trustedFrameOrigins: ["https://maps.example"] };
    const props = await render({
      collections: ["pages"],
      field: "content",
      hostPolicy,
      nextly: reader({ slug: "about", content: document }),
    });

    expect(props.hostPolicy).toEqual(hostPolicy);
  });

  it("normalizes a custom resolver's blank url for the RENDER too", async () => {
    // The derivation rejected a blank URL and moved on while `renderImage` took
    // the same non-nullish value and emitted it, so the preview picture and the
    // page picture disagreed. One resolver answers both, so the rule belongs
    // where they meet.
    const props = await render({
      collections: ["pages"],
      field: "content",
      resolveMedia: async () => ({ url: "   " }),
      nextly: reader({ slug: "about", content: document }),
    });

    await expect(props.context?.resolveMedia("any-id")).resolves.toBeNull();
  });

  it("refuses a link to the losing row of a duplicated slug", async () => {
    // Two entries in one collection may share a slug, and `resolveContent`
    // settles which the URL opens by sorting on `id`. The probe asks the same
    // question as a range over the stored column — is there a lower id at this
    // slug — rather than by comparing rows the hooks have already touched.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { dup1: { slug: "shared" }, dup2: { slug: "shared" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "dup2")
    ).resolves.toBeNull();
    await expect(
      props.context?.resolveEntryPath("pages", "dup1")
    ).resolves.toBe("/shared");
  });
  it("gives no path for a referenced slug holding a dot segment", async () => {
    // A link may simply be omitted, so it is refused rather than encoded: no
    // link beats one a browser resolves to `/admin`. The reserved-path check
    // cannot catch this, because it reads the slug BEFORE that resolution.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { sneaky: { slug: "pages/../admin" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "sneaky")
    ).resolves.toBeNull();
  });

  it("gives no path when a hook rewrote the slug the route matches on", async () => {
    // `resolveContent` matches the STORED column while the read returns the
    // post-`afterRead` value. A hook rewriting `about` to `public/about` would
    // otherwise emit `/public/about`, which this same route answers with
    // `notFound()`. The stored row is asked for directly instead.
    const stored = [{ id: "p9", slug: "about" }];
    const instance = compoundReader(stored, row => ({
      ...row,
      slug: `public/${String(row.slug)}`,
    })) as unknown as { find: ReturnType<typeof vi.fn> };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
    });

    await expect(
      props.context?.resolveEntryPath("pages", "p9")
    ).resolves.toBeNull();
  });
  it("treats a blank media URL as unresolved", async () => {
    // A record with an empty URL would otherwise be PREFERRED over the block's
    // own `src`, and `<img src="">` re-requests the current page in some
    // browsers; metadata would stop here rather than try the next candidate.
    const blank = "99999999-9999-4999-8999-999999999999";
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { [blank]: { url: "   " } }
      ),
    });

    await expect(props.context?.resolveMedia(blank)).resolves.toBeNull();
  });

  it("reads a named media collection in the route's locale", async () => {
    // A named collection is an ordinary collection, so its URL and alt fields
    // can be localized. Omitting the locale reads the DEFAULT locale's record
    // on a route configured for another one.
    const instance = reader({
      slug: "about",
      content: document,
    }) as unknown as {
      findByID: ReturnType<typeof vi.fn>;
    };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
      mediaCollection: "photos",
      locale: "fr",
    });
    await props.context?.resolveMedia("66666666-6666-4666-8666-666666666666");

    expect(instance.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "photos", locale: "fr" })
    );
  });

  it("takes the earliest usable image, not the fastest lookup", async () => {
    // Resolved concurrently, so completion order is not document order. The
    // renderer shows the earliest usable image; picking whichever request
    // finished first would publish a different picture than the page displays,
    // silently and only under load.
    const early = "77777777-7777-4777-8777-777777777777";
    const late = "88888888-8888-4888-8888-888888888888";
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "1", type: "core/image", version: 1, props: { mediaId: early } },
        { id: "2", type: "core/image", version: 1, props: { mediaId: late } },
      ],
    };
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader({ slug: "about", content: page }),
      // The EARLIER id answers slowly and the later one immediately, so a
      // first-to-finish implementation would choose the wrong picture.
      resolveMedia: async (id: string) => {
        if (id === late) return { url: "/late.png" };
        await new Promise(resolve => setTimeout(resolve, 20));
        return { url: "/early.png" };
      },
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe("/early.png");
  });

  it("does not resolve missing media one round trip at a time", async () => {
    // A page whose first images all reference deleted media paid a lookup each
    // before reaching a usable one, inside `generateMetadata` — enough of them
    // and the page times out instead of rendering with a later good image.
    const missing = Array.from(
      { length: 5 },
      (_, i) => `9999999${i}-9999-4999-8999-999999999999`
    );
    const good = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [...missing, good].map((mediaId, i) => ({
        id: `n${i}`,
        type: "core/image",
        version: 1,
        props: { mediaId },
      })),
    };
    let inFlight = 0;
    let peak = 0;
    let seen: DerivedPageSeo | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks: coreResolver(),
      nextly: reader({ slug: "about", content: page }),
      resolveMedia: async (id: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight -= 1;
        return id === good ? { url: "/good.png" } : null;
      },
      metadata: (_e, _c, derived) => {
        seen = derived;
        return {};
      },
    });

    await route.generateMetadata({ params: { slug: ["about"] } });

    expect(seen?.image).toBe("/good.png");
    // Serial resolution never exceeds one concurrent lookup.
    expect(peak).toBeGreaterThan(1);
  });

  it("honours an explicit status even on a draft-serving route", async () => {
    // `createContentRoute` passes the configured status through, where it beats
    // draft widening — so forcing `all` here would offer an href for an entry
    // the same route refuses to serve.
    const props = await render({
      collections: ["pages"],
      field: "content",
      draft: true,
      status: "published",
      nextly: reader(
        { slug: "about", content: document },
        { never: { slug: "never-published", status: "draft" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "never")
    ).resolves.toBeNull();
  });

  it("gives no path for a slug that would leave the site", async () => {
    // A slug is stored TEXT, so it can begin with `/`. `//evil.example`
    // interpolates to `///evil.example`, which browsers read as a
    // protocol-relative URL to another host — an "internal" reference that
    // navigates off-site.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { evil: { slug: "//evil.example" } }
      ),
    });

    await expect(
      props.context?.resolveEntryPath("pages", "evil")
    ).resolves.toBeNull();
  });

  it("percent-encodes a referenced entry's path too", async () => {
    // The canonical was encoded earlier; this resolver returned raw text, so a
    // button navigated to `/faq?all` while the route serves `/faq%3Fall`.
    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: reader(
        { slug: "about", content: document },
        { q1: { slug: "help/faq?all" } }
      ),
    });

    await expect(props.context?.resolveEntryPath("pages", "q1")).resolves.toBe(
      "/help/faq%3Fall"
    );
  });

  it("stays anonymous when reading a named media collection", async () => {
    // On an overrideAccess route a user-sensitive afterRead hook would bake a
    // personalized URL or alt text into the PUBLIC cached page.
    const instance = reader(
      { slug: "about", content: document },
      { "66666666-6666-4666-8666-666666666666": { url: "/own.png" } }
    ) as unknown as { findByID: ReturnType<typeof vi.fn> };

    const props = await render({
      collections: ["pages"],
      field: "content",
      nextly: instance as never,
      mediaCollection: "photos",
    });
    await props.context?.resolveMedia("66666666-6666-4666-8666-666666666666");

    expect(instance.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "photos", user: undefined })
    );
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
