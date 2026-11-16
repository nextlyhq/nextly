/**
 * A content type's SEO switched off in the settings, on every configured
 * dialect: its pages are answered nothing by the plugin (their route's own
 * code sets their head, and they are not sent `noindex`), the sitemap lists
 * none of them, and every stored value and address stays, so a clash is
 * still refused and switching the type on again brings everything back.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import {
  createDynamicHandlers,
  createPublicContentRoute,
  type ContentEntry,
} from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../contract";

const SITE = "https://acme.example";
// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const PAGES = "seooff_pages";
const POSTS = "seooff_posts";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a content type with its SEO switched off (%s)",
  (dialect: TestDialect) => {
    async function boot(exclude?: string[]) {
      current = await createTestNextly({
        dialect,
        plugins: [
          seoPlugin({
            baseUrl: SITE,
            ...(exclude === undefined ? {} : { exclude }),
          }),
        ],
        collections: [PAGES, POSTS].map(slug =>
          defineCollection({
            slug,
            status: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/{slug}",
          })
        ),
      });
      await lastCatchUp();
      await current.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: { _overwrite: true, siteName: "Acme" },
        overrideAccess: true,
      });
      return current;
    }

    async function switchOff(t: TestNextly, types: string[]) {
      await t.nextly.updateSingle({
        slug: SEO_SETTINGS_SLUG,
        data: { _overwrite: true, typesWithSeoOff: types },
        overrideAccess: true,
      });
    }

    /** The head of the page at `slug`, as a public route serves it. */
    async function headOf(t: TestNextly, slug: string) {
      const route = createPublicContentRoute({
        collections: [PAGES],
        nextly: t.nextly,
        render: (entry: ContentEntry) => entry.title,
      });
      return route.generateMetadata({ params: { slug: [slug] } });
    }

    async function sitemap(): Promise<string> {
      const response = await createDynamicHandlers().GET(
        new Request(`${SITE}/admin/api/sitemap.xml`),
        { params: Promise.resolve({ params: ["sitemap.xml"] }) }
      );
      return response.text();
    }

    it("answers its pages nothing and lists none, keeping every value, until it is on again", async () => {
      const t = await boot();
      await t.nextly.create({
        collection: PAGES,
        data: {
          title: "About",
          slug: "about",
          status: "published",
          seo: { metaTitle: "About Acme, typed", noindex: true },
        },
      });
      const on = await headOf(t, "about");
      expect(on.title).toEqual({ absolute: "About Acme, typed" });
      expect(on.robots).toMatchObject({ index: false });

      await switchOff(t, [PAGES]);
      const off = await headOf(t, "about");
      // Nothing of the plugin's: not the typed title, not its noindex.
      expect(JSON.stringify(off)).not.toContain("About Acme, typed");
      expect(off.robots).toBeUndefined();
      expect(await sitemap()).not.toContain(`${SITE}/about`);

      await switchOff(t, []);
      const back = await headOf(t, "about");
      expect(back.title).toEqual({ absolute: "About Acme, typed" });
      expect(back.robots).toMatchObject({ index: false });
    });

    it("lists the type's pages again in the sitemap once it is on", async () => {
      const t = await boot();
      await t.nextly.create({
        collection: PAGES,
        data: { title: "Team", slug: "team", status: "published" },
      });
      await switchOff(t, [PAGES]);
      expect(await sitemap()).not.toContain(`${SITE}/team`);
      await switchOff(t, []);
      expect(await sitemap()).toContain(`${SITE}/team`);
    });

    it("reads every type as on while the database waits to be migrated for the switch", async () => {
      const t = await boot();
      await t.nextly.create({
        collection: PAGES,
        data: {
          title: "About",
          slug: "about",
          status: "published",
          seo: { metaTitle: "About Acme, typed" },
        },
      });
      await switchOff(t, [PAGES]);
      // As a site that upgraded and has not run its migration: the settings
      // table has no column for the switch. Raw SQL, and only in a test: no
      // API removes a column a Single declares.
      await t.adapter.executeQuery(
        "ALTER TABLE single_seo_settings DROP COLUMN types_with_seo_off"
      );
      const head = await headOf(t, "about");
      expect(head.title).toEqual({ absolute: "About Acme, typed" });
      expect(await sitemap()).toContain(`${SITE}/about`);
    });

    it("ignores the switch for a type the site gives no SEO, in every output", async () => {
      // Posts are left out in the configuration: a stale key naming them,
      // saved before, switches nothing off.
      const t = await boot([POSTS]);
      await t.nextly.create({
        collection: POSTS,
        data: { title: "Launch", slug: "launch", status: "published" },
      });
      await switchOff(t, [POSTS]);
      expect(await sitemap()).toContain(`${SITE}/launch`);
    });

    it("still refuses another page taking one of its addresses", async () => {
      const t = await boot();
      await t.nextly.create({
        collection: PAGES,
        data: { title: "About", slug: "about", status: "published" },
      });
      await switchOff(t, [PAGES]);
      await expect(
        t.nextly.create({
          collection: POSTS,
          data: { title: "About", slug: "about", status: "published" },
        })
      ).rejects.toMatchObject({ code: "DUPLICATE" });
    });
  }
);
