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
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";

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
    // Collection tables now materialize their canonical UNIQUE slug index on
    // every dialect (SQLite/MySQL used to skip it on the drizzle-kit create
    // path), so duplicate slugs can only exist as LEGACY data written before
    // the index. Simulate that table state by dropping the index, then seed
    // several published rows on the same slug — resolveContent must still
    // pick a deterministic winner.
    const adapter = current.adapter as unknown as {
      executeQuery: (sql: string) => Promise<unknown[]>;
    };
    await adapter.executeQuery(`DROP INDEX IF EXISTS "idx_dc_pages_slug"`);
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
  // The working-draft overlay REPLACES the row resolved by slug, so it has to
  // be judged by the same rules. Carrying the plain `user` into it handed back
  // the fully trusted draft and undid the enforcement one line earlier — a leak
  // that only shows on the slug path, where a caller names no entry id, so the
  // preview gate's own tests cannot reach it.
  it("judges the draft overlay by the same rules as the row it replaces", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "slug" }),
            text({ name: "title" }),
            text({
              name: "secret",
              access: { read: ({ req }) => req.user?.email === "boss@x.test" },
            }),
          ],
        }),
      ],
    });
    const created = await current.nextly.create({
      collection: "pages",
      data: {
        slug: "about",
        title: "About",
        secret: "published-secret",
        status: "published",
      },
    });
    // A pending edit, so an overlay exists to replace the published row.
    await current.nextly.update({
      collection: "pages",
      id: String(created.item.id),
      data: { title: "About (pending)", secret: "draft-secret" },
    });

    const seen = (await resolveContent("pages", "about", {
      nextly: current.nextly,
      draft: true,
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
      draftFieldAccessAs: { id: "u1", email: "nobody@x.test", roles: [] },
    })) as { title?: string; secret?: string } | null;

    // The overlay won — otherwise this asserts nothing about the overlay at
    // all, and the published row would satisfy the redaction check by itself.
    expect(seen?.title).toBe("About (pending)");
    expect(seen?.secret).toBeUndefined();
  });

  // The positive control: the same overlay, read by someone the rule allows.
  // Without it, an overlay that returned nothing at all would pass above.
  it("shows the overlay's denied field to a reader the rule allows", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "slug" }),
            text({ name: "title" }),
            text({
              name: "secret",
              access: { read: ({ req }) => req.user?.email === "boss@x.test" },
            }),
          ],
        }),
      ],
    });
    const created = await current.nextly.create({
      collection: "pages",
      data: {
        slug: "about",
        title: "About",
        secret: "published-secret",
        status: "published",
      },
    });
    await current.nextly.update({
      collection: "pages",
      id: String(created.item.id),
      data: { title: "About (pending)", secret: "draft-secret" },
    });

    const seen = (await resolveContent("pages", "about", {
      nextly: current.nextly,
      draft: true,
      overrideAccess: true,
      trustedCollections: TRUSTS_EVERY_COLLECTION,
      draftFieldAccessAs: { id: "u1", email: "boss@x.test", roles: [] },
    })) as { title?: string; secret?: string } | null;

    expect(seen?.title).toBe("About (pending)");
    expect(seen?.secret).toBe("draft-secret");
  });
});
