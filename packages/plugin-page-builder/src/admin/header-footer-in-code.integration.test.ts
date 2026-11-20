/**
 * Switching a site to draw its header and footer in code, and back, keeps
 * what it stored: the editor only stops showing the header & footer tools
 * (`header-footer-in-code.ts`), so the sets and each page's choice are there,
 * unchanged, when the site switches back to the Page Builder's.
 *
 * The site is started three times on one database: the Page Builder's header
 * and footer, then code, then the Page Builder's again. Not on SQLite: a start
 * of this harness there builds the plugin's tables afresh.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  adapterOn,
  siteDatabase,
  type SiteDatabase,
} from "../__tests__/site-database-harness";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { relationId } from "../default-layout/store";
import { pageBuilder } from "../plugin";

describe.each(getConfiguredTestDialects())(
  "a site switching its header and footer to code and back (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let database: SiteDatabase | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      await database?.drop();
      database = undefined;
    });

    /** The site started on `on`, drawing its header and footer as `mode` says. */
    async function startOn(
      on: SiteDatabase,
      mode: "page-builder" | "code"
    ): Promise<TestNextly> {
      await current?.destroy();
      current = await createTestNextly({
        adapter: await adapterOn(on),
        plugins: [
          pageBuilder(mode === "code" ? { siteHeaderFooter: "code" } : {}),
        ],
      });
      return current;
    }

    /** The set's areas and the page's choice, as stored. */
    async function stored(t: TestNextly, setId: string, pageId: string) {
      const set = await t.nextly.find({
        collection: LAYOUTS_SLUG,
        where: { id: { equals: setId } },
        status: "all",
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      const page = await t.nextly.find({
        collection: PAGES_SLUG,
        where: { id: { equals: pageId } },
        status: "all",
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      const areas = (set.items[0] as { areas?: unknown } | undefined)?.areas;
      const choice = (page.items[0] as { layout?: unknown } | undefined)
        ?.layout;
      return {
        areas: (Array.isArray(areas) ? areas : []).map(area => ({
          area: (area as { area?: unknown }).area,
          component: relationId((area as { component?: unknown }).component),
        })),
        layout: relationId(choice),
      };
    }

    it.skipIf(dialect === "sqlite")(
      "keeps every set and each page's choice through code and back",
      async () => {
        database = await siteDatabase(dialect, "pb_hf_in_code");
        let t = await startOn(database, "page-builder");
        const header = await t.nextly.create({
          collection: "components",
          data: {
            title: "Site header",
            slug: "site-header",
            status: "published",
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [
                {
                  id: "h",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Site", level: "h2" },
                },
              ],
            },
          },
          overrideAccess: true,
        });
        const set = await t.nextly.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: "Main",
            slug: "main",
            status: "published",
            areas: [{ area: "header", component: String(header.item.id) }],
          },
          overrideAccess: true,
        });
        const page = await t.nextly.create({
          collection: PAGES_SLUG,
          data: { title: "About", slug: "about", layout: String(set.item.id) },
          overrideAccess: true,
        });
        const setId = String(set.item.id);
        const pageId = String(page.item.id);
        const before = await stored(t, setId, pageId);
        expect(before).toEqual({
          areas: [{ area: "header", component: String(header.item.id) }],
          layout: setId,
        });

        t = await startOn(database, "code");
        expect(await stored(t, setId, pageId)).toEqual(before);

        t = await startOn(database, "page-builder");
        expect(await stored(t, setId, pageId)).toEqual(before);
      }
    );
  }
);
