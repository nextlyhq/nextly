/**
 * A page's address of several segments, through core's own writes.
 *
 * Pages opt into `db.slugPaths`, so a page may be published at
 * `docs/getting-started/install` and served there. What separates a correct
 * store from a plausible broken one:
 * - a nested address is stored with each segment normalised, and the
 *   content route serves it at the joined path;
 * - a path that cannot be an address is refused with words an author can
 *   act on, on create and on update, and nothing is stored;
 * - a one-segment page is stored exactly as before;
 * - a collection that did not opt in still strips the `/`, so the rule is
 *   the collection's and not every slug's.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createContentRoute } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

const POSTS = "sp_posts";

describe.each(getConfiguredTestDialects())(
  "a page's address of several segments (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          defineCollection({
            slug: POSTS,
            fields: [
              text({ name: "title", required: true }),
              text({ name: "slug", required: true, unique: true }),
            ],
          }),
        ],
      });
      return current;
    }

    async function createPage(t: TestNextly, slug: string) {
      return (await t.nextly.create({
        collection: "pages",
        data: { title: `Page ${slug}`, slug, status: "published" },
        overrideAccess: true,
      })) as unknown as { item: { id: string; slug: string } };
    }

    /** The words a refused write gives for its slug. */
    async function refusal(write: Promise<unknown>): Promise<string> {
      const error = (await write.then(
        () => undefined,
        (caught: unknown) => caught
      )) as
        | { publicData?: { errors?: { path: string; message: string }[] } }
        | undefined;
      const found = error?.publicData?.errors?.find(
        item => item.path === "slug"
      );
      return found?.message ?? "no refusal";
    }

    it("stores a nested address with each part normalised, and serves it there", async () => {
      const t = await boot();
      const { item } = await createPage(t, "Docs/Getting Started/Install");
      expect(item.slug).toBe("docs/getting-started/install");

      const { ContentPage } = createContentRoute({
        collections: ["pages"],
        nextly: t.nextly,
        render: entry => entry.id,
      });
      await expect(
        ContentPage({
          params: { slug: ["docs", "getting-started", "install"] },
        })
      ).resolves.toBe(item.id);
    });

    it.each([
      ["docs//install", "an empty part"],
      ["docs/../admin", "which a browser removes"],
      ["admin/pages", "is reserved for the site itself"],
    ])("refuses %j on create, and stores nothing", async (slug, words) => {
      const t = await boot();
      expect(await refusal(createPage(t, slug))).toContain(words);
      const stored = await t.nextly.find({
        collection: "pages",
        overrideAccess: true,
        status: "all",
      });
      expect(stored.items).toHaveLength(0);
    });

    it("refuses a path on update and keeps the stored address", async () => {
      const t = await boot();
      const { item } = await createPage(t, "docs/install");
      expect(
        await refusal(
          t.nextly.update({
            collection: "pages",
            id: item.id,
            data: { slug: "docs//install", _overwrite: true },
            overrideAccess: true,
          })
        )
      ).toContain("an empty part");
      const kept = (await t.nextly.findByID({
        collection: "pages",
        id: item.id,
        overrideAccess: true,
        status: "all",
      })) as unknown as { slug: string };
      expect(kept.slug).toBe("docs/install");
    });

    it("stores a one-part address exactly as before", async () => {
      const t = await boot();
      expect((await createPage(t, "About Us")).item.slug).toBe("about-us");
    });

    it("keeps one-part slugs in a collection that did not opt in", async () => {
      const t = await boot();
      const created = (await t.nextly.create({
        collection: POSTS,
        data: { title: "A post", slug: "docs/install" },
        overrideAccess: true,
      })) as unknown as { item: { slug: string } };
      expect(created.item.slug).toBe("docsinstall");
    });
  }
);
