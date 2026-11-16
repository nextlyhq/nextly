/**
 * The site's cached content route is refreshed by every publish and
 * unpublish of what a page is drawn from, through the real path.
 *
 * The route is the one the page-builder docs show for the site:
 * `createPublicContentPage` over `pageBuilderContent()`, drawing each page
 * inside its Layout with the site style. Every cached read its render makes
 * goes through nextly's own `cachedFind`, into the cached-read function an
 * app registers under Cache Components; the one registered here records the
 * tags it is handed and then reads. Under Next.js a read nested in a page's
 * render puts its tags on that page's cache entry, so the tags recorded during
 * the render are what the page is cached under.
 *
 * Writes go through the real Direct API, and the invalidation is the
 * production adapter's: `NextCacheRevalidator` over a `next/cache` whose
 * `revalidateTag` records each tag it expires. A write refreshes the page when
 * it expires a tag the page carries, and the page drawn again afterwards shows
 * the change. Next.js's own propagation and matching of tags need a running
 * server: `e2e/tests/production/cached-site-pages.spec.ts` covers them as "the
 * page changes after a publish".
 *
 * @module __tests__/cached-site-pages.integration.test
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createPublicContentPage } from "@nextlyhq/blocks-react/next";
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { pageBuilderContent } from "../page-content";
import { pageBuilderLayouts } from "../page-layouts";
import { pageBuilder } from "../plugin";
import { loadSiteStyle } from "../site-style-load";
import { SITE_STYLE_SLUG } from "../site-style-storage";

const SLUG = "cached-page";
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

const idOf = (created: unknown) =>
  String((created as { item: { id: string | number } }).item.id);

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

/** The tags each cached read was handed, while the page is being rendered. */
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
  "the site's cached page is refreshed by what it is drawn from (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let pageId = "";
    let headerId = "";
    let partId = "";
    let layoutId = "";
    /** The tags the page is cached under, from its last render. */
    let pageTags = new Set<string>();

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

    function pageDocument(text: string) {
      return {
        formatVersion: 1,
        kind: "page",
        nodes: [
          heading("cached-body", text),
          {
            id: "cached-place",
            type: "nextly/component-instance",
            version: 1,
            props: { componentId: partId },
          },
        ],
      };
    }

    /** The page as the docs' route draws it, recording what it is cached under. */
    async function render(): Promise<string> {
      const route = createPublicContentPage({
        ...pageBuilderContent({ nextly: t.nextly as never }),
        pages: {
          collections: ["pages"],
          field: "content",
          nextly: t.nextly as never,
          blocks: createBlockResolver(coreBlocks),
          layouts: pageBuilderLayouts({ nextly: t.nextly as never }),
          siteStyles: {
            read: () => loadSiteStyle({ nextly: t.nextly as never }),
            singles: [SITE_STYLE_SLUG],
          },
        },
      });
      recording = new Set();
      try {
        const element = (await route.ContentPage({
          params: { slug: [SLUG] },
        })) as ReactElement;
        pageTags = recording;
        return renderToStaticMarkup(element);
      } finally {
        recording = undefined;
      }
    }

    /** Runs `write`, and answers whether it expired a tag the page carries. */
    async function reaches(write: () => Promise<unknown>): Promise<boolean> {
      expired.length = 0;
      await write();
      // The write did expire something: "the page was not hit" against a
      // write that expired nothing would pass for the wrong reason.
      expect(expired.length).toBeGreaterThan(0);
      return expired.some(tag => pageTags.has(tag));
    }

    beforeAll(async () => {
      // The production adapter, over a `next/cache` that records. Registered
      // before boot so the services keep it rather than the no-op default.
      container.registerSingleton(
        "cacheRevalidator",
        () => new NextCacheRevalidator(() => nextCache)
      );
      // The app's cached-read function, as Cache Components registers it:
      // record the tags of a read that succeeded, then answer it.
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
      // A header component in the site's default Layout, a component the page
      // places, and the page.
      headerId = await component("cached-header", "Header one");
      partId = await component("cached-part", "Part one");
      layoutId = idOf(
        await t.nextly.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: "Main",
            slug: "main",
            areas: [{ area: "header", component: headerId }],
            status: "published",
          },
          overrideAccess: true,
        })
      );
      pageId = idOf(
        await t.nextly.create({
          collection: "pages",
          data: {
            title: "Cached",
            slug: SLUG,
            content: pageDocument("Page one"),
            // Its own Layout rather than the site's default, which cannot be
            // unpublished while it is the default.
            layout: layoutId,
            status: "published",
          },
          overrideAccess: true,
        })
      );
      // The positive control: the page, its header and the part it places.
      const html = await render();
      expect(html).toContain("Page one");
      expect(html).toContain("Header one");
      expect(html).toContain("Part one");
    });

    afterAll(async () => {
      registerCachedRead(async () => undefined, false);
      await t?.destroy();
    });

    async function publishComponent(id: string, text: string): Promise<void> {
      await t.nextly.update({
        collection: "components",
        id,
        data: {
          content: {
            formatVersion: 1,
            kind: "component",
            nodes: [heading(`${id}-h`, text)],
          },
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });
    }

    async function setStatus(
      collection: string,
      id: string,
      status: "published" | "draft"
    ): Promise<void> {
      await t.nextly.update({
        collection,
        id,
        data: { status, _overwrite: true },
        overrideAccess: true,
      });
    }

    it("a publish of the page itself reaches it, and shows", async () => {
      await render();
      expect(
        await reaches(() =>
          t.nextly.update({
            collection: "pages",
            id: pageId,
            data: {
              content: pageDocument("Page two"),
              status: "published",
              _overwrite: true,
            },
            overrideAccess: true,
          })
        )
      ).toBe(true);
      expect(await render()).toContain("Page two");
    });

    it("a publish of its header reaches it; its Layout is not unpublished by a status write", async () => {
      await render();
      expect(
        await reaches(() => publishComponent(headerId, "Header two"))
      ).toBe(true);
      expect(await render()).toContain("Header two");
      // A Layout in use is taken down only through Remove Layout, which moves
      // its pages first, so the cached page is never left drawn inside a
      // Layout that is no longer published.
      await expect(setStatus(LAYOUTS_SLUG, layoutId, "draft")).rejects.toThrow(
        /Remove Layout/
      );
      expect(await render()).toContain("Header two");
    });

    it("a publish of a component it places reaches it; its unpublish is refused while placed", async () => {
      await render();
      expect(await reaches(() => publishComponent(partId, "Part two"))).toBe(
        true
      );
      expect(await render()).toContain("Part two");
      // A placed component cannot be unpublished, so the cached page can
      // never be left drawing a gap where it was.
      await expect(setStatus("components", partId, "draft")).rejects.toThrow(
        /can't be unpublished/
      );
      expect(await render()).toContain("Part two");
    });

    it("a save of the site style reaches it", async () => {
      await render();
      expect(
        await reaches(() =>
          t.nextly.updateSingle({
            slug: SITE_STYLE_SLUG,
            data: {
              tokens: {
                tokens: [
                  {
                    name: "color.cached",
                    kind: "color",
                    values: { light: "#0a1b2c", dark: "#2c1b0a" },
                  },
                ],
              },
              _overwrite: true,
            },
            overrideAccess: true,
          })
        )
      ).toBe(true);
      // The site sheet is not part of the markup rendered here; the served
      // page carrying the new variable is the production browser test's.
    });

    it("an unpublish of the page reaches it, and it answers not found", async () => {
      await render();
      expect(await reaches(() => setStatus("pages", pageId, "draft"))).toBe(
        true
      );
      await expect(render()).rejects.toMatchObject(NOT_FOUND);
    });
  }
);
