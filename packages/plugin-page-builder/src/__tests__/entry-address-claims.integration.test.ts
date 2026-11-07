/**
 * Collections' entries served under a code-declared template address: the
 * entries' address claims, held by real saves in the save's own transaction,
 * and what the content route is told holds each path.
 *
 * What separates a correct wiring from a plausible broken one:
 * - a published entry holds `<address>/<slug>` only while its collection's
 *   template is published, a draft holds nothing, and a slug change, an
 *   unpublish and a delete each give the address up;
 * - an entry saved at an address a page holds is refused, naming the page,
 *   and the refused save keeps nothing, entry or claim;
 * - a template's first publish claims every published entry, and one whose
 *   address a page holds waits rather than refusing, then is served the
 *   moment the page gives the address up, without being saved again;
 * - unpublishing the template gives every entry's address up;
 * - the route's lookup answers the holder as committed: a page, an entry,
 *   or nothing.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createContentPage } from "@nextlyhq/blocks-react/next";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { TEMPLATES_SLUG } from "../collections/templates";
import { asOverwrite } from "../document-version";
import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";

const PLAIN_PAGE = { formatVersion: 1, kind: "page", nodes: [] };
const TEMPLATE = { formatVersion: 1, kind: "template", nodes: [] };

/** The words a refused write gives, as its caller reads them. */
async function refusal(write: Promise<unknown>): Promise<string> {
  const error = (await write.then(
    () => undefined,
    (caught: unknown) => caught
  )) as { publicMessage?: unknown; message?: unknown } | undefined;
  if (error === undefined) return "no refusal";
  return String(error.publicMessage ?? error.message);
}

/**
 * Why a boot was refused, in the plugin's own words. A plugin that throws
 * from `onReady` fails the boot with an internal error whose public message
 * is generic on purpose; what the plugin said is kept in its log context,
 * which is where an operator reads it.
 */
async function startRefusal(boot: Promise<TestNextly>): Promise<string> {
  const error = await boot.then(
    async started => {
      await started.destroy();
      return undefined;
    },
    (caught: unknown) => caught
  );
  if (error === undefined) return "no refusal";
  if (!NextlyError.is(error)) return `not a refused start: ${String(error)}`;
  const context = error.logContext as
    | { reason?: unknown; message?: unknown }
    | undefined;
  if (context?.reason !== "plugin-onready-failed") {
    return `not a plugin's refusal: ${String(context?.reason)}`;
  }
  return String(context.message);
}

/** The content route's provider, over the test's own instance. */
const pageContent = (t: TestNextly) =>
  pageBuilderContent({ nextly: t.nextly as never });

const idOf = (created: unknown): string =>
  String((created as { item: { id: unknown } }).item.id);

describe.each(getConfiguredTestDialects())(
  "entries served under a template address (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [
          pageBuilder({
            templates: { addresses: { posts: "/blog", events: "/events" } },
          }),
        ],
        collections: [
          defineCollection({
            slug: "posts",
            labels: { singular: "Post", plural: "Posts" },
            status: true,
            fields: [
              text({ name: "title" }),
              text({ name: "slug", unique: true }),
            ],
          }),
          // No Draft/Published lifecycle, and an ordinary field named
          // `status`: every entry is live, whatever that field holds. No
          // timestamps either, so a walk of its entries cannot sort by them.
          defineCollection({
            slug: "events",
            labels: { singular: "Event", plural: "Events" },
            timestamps: false,
            fields: [
              text({ name: "title" }),
              text({ name: "slug", unique: true }),
              text({ name: "status" }),
            ],
          }),
        ],
      });
      return current;
    }

    async function post(
      t: TestNextly,
      slug: string,
      status: "published" | "draft" = "published"
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: "posts",
          data: { title: `Post ${slug}`, slug, status },
          overrideAccess: true,
        })
      );
    }

    async function page(t: TestNextly, title: string, slug: string) {
      return idOf(
        await t.nextly.create({
          collection: "pages",
          data: { title, slug, content: PLAIN_PAGE, status: "published" },
          overrideAccess: true,
        })
      );
    }

    async function template(t: TestNextly): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: TEMPLATES_SLUG,
          data: {
            title: "Posts",
            collection: "posts",
            content: TEMPLATE,
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    // These tests are about claims, not stale writes: each update replaces
    // whatever is stored.
    function update(
      t: TestNextly,
      collection: string,
      id: string,
      data: Record<string, unknown>
    ) {
      return t.nextly.update({
        collection,
        id,
        data: asOverwrite(data),
        overrideAccess: true,
      });
    }

    /** Every claim row of `kinds`: its kind, path and holder, sorted. */
    async function held(
      t: TestNextly,
      kinds: readonly string[] = ["address", "space"]
    ): Promise<string[]> {
      const found = await t.nextly.find({
        collection: ADDRESS_CLAIMS_SLUG,
        overrideAccess: true,
        depth: 0,
        limit: 200,
      });
      return (found.items as Record<string, unknown>[])
        .filter(row => kinds.includes(String(row.kind)))
        .map(
          row =>
            `${String(row.kind)} ${String(row.path)} ${String(row.holderCollection)}:${String(row.holderId)}`
        )
        .sort();
    }

    it("holds a published entry's address while its template is published, and gives it up on a slug change, an unpublish and a delete", async () => {
      const t = await boot();
      await template(t);
      const hello = await post(t, "hello");
      await post(t, "unfinished", "draft");
      expect(await held(t)).toEqual([`address /blog/hello posts:${hello}`]);

      await update(t, "posts", hello, { slug: "hello-world" });
      expect(await held(t)).toEqual([
        `address /blog/hello-world posts:${hello}`,
      ]);

      await update(t, "posts", hello, { status: "draft" });
      expect(await held(t)).toEqual([]);

      await update(t, "posts", hello, { status: "published" });
      expect(await held(t)).toEqual([
        `address /blog/hello-world posts:${hello}`,
      ]);
      await t.nextly.delete({
        collection: "posts",
        id: hello,
        overrideAccess: true,
      });
      expect(await held(t)).toEqual([]);
    });

    it("refuses an entry saved at an address a page holds, naming the page, and keeps nothing", async () => {
      const t = await boot();
      await template(t);
      const taken = await page(t, "Taken", "blog/taken");
      const words = await refusal(post(t, "taken"));
      expect(words).toContain("/blog/taken is already the address of");
      expect(words).toContain(taken);
      const posts = await t.nextly.find({
        collection: "posts",
        overrideAccess: true,
        depth: 0,
      });
      expect(posts.items).toHaveLength(0);
      expect(await held(t)).toEqual([`address /blog/taken pages:${taken}`]);
    });

    it("claims every entry when the template is first published, leaves one whose address a page holds waiting, and serves it once the page gives the address up", async () => {
      const t = await boot();
      // Saved before the collection has a template: nothing is served, so
      // nothing is claimed or refused.
      const free = await post(t, "free");
      const waiting = await post(t, "taken");
      const holder = await page(t, "Taken", "blog/taken");
      expect(await held(t)).toEqual([`address /blog/taken pages:${holder}`]);

      const posts = await template(t);
      expect(await held(t)).toEqual([
        `address /blog/free posts:${free}`,
        `address /blog/taken pages:${holder}`,
      ]);
      expect(await held(t, ["waiting"])).toEqual([
        `waiting /blog/taken posts:${waiting}`,
      ]);
      const content = pageContent(t);
      expect(await content.resolveAddress(undefined, "/blog/taken")).toEqual({
        collection: "pages",
        id: holder,
        kind: "address",
      });

      // The page gives the address up: the waiting entry is handed it in the
      // same transaction, never saved again itself.
      await update(t, "pages", holder, { status: "draft" });
      expect(await held(t)).toEqual([
        `address /blog/free posts:${free}`,
        `address /blog/taken posts:${waiting}`,
      ]);
      expect(await held(t, ["waiting"])).toEqual([]);
      expect(await content.resolveAddress(undefined, "/blog/taken")).toEqual({
        collection: "posts",
        id: waiting,
        kind: "address",
      });

      // Unpublishing the template gives every entry's address up.
      await update(t, TEMPLATES_SLUG, posts, { status: "draft" });
      expect(await held(t)).toEqual([]);
      expect(await content.resolveAddress(undefined, "/blog/taken")).toBeNull();
    });

    it("tells the route nothing holds a path no published document claims, or one it never serves", async () => {
      const t = await boot();
      await template(t);
      const content = pageContent(t);
      // The provider is what the content route takes, checked by the
      // compiler where the route is built over it.
      createContentPage({
        ...content,
        pages: { collections: ["pages"], field: "content" },
      });
      expect(await content.resolveAddress(undefined, "/blog/none")).toBeNull();
      expect(await content.resolveAddress(undefined, "/admin")).toBeNull();
    });

    it("holds the address of every entry of a collection without a lifecycle or timestamps, whatever its status field holds", async () => {
      const t = await boot();
      // Saved before the template, so its publish walks the collection.
      const before = idOf(
        await t.nextly.create({
          collection: "events",
          data: { title: "First", slug: "first", status: "archived" },
          overrideAccess: true,
        })
      );
      await t.nextly.create({
        collection: TEMPLATES_SLUG,
        data: {
          title: "Events",
          collection: "events",
          content: TEMPLATE,
          status: "published",
        },
        overrideAccess: true,
      });
      const archived = idOf(
        await t.nextly.create({
          collection: "events",
          data: { title: "Old", slug: "old", status: "archived" },
          overrideAccess: true,
        })
      );
      expect(await held(t)).toEqual([
        `address /events/first events:${before}`,
        `address /events/old events:${archived}`,
      ]);
    });

    it("refuses to start when a localized collection is given an address, naming it", async () => {
      expect(
        await startRefusal(
          createTestNextly({
            dialect,
            localization: { locales: ["en", "de"], defaultLocale: "en" },
            plugins: [
              pageBuilder({
                templates: { addresses: { stories: "/stories" } },
              }),
            ],
            collections: [
              defineCollection({
                slug: "stories",
                localized: true,
                fields: [text({ name: "title" }), text({ name: "slug" })],
              }),
            ],
          })
        )
      ).toMatch(/"stories" is localized/);
    });

    it("refuses to start when a collection given an address cannot have a template, naming it", async () => {
      expect(
        await startRefusal(
          createTestNextly({
            dialect,
            plugins: [
              pageBuilder({ templates: { addresses: { ghosts: "/ghosts" } } }),
            ],
          })
        )
      ).toMatch(/There is no collection "ghosts"/);
    });
  }
);
