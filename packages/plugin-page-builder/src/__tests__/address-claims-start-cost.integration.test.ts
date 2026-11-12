/**
 * What the address store costs a site at every start, and that it still
 * follows every change a start must catch up with.
 *
 * What separates a correct start from a plausibly broken one:
 * - a second start against a site nothing changed writes no row of the page
 *   builder's (no claim, no lock row, no option), and none of core's rows a
 *   write would cause (content events, media usage, cache tags), and its
 *   start makes the same number of round trips with 5 published pages as
 *   with 50, and only a few of them read the address store or the pages: a
 *   pass that walks every page again is caught by the counts, and one that
 *   holds a lock by writing it by the writes;
 * - holding a lock row writes nothing, but still reads it for update, and a
 *   second transaction holding the same row waits until the first ends: a
 *   lock that only reads would not keep it waiting;
 * - a start after the site's languages changed, after the page path changed,
 *   or after claims were removed behind the store's back, still brings every
 *   page's claims to what they should be: a start that skipped its passes on
 *   too narrow a check would leave them as they were;
 * - saves of pages while the pages' pass runs, and two saves of one page at
 *   once, leave each page holding exactly its own address, one holder per
 *   address, and are neither refused nor deadlocked.
 *
 * Each case starts its site on a database of its own more than once, as a
 * deploy starts a site again on what the last one left.
 *
 * @module __tests__/address-claims-start-cost.integration.test
 */
import {
  definePlugin,
  type PluginCollectionTransaction,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lockHolder, type Claims } from "../address-claims/claim-store";
import {
  ADDRESS_CLAIMS_SLUG,
  addressClaimsCollection,
} from "../collections/address-claims";
import { asOverwrite } from "../document-version";
import { pageBuilder } from "../plugin";

import {
  claimRows,
  held,
  idOf,
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
import {
  isWrite,
  recordStatements,
  writtenTable,
  type Recorded,
} from "./statement-recorder";

/** The page builder's options for every boot of a case. */
type Options = NonNullable<Parameters<typeof pageBuilder>[0]>;

/** What a boot may change besides the page builder's options. */
interface Boot {
  readonly options?: Options;
  readonly locales?: readonly string[];
}

/**
 * The tables a write of the page builder's lands in, its own and those core
 * writes because the page builder wrote a document: a claim's or a lock
 * row's content event, media usage and cache tags.
 */
const PAGE_BUILDER_WRITES =
  /^(dc_nx_pb_|page_builder__|nextly_content_events$|nextly_media_usage$|nextly_cache_tag_expiries$)/;

/**
 * A statement that reads or writes the address store or the pages: the
 * passes' own work, which a pass walking every page again makes once per page
 * or more.
 */
const STORE_OR_PAGES =
  /\b[`"]?(dc_nx_pb_address_claims|dc_pages|page_builder__site_options)[`"]?/;

/**
 * The composition graph lock's insert-if-absent, which every start on
 * PostgreSQL and MySQL tries: no part of the address store, and refused by
 * the row's unique name once the row is there, so it writes nothing.
 */
function seedsGraphLock(call: Recorded): boolean {
  return (
    writtenTable(call.text) === "page_builder__site_options" &&
    call.values.includes("composition-graph-lock")
  );
}

describe.each(getConfiguredTestDialects())(
  "the address store at start (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let database: SiteDatabase | undefined;
    let uninstall: (() => void) | undefined;

    afterEach(async () => {
      uninstall?.();
      uninstall = undefined;
      await current?.destroy();
      current = undefined;
      await database?.drop();
      database = undefined;
      vi.unstubAllEnvs();
    });

    /** The site on `on`, with `posts` served under `/blog`. */
    async function boot(on: SiteDatabase, with_: Boot = {}) {
      await current?.destroy();
      const adapter = await adapterOn(on);
      current = await createTestNextly({
        adapter,
        plugins: [
          pageBuilder({
            templates: { addresses: { [POSTS]: "/blog" } },
            ...with_.options,
          }),
        ],
        collections: [postsCollection()],
        ...(with_.locales === undefined
          ? {}
          : {
              localization: {
                locales: [...with_.locales],
                defaultLocale: with_.locales[0] ?? "en",
              },
            }),
      });
      return { t: current, adapter };
    }

    /** Boot on `on` and wait for the start-up passes to finish. */
    async function start(on: SiteDatabase, with_: Boot = {}) {
      const { t } = await boot(on, with_);
      await startupSettled(t);
      return t;
    }

    /**
     * A site with `pages` published pages, a published template serving
     * three posts, and its start-up passes over: installed and started once.
     */
    async function siteWith(pages: number, with_: Boot = {}) {
      const on = await siteDatabase(dialect, "pb_start_cost");
      database = on;
      const t = await start(on, with_);
      await publishPostsTemplate(t);
      for (const slug of ["one", "two", "three"]) await savePost(t, slug);
      for (let n = 1; n <= pages; n += 1) {
        await savePage(t, `Page ${n}`, `page-${n}`);
      }
      // The start after the install, which catches the store up with the
      // writes above; the one after it is the unchanged site's.
      await start(on, with_);
      return on;
    }

    /** Start again on `on`, recording every statement until the passes end. */
    async function recordedStart(on: SiteDatabase, with_: Boot = {}) {
      const adapter = await adapterOn(on);
      const recorder = await recordStatements(adapter, dialect);
      uninstall = recorder.uninstall;
      await current?.destroy();
      current = await createTestNextly({
        adapter,
        plugins: [
          pageBuilder({
            templates: { addresses: { [POSTS]: "/blog" } },
            ...with_.options,
          }),
        ],
        collections: [postsCollection()],
      });
      await startupSettled(current);
      recorder.uninstall();
      uninstall = undefined;
      return recorder.calls;
    }

    /** The cost of a start against the unchanged site with `pages` pages. */
    async function unchangedStart(pages: number) {
      const on = await siteWith(pages);
      const calls = await recordedStart(on);
      const cost = {
        writes: calls
          .filter(
            call =>
              isWrite(call.text) &&
              PAGE_BUILDER_WRITES.test(writtenTable(call.text) ?? "") &&
              !seedsGraphLock(call)
          )
          .map(call => call.text),
        // Every statement of the start, the boot's own included: they are
        // the same whatever the site holds, so any difference is the passes'.
        trips: calls.length,
        store: calls.filter(call => STORE_OR_PAGES.test(call.text)).length,
      };
      await current?.destroy();
      current = undefined;
      await on.drop();
      database = undefined;
      return cost;
    }

    it("writes nothing of the page builder's on a second start of an unchanged site, and its passes cost the same few round trips at 5 and at 50 pages", async () => {
      const five = await unchangedStart(5);
      const fifty = await unchangedStart(50);
      expect(five.writes).toEqual([]);
      expect(fifty.writes).toEqual([]);
      expect(fifty.trips).toBe(five.trips);
      expect(fifty.store).toBe(five.store);
      expect(five.store).toBeLessThanOrEqual(12);
    }, 600_000);

    it("claims every page in a language the site starts serving", async () => {
      const on = await siteWith(2, { locales: ["en"] });
      const t = await start(on, { locales: ["en", "fr"] });
      const pages = (await held(t)).filter(row => row.includes("pages:"));
      const paths = (await claimRows(t))
        .filter(
          row => row.kind === "address" && row.holderCollection === "pages"
        )
        .map(row => `${String(row.locale)} ${String(row.path)}`)
        .sort();
      expect(pages).toHaveLength(4);
      expect(paths).toEqual([
        "en /page-1",
        "en /page-2",
        "fr /page-1",
        "fr /page-2",
      ]);
    }, 300_000);

    it("moves every page's claims when the site serves its pages at another path", async () => {
      const on = await siteWith(2);
      const t = await start(on, { options: { pagePreviewPath: "/p/{slug}" } });
      const paths = (await claimRows(t))
        .filter(
          row => row.kind === "address" && row.holderCollection === "pages"
        )
        .map(row => String(row.path))
        .sort();
      expect(paths).toEqual(["/p/page-1", "/p/page-2"]);
    }, 300_000);

    it("claims a page again whose claims were removed behind the store's back", async () => {
      const on = await siteWith(3);
      let t = await start(on);
      const before = await held(t);
      for (const row of await claimRows(t)) {
        if (row.holderCollection !== "pages") continue;
        await t.nextly.delete({
          collection: ADDRESS_CLAIMS_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
      expect((await held(t)).filter(row => row.includes("pages:"))).toEqual([]);
      t = await start(on);
      expect(await held(t)).toEqual(before);
    }, 300_000);

    describe.skipIf(dialect === "sqlite")("under concurrent saves", () => {
      it("leaves each page at its own address when pages are saved while the pages' pass runs", async () => {
        const on = await siteWith(12);
        let t = await start(on);
        // Removed behind the store's back, so the next start's pass has
        // every page to claim while the saves below run.
        for (const row of await claimRows(t)) {
          await t.nextly.delete({
            collection: ADDRESS_CLAIMS_SLUG,
            id: String(row.id),
            overrideAccess: true,
          });
        }
        ({ t } = await boot(on));
        const pages = (
          await t.nextly.find({
            collection: "pages",
            overrideAccess: true,
            depth: 0,
            limit: 100,
          })
        ).items as Record<string, unknown>[];
        const saves = await Promise.allSettled(
          pages.slice(0, 6).map(page =>
            t.nextly.update({
              collection: "pages",
              id: String(page.id),
              data: asOverwrite({
                status: "published",
                slug: `moved-${String(page.slug)}`,
              }),
              overrideAccess: true,
            })
          )
        );
        expect(saves.filter(save => save.status === "rejected")).toEqual([]);
        await startupSettled(t);
        const after = (
          await t.nextly.find({
            collection: "pages",
            overrideAccess: true,
            depth: 0,
            limit: 100,
          })
        ).items as Record<string, unknown>[];
        const want = after
          .map(page => `address /${String(page.slug)} pages:${String(page.id)}`)
          .sort();
        expect(
          (await held(t)).filter(
            row => row.startsWith("address /") && row.includes("pages:")
          )
        ).toEqual(want);
      }, 300_000);

      it("leaves a page saved twice at once at the address of the save that committed last", async () => {
        const on = await siteWith(1);
        const t = await start(on);
        const page = idOf(await savePage(t, "Raced", "raced"));
        const saves = await Promise.allSettled(
          ["raced-a", "raced-b"].map(slug =>
            t.nextly.update({
              collection: "pages",
              id: page,
              data: asOverwrite({ status: "published", slug }),
              overrideAccess: true,
            })
          )
        );
        expect(saves.filter(save => save.status === "rejected")).toEqual([]);
        const stored = (await t.nextly.findByID({
          collection: "pages",
          id: page,
          overrideAccess: true,
          depth: 0,
        })) as { slug?: unknown } | null;
        expect(
          (await held(t)).filter(row => row.endsWith(`pages:${page}`))
        ).toEqual([`address /${String(stored?.slug)} pages:${page}`]);
      }, 300_000);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "holding an address lock (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let database: SiteDatabase | undefined;
    let uninstall: (() => void) | undefined;

    afterEach(async () => {
      uninstall?.();
      uninstall = undefined;
      await current?.destroy();
      current = undefined;
      await database?.drop();
      database = undefined;
      vi.unstubAllEnvs();
    });

    /** A plugin holding only the claims collection, its store and adapter. */
    async function boot() {
      const on = await siteDatabase(dialect, "pb_lock_hold");
      database = on;
      const adapter = await adapterOn(on);
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        adapter,
        plugins: [
          definePlugin({
            name: "@t/address-locks",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { collections: [addressClaimsCollection()] },
            init(ctx) {
              captured = ctx;
            },
          }),
        ],
      });
      if (captured === undefined) throw new Error("the plugin never started");
      const claims: Claims = {
        services: captured.services,
        slug: ADDRESS_CLAIMS_SLUG,
        dialect: captured.dialect,
      };
      return { claims, adapter };
    }

    const holder = { collection: "pages", id: "p1" };

    function saving<R>(
      claims: Claims,
      work: (tx: PluginCollectionTransaction) => Promise<R>
    ): Promise<R> {
      return claims.services.collections.withTransaction(work);
    }

    it("holds a lock row that exists without writing it, reading it for update", async () => {
      const { claims, adapter } = await boot();
      // The first hold creates the row.
      await saving(claims, tx => lockHolder(claims, tx, holder));
      const recorder = await recordStatements(adapter, dialect);
      uninstall = recorder.uninstall;
      await saving(claims, tx => lockHolder(claims, tx, holder));
      recorder.uninstall();
      uninstall = undefined;
      const onClaims = recorder.calls
        .map(call => call.text)
        .filter(text => /nx_pb_address_claims/.test(text));
      expect(onClaims.filter(isWrite)).toEqual([]);
      if (dialect === "sqlite") {
        // One writer at a time: no lock is taken at all.
        expect(onClaims).toEqual([]);
      } else {
        expect(onClaims.some(text => /\bfor update\b/i.test(text))).toBe(true);
      }
    });

    it.skipIf(dialect === "sqlite")(
      "keeps a second holder of a lock row waiting until the first's transaction ends",
      async () => {
        const { claims } = await boot();
        await saving(claims, tx => lockHolder(claims, tx, holder));
        let held: () => void = () => undefined;
        const firstHolds = new Promise<void>(resolve => {
          held = resolve;
        });
        let letGo: () => void = () => undefined;
        const release = new Promise<void>(resolve => {
          letGo = resolve;
        });
        const order: string[] = [];
        const first = saving(claims, async tx => {
          await lockHolder(claims, tx, holder);
          held();
          await release;
          order.push("first ends");
        });
        await firstHolds;
        const second = saving(claims, async tx => {
          await lockHolder(claims, tx, holder);
          order.push("second holds");
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(order).toEqual([]);
        letGo();
        await Promise.all([first, second]);
        expect(order).toEqual(["first ends", "second holds"]);
      }
    );
  }
);
