/**
 * The later pages of an entry's list (`<its address>/page/*`), held by real
 * saves in the save's own transaction, where the design drawing the entry
 * splits a list into pages: its collection's published template, or its own
 * published design.
 *
 * What separates a correct wiring from a plausible broken one:
 * - a template published with its list paged over an entry whose later pages
 *   a page is published among leaves the entry at its address, waiting for
 *   them rather than refusing or taking them, and hands them to the entry
 *   the moment the page gives its address up, without the entry being saved;
 *   an entry saved there instead is refused, naming the page, and keeps
 *   nothing;
 * - paging a published template's list gives every entry it draws its later
 *   pages, and unpaging it takes them back, addresses kept, a draft entry
 *   holding nothing either way;
 * - an entry whose own published design pages a list the template does not
 *   holds later pages alone, and gives them up, keeping its address, when the
 *   design is unpublished or removed;
 * - the route's lookup answers each later page as the entry's space while it
 *   holds it, the page while the page does, and nothing otherwise.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { entryDesignKey, TEMPLATES_SLUG } from "../collections/templates";
import { asOverwrite } from "../document-version";
import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";

/** A design document holding one list of posts, split into pages or not. */
function design(paged: boolean) {
  return {
    formatVersion: 1,
    kind: "template",
    nodes: [
      {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: {
          collection: "posts",
          limit: 10,
          ...(paged ? { paginate: true } : {}),
        },
        slots: { children: [], empty: [] },
      },
    ],
  };
}

const PLAIN_PAGE = { formatVersion: 1, kind: "page", nodes: [] };

/** The words a refused write gives, as its caller reads them. */
async function refusal(write: Promise<unknown>): Promise<string> {
  const error = (await write.then(
    () => undefined,
    (caught: unknown) => caught
  )) as { publicMessage?: unknown; message?: unknown } | undefined;
  if (error === undefined) return "no refusal";
  return String(error.publicMessage ?? error.message);
}

const idOf = (created: unknown): string =>
  String((created as { item: { id: unknown } }).item.id);

describe.each(getConfiguredTestDialects())(
  "the later pages of an entry's list (%s)",
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
          pageBuilder({ templates: { addresses: { posts: "/blog" } } }),
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
        ],
      });
      return current;
    }

    function post(
      t: TestNextly,
      slug: string,
      status: "published" | "draft" = "published"
    ): Promise<string> {
      return t.nextly
        .create({
          collection: "posts",
          data: { title: `Post ${slug}`, slug, status },
          overrideAccess: true,
        })
        .then(idOf);
    }

    function page(t: TestNextly, slug: string): Promise<string> {
      return t.nextly
        .create({
          collection: "pages",
          data: {
            title: `Page at ${slug}`,
            slug,
            content: PLAIN_PAGE,
            status: "published",
          },
          overrideAccess: true,
        })
        .then(idOf);
    }

    /** The collection's template, published, its list paged or not. */
    function template(t: TestNextly, paged: boolean): Promise<string> {
      return t.nextly
        .create({
          collection: TEMPLATES_SLUG,
          data: {
            title: "Posts",
            collection: "posts",
            content: design(paged),
            status: "published",
          },
          overrideAccess: true,
        })
        .then(idOf);
    }

    // These tests are about claims, not stale writes: each update replaces
    // whatever is stored, and names its status, so a published document's
    // save is not held as a working draft.
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

    /** Who the content route is told holds `path`. */
    const holderAt = (t: TestNextly, path: string) =>
      pageBuilderContent({ nextly: t.nextly as never }).resolveAddress(
        undefined,
        path
      );

    it("leaves an entry waiting for later pages a page is published among when its paged template is published, and hands them over once the page is released", async () => {
      const t = await boot();
      const entry = await post(t, "post");
      const blocker = await page(t, "blog/post/page/2");
      await template(t, true);

      // The entry keeps its address; the page keeps its own; the entry waits
      // for its list's later pages, which nobody holds meanwhile.
      expect(await held(t)).toEqual([
        `address /blog/post posts:${entry}`,
        `address /blog/post/page/2 pages:${blocker}`,
      ]);
      expect(await held(t, ["waiting"])).toEqual([
        `waiting /blog/post posts:${entry}`,
      ]);
      expect(await holderAt(t, "/blog/post/page/2")).toEqual({
        collection: "pages",
        id: blocker,
        kind: "address",
      });
      expect(await holderAt(t, "/blog/post/page/3")).toBeNull();

      // The page is unpublished: the waiting entry is handed its later pages
      // in the same transaction, never saved again itself.
      await update(t, "pages", blocker, { status: "draft" });
      expect(await held(t)).toEqual([
        `address /blog/post posts:${entry}`,
        `space /blog/post posts:${entry}`,
      ]);
      expect(await held(t, ["waiting"])).toEqual([]);
      for (const later of ["/blog/post/page/2", "/blog/post/page/3"]) {
        expect(await holderAt(t, later)).toEqual({
          collection: "posts",
          id: entry,
          kind: "space",
        });
      }
    });

    it("refuses an entry saved under a paged template where a page is published among its later pages, naming the page, and keeps nothing", async () => {
      const t = await boot();
      await template(t, true);
      const blocker = await page(t, "blog/late/page/2");

      const words = await refusal(post(t, "late"));

      expect(words).toContain("/blog/late/page/2 is already the address of");
      expect(words).toContain(blocker);
      const posts = await t.nextly.find({
        collection: "posts",
        overrideAccess: true,
        depth: 0,
      });
      expect(posts.items).toHaveLength(0);
      expect(await held(t)).toEqual([
        `address /blog/late/page/2 pages:${blocker}`,
      ]);
    });

    it("gives every entry later pages when a published template's list is paged, and takes them back when it is unpaged", async () => {
      const t = await boot();
      const posts = await template(t, false);
      const first = await post(t, "first");
      const second = await post(t, "second");
      await post(t, "unfinished", "draft");
      expect(await held(t)).toEqual([
        `address /blog/first posts:${first}`,
        `address /blog/second posts:${second}`,
      ]);

      await update(t, TEMPLATES_SLUG, posts, {
        content: design(true),
        status: "published",
      });
      expect(await held(t)).toEqual([
        `address /blog/first posts:${first}`,
        `address /blog/second posts:${second}`,
        `space /blog/first posts:${first}`,
        `space /blog/second posts:${second}`,
      ]);
      expect(await holderAt(t, "/blog/second/page/2")).toEqual({
        collection: "posts",
        id: second,
        kind: "space",
      });

      await update(t, TEMPLATES_SLUG, posts, {
        content: design(false),
        status: "published",
      });
      expect(await held(t)).toEqual([
        `address /blog/first posts:${first}`,
        `address /blog/second posts:${second}`,
      ]);
      expect(await holderAt(t, "/blog/second/page/2")).toBeNull();
    });

    it("gives later pages to the one entry whose own design pages a list the template does not, until the design is unpublished or removed", async () => {
      const t = await boot();
      await template(t, false);
      const hello = await post(t, "hello");
      const other = await post(t, "other");
      const own = (status: "published" | "draft") =>
        t.nextly
          .create({
            collection: TEMPLATES_SLUG,
            data: {
              title: "Hello",
              entry: entryDesignKey("posts", hello),
              entryCollection: "posts",
              entryId: hello,
              content: design(true),
              status,
            },
            overrideAccess: true,
          })
          .then(idOf);

      const given = await own("published");
      expect(await held(t)).toEqual([
        `address /blog/hello posts:${hello}`,
        `address /blog/other posts:${other}`,
        `space /blog/hello posts:${hello}`,
      ]);
      expect(await holderAt(t, "/blog/hello/page/2")).toEqual({
        collection: "posts",
        id: hello,
        kind: "space",
      });
      expect(await holderAt(t, "/blog/other/page/2")).toBeNull();

      // Unpublished, the template draws the entry again: its address stays,
      // its later pages go.
      await update(t, TEMPLATES_SLUG, given, { status: "draft" });
      expect(await held(t)).toEqual([
        `address /blog/hello posts:${hello}`,
        `address /blog/other posts:${other}`,
      ]);

      // Published again, then removed: the same.
      await update(t, TEMPLATES_SLUG, given, { status: "published" });
      expect(await held(t)).toContain(`space /blog/hello posts:${hello}`);
      await t.nextly.delete({
        collection: TEMPLATES_SLUG,
        id: given,
        overrideAccess: true,
      });
      expect(await held(t)).toEqual([
        `address /blog/hello posts:${hello}`,
        `address /blog/other posts:${other}`,
      ]);
    });
  }
);
