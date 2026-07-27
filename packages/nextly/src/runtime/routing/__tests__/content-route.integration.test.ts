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
import { createContentRoute } from "../content-route";
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
  it("lists published paths (segmented) and excludes drafts", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);

    const params = await route(current.nextly).generateStaticParams();
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

    const params = await route(current.nextly).generateStaticParams();
    expect(params).not.toContainEqual({ slug: ["admin"] });
    expect(params).toContainEqual({ slug: ["about"] });
  });

  it("renders a resolved entry via the render callback", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await seed(current.nextly);

    const rendered = await route(current.nextly).ContentPage({
      params: { slug: ["about"] },
    });
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
