/**
 * Which cached pages a Layout write rebuilds, through the real path.
 *
 * Pages are rendered by the real route helper (`createPublicBlocksPage` with
 * the plugin's `pageBuilderLayouts()`), against a real instance. Every cached
 * read the render makes goes through nextly's own `cachedFind`, into the
 * cached-read function an app registers under Cache Components; the one
 * registered here only records the tags it is handed and then reads. Under
 * Next.js a read nested in a page's render puts its tags on that page's cache
 * entry, so the tags recorded during one page's render are what that page is
 * cached under.
 *
 * Writes go through the real Direct API, and the invalidation is the
 * production adapter's: `NextCacheRevalidator` is the cache revalidator, over
 * a `next/cache` whose `revalidateTag` records each tag it is asked to expire.
 * A page is rebuilt by a write when it carries a tag the write expires.
 *
 * What is NOT driven for real: Next.js's own propagation of a nested read's
 * tags onto the page entry, and its matching of an expired tag to an entry.
 * Both are Next.js's, need a running Next server, and are covered by the
 * production browser test only as "the page changes after a publish".
 *
 * @module __tests__/pages-in-their-layout.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { container } from "nextly";
import {
  NextCacheRevalidator,
  registerCachedRead,
  runRegisteredRead,
  type NextCacheModule,
} from "nextly/runtime";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import {
  readLayoutSettings,
  writeLayoutSettings,
} from "../default-layout/store";
import { pageBuilderLayouts } from "../page-layouts";
import { pageBuilder } from "../plugin";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;

const idOf = (created: unknown) =>
  String((created as { item: { id: string | number } }).item.id);

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

/** The tags each cached read was handed, while a page is being rendered. */
let recording: Set<string> | undefined;

/** Every tag the production revalidator asked `next/cache` to expire. */
const expired: string[] = [];

const nextCache: NextCacheModule = {
  revalidateTag: tag => {
    expired.push(tag);
  },
  revalidatePath: () => {},
};

describe.each(getConfiguredTestDialects())(
  "a Layout write rebuilds exactly the pages drawn inside it (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let main = "";
    let landing = "";
    let unpublished = "";
    /** Each page's cached tags, by slug, from a real render. */
    const pageTags = new Map<string, Set<string>>();

    async function component(slug: string, text: string): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: "components",
          data: {
            title: slug,
            slug,
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [heading(`${slug}-h`, text)],
            },
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    async function layout(
      slug: string,
      header: string,
      status: "published" | "draft"
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: slug,
            slug,
            areas: [{ area: "header", component: header }],
            status,
          },
          overrideAccess: true,
        })
      );
    }

    async function page(slug: string, chosen: string | null): Promise<void> {
      await t.nextly.create({
        collection: "pages",
        data: {
          title: slug,
          slug,
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [heading(`${slug}-body`, `Body of ${slug}`)],
          },
          ...(chosen === null ? {} : { layout: chosen }),
          status: "published",
        },
        overrideAccess: true,
      });
    }

    /** Render one page through the real route, recording what it is cached under. */
    async function render(
      slug: string,
      settingsReader: Parameters<typeof pageBuilderLayouts>[0] = {
        nextly: t.nextly,
      },
      recordAs = slug
    ): Promise<string> {
      const route = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        nextly: t.nextly as never,
        blocks: createBlockResolver(coreBlocks),
        layouts: pageBuilderLayouts(settingsReader),
      });
      recording = new Set();
      try {
        const element = (await route.ContentPage({
          params: { slug: [slug] },
        })) as ReactElement;
        pageTags.set(recordAs, recording);
        return renderToStaticMarkup(element);
      } finally {
        recording = undefined;
      }
    }

    /** How many of the tags a write expired each page carries. */
    function hits(): Record<string, number> {
      return Object.fromEntries(
        [...pageTags].map(([slug, tags]) => [
          slug,
          [...new Set(expired)].filter(tag => tags.has(tag)).length,
        ])
      );
    }

    beforeAll(async () => {
      // The production adapter, over a `next/cache` that records. Registered
      // before boot so the services keep it rather than the no-op default.
      container.registerSingleton(
        "cacheRevalidator",
        () => new NextCacheRevalidator(() => nextCache)
      );
      // The app's cached-read function, as Cache Components registers it:
      // record the tags, then read through the registered reader.
      // record the tags of a read that succeeded, as a cache stores an entry
      // only for a function that returned.
      registerCachedRead(async (key, tags) => {
        const value = await runRegisteredRead(key);
        for (const tag of tags) recording?.add(tag);
        return value;
      }, true);

      t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      const mainHeader = await component("main-header", "Main header");
      const landingHeader = await component("landing-header", "Landing header");
      main = await layout("main", mainHeader, "published");
      landing = await layout("landing", landingHeader, "published");
      unpublished = await layout("unpublished", landingHeader, "draft");
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { defaultLayout: main }
      );

      await page("names-landing", landing);
      await page("names-nothing", null);
      await page("names-unpublished", unpublished);

      // The positive control: each page is drawn inside the Layout it gets.
      expect(await render("names-landing")).toContain("Landing header");
      expect(await render("names-nothing")).toContain("Main header");
      expect(await render("names-unpublished")).toContain("Main header");
    });

    afterAll(async () => {
      registerCachedRead(async () => undefined, false);
      await t?.destroy();
    });

    async function publish(id: string, title: string): Promise<void> {
      expired.length = 0;
      await t.nextly.update({
        collection: LAYOUTS_SLUG,
        id,
        data: { title, status: "published", _overwrite: true },
        overrideAccess: true,
      });
      // The write did expire something: a test of "no page was hit" against
      // a write that expired nothing would pass for the wrong reason.
      expect(expired.length).toBeGreaterThan(0);
    }

    it("publishing the default rebuilds each page that uses it once, and not the others", async () => {
      await publish(main, "Main, again");
      expect(hits()).toEqual({
        "names-landing": 0,
        "names-nothing": 1,
        "names-unpublished": 1,
      });
    });

    it("publishing a page's own Layout rebuilds that page once, and not the others", async () => {
      await publish(landing, "Landing, again");
      expect(hits()).toEqual({
        "names-landing": 1,
        "names-nothing": 0,
        "names-unpublished": 0,
      });
    });

    it("publishing the Layout a page fell back from rebuilds that page once", async () => {
      await publish(unpublished, "Unpublished, now published");
      expect(hits()).toEqual({
        "names-landing": 0,
        "names-nothing": 0,
        "names-unpublished": 1,
      });
    });

    it("changing the default through the settings Single rebuilds each dependent page once", async () => {
      expired.length = 0;
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { defaultLayout: landing }
      );
      expect(expired.length).toBeGreaterThan(0);
      expect(hits()).toEqual({
        "names-landing": 0,
        "names-nothing": 1,
        // It now names a published Layout of its own, but it was cached while
        // it depended on the default, which is what this write must reach.
        "names-unpublished": 1,
      });
    });

    it("a page cached while the settings could not be read is rebuilt by the next settings write", async () => {
      // The provider fails, so the page renders with no regions. What it is
      // cached on must still carry the settings tag: otherwise it would stay
      // headerless after the settings recover, with nothing to rebuild it.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const html = await render(
        "names-nothing",
        {
          nextly: {
            findSingle: async () => {
              throw new Error("settings unavailable");
            },
          },
        },
        "names-nothing-unreadable"
      );
      warn.mockRestore();
      expect(html).toContain("Body of names-nothing");
      expect(html).not.toContain("data-nextly-region");

      expired.length = 0;
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { defaultLayout: main }
      );
      expect(hits()["names-nothing-unreadable"]).toBe(1);
    });
  }
);
