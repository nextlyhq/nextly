/**
 * The draft layers a preview has to honour, against a real boot.
 *
 * The shipped model is two-layered and they fail differently:
 *
 * - `status` covers an entry that has NEVER been published.
 * - The working draft covers pending edits on an ALREADY-published entry, which
 *   live in a sidecar row the live table knows nothing about.
 *
 * A preview that only widened `status` would satisfy the first and silently
 * fail the second — showing a published page's live content while the edits
 * being previewed stay invisible. These prove both layers move together, and
 * that neither reaches a visitor who is not previewing.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createContentRoute, createPublicContentRoute } from "../content-route";
import { resolveContent } from "../resolve-content";
import type { ContentEntry } from "../resolve-content";

const pages = () =>
  defineCollection({
    slug: "pages",
    status: true,
    versions: { drafts: true },
    fields: [text({ name: "slug" }), text({ name: "title" })],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function route(
  nextly: TestNextly["nextly"],
  draft?:
    | boolean
    | ((context: {
        collection: string;
        slug: string;
      }) => boolean | Promise<boolean>)
) {
  return createContentRoute({
    collections: ["pages"],
    nextly,
    render: (entry: ContentEntry) => entry,
    ...(draft === undefined ? {} : { draft }),
  });
}

/**
 * The same route, declared public — the only shape that pre-renders.
 *
 * An access-enforced route answers per visitor, so it has no set of paths to
 * build and is handed no `generateStaticParams`. A test about pre-rendering has
 * to say which posture it is testing.
 */
function publicRoute(
  nextly: TestNextly["nextly"],
  draft?:
    | boolean
    | ((context: {
        collection: string;
        slug: string;
      }) => boolean | Promise<boolean>)
) {
  return createPublicContentRoute({
    collections: ["pages"],
    nextly,
    render: (entry: ContentEntry) => entry,
    ...(draft === undefined ? {} : { draft }),
  });
}

describe("createContentRoute + draft layers (integration)", () => {
  it("shows pending edits to a preview and live content to everyone else", async () => {
    current = await createTestNextly({ collections: [pages()] });
    const created = await current.nextly.create({
      collection: "pages",
      data: { slug: "about", title: "Live", status: "published" },
    });

    // An update that names no status on a published document is
    // non-destructive: the live row keeps its title and the edit becomes the
    // working draft.
    await current.nextly.update({
      collection: "pages",
      id: String(created.item.id),
      data: { title: "Pending edit" },
    });

    const publicPage = (await route(current.nextly).ContentPage({
      params: { slug: ["about"] },
    })) as ContentEntry;
    expect(publicPage.title).toBe("Live");
    expect(publicPage._isWorkingDraft).toBeUndefined();

    const previewPage = (await route(current.nextly, true).ContentPage({
      params: { slug: ["about"] },
    })) as ContentEntry;
    expect(previewPage.title).toBe("Pending edit");
    expect(previewPage._isWorkingDraft).toBe(true);
  });

  it("shows a never-published entry to a preview and 404s it publicly", async () => {
    // The other layer. Widening `status` is what covers this one, and a
    // preview needs both — hence `draft` widening the scope with it.
    current = await createTestNextly({ collections: [pages()] });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    await expect(
      route(current.nextly).ContentPage({ params: { slug: ["unreleased"] } })
    ).rejects.toThrow();

    const previewPage = (await route(current.nextly, true).ContentPage({
      params: { slug: ["unreleased"] },
    })) as ContentEntry;
    expect(previewPage.title).toBe("Unreleased");
  });

  it("grants a draft only at the path the decision names", async () => {
    // The scope that a preview token carries has to survive the trip. Next's
    // draft mode cannot express it — one boolean for the whole host — so a
    // route answering from `isEnabled` alone would hand a link for one page the
    // drafts of every other.
    current = await createTestNextly({ collections: [pages()] });
    for (const slug of ["granted", "other"]) {
      const created = await current.nextly.create({
        collection: "pages",
        data: { slug, title: `${slug} live`, status: "published" },
      });
      await current.nextly.update({
        collection: "pages",
        id: String(created.item.id),
        data: { title: `${slug} pending` },
      });
    }

    const scoped = route(current.nextly, ({ slug }) => slug === "granted");

    expect(
      (
        (await scoped.ContentPage({
          params: { slug: ["granted"] },
        })) as ContentEntry
      ).title
    ).toBe("granted pending");
    expect(
      (
        (await scoped.ContentPage({
          params: { slug: ["other"] },
        })) as ContentEntry
      ).title
    ).toBe("other live");
  });

  it("does not publish a never-published entry to an untrusted draft read", async () => {
    // Widening the lifecycle scope is gated by nothing per row, so it follows
    // trust rather than the draft flag. `resolveContent` called with `draft`
    // alone must not surface an entry that has never been published.
    current = await createTestNextly({ collections: [pages()] });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    expect(
      await resolveContent("pages", "unreleased", {
        nextly: current.nextly,
        draft: true,
      })
    ).toBeNull();
  });

  it("keeps drafts out of the paths a build pre-renders", async () => {
    // `generateStaticParams` runs where there is no visitor to gate. A draft
    // baked into a static path is published to everyone, permanently.
    current = await createTestNextly({ collections: [pages()] });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "about", title: "About", status: "published" },
    });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "unreleased", title: "Unreleased", status: "draft" },
    });

    // No `draft` — a public route refuses it, because a draft read is never
    // cacheable and would mark a render Next has classified static. The
    // guarantee that survives is the one this test was always really about:
    // `status` is what keeps an unpublished entry out of a built path.
    const params = await publicRoute(current.nextly).generateStaticParams();

    expect(params).toContainEqual({ slug: ["about"] });
    expect(params).not.toContainEqual({ slug: ["unreleased"] });
  });

  it("follows the decision from request to request", async () => {
    // The whole reason the decision is a function: one route object serves both
    // the visitor and the editor, and the answer changes between them.
    current = await createTestNextly({ collections: [pages()] });
    const created = await current.nextly.create({
      collection: "pages",
      data: { slug: "about", title: "Live", status: "published" },
    });
    await current.nextly.update({
      collection: "pages",
      id: String(created.item.id),
      data: { title: "Pending edit" },
    });

    let previewing = false;
    const shared = route(current.nextly, () => previewing);

    expect(
      (
        (await shared.ContentPage({
          params: { slug: ["about"] },
        })) as ContentEntry
      ).title
    ).toBe("Live");

    previewing = true;
    expect(
      (
        (await shared.ContentPage({
          params: { slug: ["about"] },
        })) as ContentEntry
      ).title
    ).toBe("Pending edit");

    previewing = false;
    expect(
      (
        (await shared.ContentPage({
          params: { slug: ["about"] },
        })) as ContentEntry
      ).title
    ).toBe("Live");
  });
});
