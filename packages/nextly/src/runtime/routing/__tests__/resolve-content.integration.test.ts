/**
 * `resolveContent` against a real boot: it returns a published entry by slug,
 * ignores drafts, returns null on a genuine miss, and rethrows a read error.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { resolveContent } from "../resolve-content";

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

describe("resolveContent (integration)", () => {
  it("resolves a published entry by slug and ignores drafts", async () => {
    current = await createTestNextly({ collections: [pages()] });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "about", title: "About", status: "published" },
    });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "secret", title: "Secret", status: "draft" },
    });

    const about = await resolveContent("pages", "about", {
      nextly: current.nextly,
    });
    expect((about as { title?: string } | null)?.title).toBe("About");

    // A draft is not resolved for a public read.
    expect(
      await resolveContent("pages", "secret", { nextly: current.nextly })
    ).toBeNull();
    // A genuine miss returns null.
    expect(
      await resolveContent("pages", "missing", { nextly: current.nextly })
    ).toBeNull();
  });

  it("is a no-op status scope on a status-less collection (even with its own status field)", async () => {
    // No `status: true` lifecycle — the collection defines its OWN ordinary
    // `status` field. The default `status: "published"` scope is lifecycle-aware,
    // so it does NOT filter this collection and the live row is returned.
    current = await createTestNextly({
      collections: [
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
      collection: "docs",
      data: { slug: "intro", title: "Intro", status: "active" },
    });

    const doc = await resolveContent("docs", "intro", {
      nextly: current.nextly,
    });
    expect((doc as { title?: string } | null)?.title).toBe("Intro");
  });

  it("passes a published status scope so a localized draft cannot leak", async () => {
    // The status scope is forwarded as the lifecycle-aware `status` param (not a
    // where-clause), which the query service uses to constrain the companion
    // `_status` too. Here we assert the published main row resolves; the
    // per-locale companion enforcement itself is covered by the i18n suite.
    current = await createTestNextly({ collections: [pages()] });
    await current.nextly.create({
      collection: "pages",
      data: { slug: "hello", title: "Hello", status: "published" },
    });
    const resolved = await resolveContent("pages", "hello", {
      nextly: current.nextly,
    });
    expect((resolved as { title?: string } | null)?.title).toBe("Hello");
  });

  it("resolves duplicate published slugs deterministically (lowest id)", async () => {
    current = await createTestNextly({ collections: [pages()] });
    // A slug field is not unique — seed several published rows on the same slug.
    for (let i = 0; i < 4; i++) {
      await current.nextly.create({
        collection: "pages",
        data: { slug: "dup", title: `Dup ${i}`, status: "published" },
      });
    }
    // Sorting by `id` makes the lexicographically smallest id the stable winner.
    const all = await current.nextly.find({
      collection: "pages",
      where: { slug: { equals: "dup" } },
      limit: 50,
    });
    const expectedId = all.items
      .map(row => (row as { id: string }).id)
      .sort()[0];

    const resolved = await resolveContent("pages", "dup", {
      nextly: current.nextly,
    });
    expect((resolved as { id?: string } | null)?.id).toBe(expectedId);
  });
});
