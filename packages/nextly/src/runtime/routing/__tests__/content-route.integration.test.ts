/**
 * `createContentRoute` against a real boot: `generateStaticParams` lists
 * published paths (segmented, drafts excluded), the page renders a resolved
 * entry, a genuine miss and a reserved path trigger `notFound`, and
 * `generateMetadata` maps the resolved entry.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createContentRoute, createPublicContentRoute } from "../content-route";
import type { ContentEntry } from "../resolve-content";

const pages = () =>
  defineCollection({
    slug: "pages",
    status: true,
    fields: [text({ name: "slug" }), text({ name: "title" })],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function route(nextly: TestNextly["nextly"]) {
  return createContentRoute({
    collections: ["pages"],
    nextly,
    render: (entry: ContentEntry) => ({ title: entry.title }),
    buildMetadata: (entry: ContentEntry) => ({ title: String(entry.title) }),
  });
}

/**
 * The same route, declared public.
 *
 * Only a public route pre-renders, so only a public route is handed a
 * `generateStaticParams` — an access-enforced one answers per visitor and has
 * no set of paths to build. Kept separate from `route` rather than folded into
 * it so the tests that exercise resolution keep the default posture.
 */
function publicRoute(nextly: TestNextly["nextly"]) {
  return createPublicContentRoute({
    collections: ["pages"],
    nextly,
    render: (entry: ContentEntry) => ({ title: entry.title }),
  });
}

async function seed(nextly: TestNextly["nextly"]) {
  await nextly.create({
    collection: "pages",
    data: { slug: "about", title: "About", status: "published" },
  });
  await nextly.create({
    collection: "pages",
    data: { slug: "contact", title: "Contact", status: "published" },
  });
  await nextly.create({
    collection: "pages",
    data: { slug: "secret", title: "Secret", status: "draft" },
  });
}

describe("createContentRoute (integration)", () => {
  it("mixes a lifecycle collection with a status-less one under one status scope", async () => {
    // `pages` has the lifecycle (filtered to published); `docs` is status-less
    // with its OWN `status` field. The lifecycle-aware `status` scope filters
    // `pages` but is a no-op on `docs`, so both are served correctly by one route.
    current = await createTestNextly({
      collections: [
        pages(),
        defineCollection({
          slug: "docs",
          fields: [
            text({ name: "slug" }),
            text({ name: "title" }),
            text({ name: "status" }),
          ],
        }),
      ],
    });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "about", title: "About", status: "published" },
    });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "hidden", title: "Hidden", status: "draft" },
    });
    await current.nextly.create({
      collection: "docs",
      data: { slug: "intro", title: "Intro", status: "active" },
    });

    const { ContentPage } = createContentRoute({
      collections: ["pages", "docs"],
      nextly: current.nextly,
      render: (entry: ContentEntry) => ({ title: entry.title }),
    });

    // Lifecycle collection: published resolves, draft is not found.
    expect(await ContentPage({ params: { slug: ["about"] } })).toEqual({
      title: "About",
    });
    await expect(
      ContentPage({ params: { slug: ["hidden"] } })
    ).rejects.toThrow();
    // Status-less collection: resolved despite its non-"published" status.
    expect(await ContentPage({ params: { slug: ["intro"] } })).toEqual({
      title: "Intro",
    });
  });

  it("lists published paths (segmented) and excludes drafts", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);

    const params = await publicRoute(current.nextly).generateStaticParams();
    expect(params).toContainEqual({ slug: ["about"] });
    expect(params).toContainEqual({ slug: ["contact"] });
    expect(params).not.toContainEqual({ slug: ["secret"] });
  });

  it("excludes published entries whose slug is a reserved path", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);
    // A published entry sitting on a framework path must never be pre-rendered:
    // `ContentPage` always notFound()s it, so the param would build an unservable page.
    await current.nextly.create({
      collection: "pages",
      data: { slug: "admin", title: "Admin", status: "published" },
    });

    const params = await publicRoute(current.nextly).generateStaticParams();
    expect(params).not.toContainEqual({ slug: ["admin"] });
    expect(params).toContainEqual({ slug: ["about"] });
  });

  it("refuses a public route that would pre-render nothing", async () => {
    current = await createTestNextly({ collections: [pages()] });
    // `staticParamsLimit: 0` asks for a static route that builds no paths. The
    // generator would return `[]` — accepted by standard App Router builds and
    // rejected outright by Next 16 Cache Components — so the contradiction is
    // refused where it is stated rather than at build time.
    expect(() =>
      createPublicContentRoute({
        collections: ["pages"],
        nextly: current!.nextly,
        render: (entry: ContentEntry) => ({ title: entry.title }),
        staticParamsLimit: 0,
      })
    ).toThrow(/pre-render nothing/i);
  });

  it("refuses a public route that also serves drafts", async () => {
    current = await createTestNextly({ collections: [pages()] });
    // A draft read is never cacheable, so it marks the render dynamic — while a
    // public route's `generateStaticParams` tells Next the route is static. That
    // is the same contradiction the split exists to remove, arriving through a
    // different option, so it is refused rather than left to 500 per request.
    expect(() =>
      createPublicContentRoute({
        collections: ["pages"],
        nextly: current!.nextly,
        render: (entry: ContentEntry) => ({ title: entry.title }),
        draft: true,
      })
    ).toThrow(/cannot serve drafts/i);
  });

  it("still pre-renders nothing on a DYNAMIC route with a zero limit", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);
    // The dynamic factory has no `generateStaticParams` to disable, so a zero
    // limit is simply not a thing it can contradict. Asserted so the guard above
    // is not read as "zero limits are illegal" — they are illegal only where a
    // route has claimed it is static.
    const route = createContentRoute({
      collections: ["pages"],
      nextly: current.nextly,
      render: (entry: ContentEntry) => ({ title: entry.title }),
      staticParamsLimit: 0,
    });
    expect("generateStaticParams" in route).toBe(false);
  });

  it("renders a resolved entry via the render callback", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);

    const rendered = await route(current.nextly).ContentPage({
      params: { slug: ["about"] },
    });
    expect(rendered).toEqual({ title: "About" });
  });

  it("awaits an async render callback (no nested promise)", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);
    // An async render must resolve to the awaited value, not a Promise of one.
    const rendered = await createContentRoute({
      collections: ["pages"],
      nextly: current.nextly,
      render: async (entry: ContentEntry) => ({ title: entry.title }),
    }).ContentPage({ params: { slug: ["about"] } });
    expect(rendered).toEqual({ title: "About" });
  });

  it("triggers notFound for a genuine miss and a reserved path", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);
    const { ContentPage } = route(current.nextly);

    await expect(
      ContentPage({ params: { slug: ["missing"] } })
    ).rejects.toThrow();
    // A draft is not published → notFound.
    await expect(
      ContentPage({ params: { slug: ["secret"] } })
    ).rejects.toThrow();
    // A reserved path must never resolve to content.
    await expect(
      ContentPage({ params: { slug: ["admin"] } })
    ).rejects.toThrow();
  });

  it("maps the resolved entry in generateMetadata, and returns {} on a miss", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);
    const { generateMetadata } = route(current.nextly);

    expect(await generateMetadata({ params: { slug: ["about"] } })).toEqual({
      title: "About",
    });
    expect(await generateMetadata({ params: { slug: ["missing"] } })).toEqual(
      {}
    );
  });
});
