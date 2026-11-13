/**
 * A site upgrading to entries' address claims: its entries and their
 * published template are stored, and the address store holds nothing for
 * them yet. The start-up pass (`settleEntryClaimsAtStart`, run once the pages'
 * pass has claimed every page) claims each published entry's address; an
 * entry whose address a page holds is left unserved, waiting on the page's
 * claim, and reported as waiting; starting again writes nothing; and once
 * the page lets the address go, the entry is served there.
 *
 * The install is made by a first boot of the site as it is now: the entries
 * saved before their template was published, a page published at one of
 * their addresses, the template published, and then every row of the
 * address store deleted, which is what a site from before the store holds.
 * The site then starts again on the same database, as a deploy of the
 * upgrade does, and once more after that.
 *
 * The database is one of the test's own (`site-database-harness`), since
 * every boot of the harness otherwise gets a new one.
 *
 * @module __tests__/entry-claims-at-start.integration.test
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADDRESS_WAITING_ROUTE_PATH } from "../address-claims/waiting-report-route";
import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { asOverwrite } from "../document-version";

import {
  blogPageBuilder,
  claimRows,
  held,
  idOf,
  pageContent,
  POSTS,
  postsCollection,
  publishPostsTemplate,
  savePage,
  savePost,
  startupSettled,
} from "./entry-page-claims-harness";
import {
  adapterOn,
  siteDatabase,
  type SiteDatabase,
} from "./site-database-harness";
import { call, grant, person, sessionOf } from "./transfer-harness";

/** Each stored claim and wait, with its row id: a rewrite changes the id. */
async function storedClaims(t: TestNextly): Promise<string[]> {
  return (await claimRows(t))
    .filter(row => row.kind !== "lock")
    .map(
      row =>
        `${String(row.id)} ${String(row.kind)} ${String(row.claimKey)} ${String(row.path)} ${String(row.holderCollection)}:${String(row.holderId)} ${String(row.blockedBy)}`
    )
    .sort();
}

describe.each(getConfiguredTestDialects())(
  "entries' address claims at start (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let database: SiteDatabase | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      await database?.drop();
      database = undefined;
      vi.unstubAllEnvs();
    });

    /** The site on `on`, its start-up passes over. */
    async function boot(on: SiteDatabase): Promise<TestNextly> {
      await current?.destroy();
      current = await createTestNextly({
        adapter: await adapterOn(on),
        plugins: [blogPageBuilder()],
        collections: [postsCollection()],
        seedPublic: true,
      });
      await startupSettled(current);
      return current;
    }

    it("claims every entry's address once the site starts, leaves the one a page holds waiting and reports it, changes nothing when it starts again, and serves it once the page lets the address go", async () => {
      database = await siteDatabase(dialect, "pb_entry_start");

      // The install. Saved before their template is published, the entries
      // are served nowhere, and hold nothing.
      const before = await boot(database);
      const hello = idOf(await savePost(before, "hello"));
      const taken = idOf(await savePost(before, "taken"));
      const world = idOf(await savePost(before, "world"));
      const page = idOf(await savePage(before, "Taken", "blog/taken"));
      await publishPostsTemplate(before);
      for (const row of await claimRows(before)) {
        await before.nextly.delete({
          collection: ADDRESS_CLAIMS_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
      expect(await claimRows(before)).toEqual([]);

      // The upgrade starts: pages first, then the entries.
      const t = await boot(database);
      expect(await held(t)).toEqual([
        `address /blog/hello ${POSTS}:${hello}`,
        `address /blog/taken pages:${page}`,
        `address /blog/world ${POSTS}:${world}`,
        `waiting /blog/taken ${POSTS}:${taken}`,
      ]);
      const content = pageContent(t);
      expect(await content.resolveAddress(undefined, "/blog/hello")).toEqual({
        collection: POSTS,
        id: hello,
        kind: "address",
      });
      // The entry in the page's way is left unserved: the path is the page's.
      expect(await content.resolveAddress(undefined, "/blog/taken")).toEqual({
        collection: "pages",
        id: page,
        kind: "address",
      });
      expect(await content.entryPath(POSTS, taken, undefined)).toBeNull();

      // And reported, naming the page in its way.
      await person(t, "owner");
      const author = await person(t, "author");
      await grant(t, author, ["read-pages", "update-pages", `read-${POSTS}`]);
      const report = await call(
        "GET",
        await sessionOf(t, author),
        ADDRESS_WAITING_ROUTE_PATH.split("/").filter(Boolean)
      );
      expect(report.status).toBe(200);
      expect(report.body.items).toEqual([
        {
          document: { collection: POSTS, id: taken, title: "Post taken" },
          address: { locale: "en", path: "/blog/taken" },
          blockedBy: { collection: "pages", id: page, title: "Taken" },
        },
      ]);

      // Starting again finds every entry holding what it should, or waiting
      // where it should, and writes none of it again.
      const settled = await storedClaims(t);
      const again = await boot(database);
      expect(await storedClaims(again)).toEqual(settled);

      // The page unpublished: the waiting entry is handed the address it
      // waited for, and served there.
      await again.nextly.update({
        collection: "pages",
        id: page,
        data: asOverwrite({ status: "draft" }),
        overrideAccess: true,
      });
      expect(await held(again)).toEqual([
        `address /blog/hello ${POSTS}:${hello}`,
        `address /blog/taken ${POSTS}:${taken}`,
        `address /blog/world ${POSTS}:${world}`,
      ]);
      expect(
        await pageContent(again).resolveAddress(undefined, "/blog/taken")
      ).toEqual({ collection: POSTS, id: taken, kind: "address" });
    });
  }
);
