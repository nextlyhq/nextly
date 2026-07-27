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

  it("does not apply a published filter on a status-less collection", async () => {
    // No `status: true` — the collection defines its own ordinary `status`
    // field. A blanket `status = published` filter would wrongly drop this row.
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
});
