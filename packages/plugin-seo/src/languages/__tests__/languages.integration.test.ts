/**
 * A multilingual site, against a real boot on every configured dialect:
 * each page's head links its versions in the languages it is published in,
 * reciprocally and itself included, with `x-default` at the default
 * language's; the sitemap lists each version with the same links; a
 * language a page is not translated into, or whose translation is a draft,
 * is in neither; SEO text is kept per language; and a language served on a
 * domain of its own is linked there.
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
import { defineCollection, text, type LanguageAddressRule } from "nextly";
import {
  createDynamicHandlers,
  createPublicContentRoute,
  type ContentEntry,
} from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { lastCatchUp } from "../../address-record/catch-up";
import { seoPlugin } from "../../plugin";

const SITE = "https://acme.example";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * A site in English, German and French, its pages' addresses translated:
 * `about` is published in English and German and its French translation is
 * a draft; `team` is published in English alone.
 */
async function boot(dialect: TestDialect, rule?: LanguageAddressRule) {
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
    languageAddresses: rule ?? { by: "prefix" },
    plugins: [seoPlugin({ collections: ["pages"], baseUrl: SITE })],
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        // Each language is published on its own.
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "slug", localized: true }),
          text({ name: "title", localized: true }),
        ],
        publicAddress: "/{slug}",
      }),
    ],
  });
  const t = current;
  const about = await t.nextly.create({
    collection: "pages",
    locale: "en",
    data: {
      slug: "about",
      title: "About us",
      status: "published",
      seo: { metaTitle: "About Acme" },
    },
  });
  const id = String(about.item.id);
  await t.nextly.update({
    collection: "pages",
    id,
    locale: "de",
    data: {
      slug: "ueber",
      title: "Über uns",
      status: "published",
      seo: { metaTitle: "Über Acme" },
      _overwrite: true,
    },
  });
  await t.nextly.update({
    collection: "pages",
    id,
    locale: "fr",
    data: { slug: "a-propos", title: "À propos", _overwrite: true },
  });
  await t.nextly.create({
    collection: "pages",
    locale: "en",
    data: { slug: "team", title: "Team", status: "published" },
  });
  // The address record, brought up to date at start, finished.
  await lastCatchUp();
  return t;
}

/** The head of the page at `slug` in `locale`, as a `[locale]` route serves it. */
async function headOf(t: TestNextly, locale: string, slug: string) {
  const route = createPublicContentRoute({
    collections: ["pages"],
    nextly: t.nextly,
    render: (entry: ContentEntry) => entry.title,
  });
  return route.generateMetadata({ params: { locale, slug: [slug] } });
}

// Segments after `/api/`, as the catch-all splits the sitemap's path.
const SITEMAP_PARAMS = ["plugins", "@nextlyhq", "plugin-seo", "sitemap.xml"];

/** The sitemap, as the plugin's route serves it to a request on `host`. */
async function sitemap(host = "acme.example"): Promise<string> {
  const response = await createDynamicHandlers().GET(
    new Request(`https://${host}/api/plugins/@nextlyhq/plugin-seo/sitemap.xml`),
    { params: Promise.resolve({ params: SITEMAP_PARAMS }) }
  );
  expect(response.status).toBe(200);
  return response.text();
}

/** Each `<url>` of a sitemap: its `<loc>`, and its language links in order. */
function entries(xml: string): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [, url = ""] of xml.matchAll(/<url>(.*?)<\/url>/g)) {
    const loc = /<loc>([^<]*)<\/loc>/.exec(url)?.[1] ?? "";
    found[loc] = [
      ...url.matchAll(
        /<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g
      ),
    ].map(([, hreflang, href]) => `${hreflang} ${href}`);
  }
  return found;
}

describe.each(getConfiguredTestDialects())(
  "a multilingual site's language links (%s)",
  dialect => {
    it("links each version of a page from every other, itself included, and x-default at the default language's", async () => {
      const t = await boot(dialect);
      const links = {
        en: "/en/about",
        de: "/de/ueber",
        "x-default": "/en/about",
      };

      const german = await headOf(t, "de", "ueber");
      const english = await headOf(t, "en", "about");

      expect(german.alternates?.languages).toEqual(links);
      expect(english.alternates?.languages).toEqual(links);
      // Each version's own canonical is the address the others link to.
      expect(german.alternates?.canonical).toBe(links.de);
      expect(english.alternates?.canonical).toBe(links.en);
    });

    it("links no language a page is not published in: a page in one language has none", async () => {
      const t = await boot(dialect);

      const team = await headOf(t, "en", "team");

      expect(team.alternates?.canonical).toBe("/en/team");
      expect(team.alternates?.languages).toBeUndefined();
    });

    it("links a translation once it is published, and drops it again when it is withdrawn", async () => {
      const t = await boot(dialect);
      const [about] = (
        await t.nextly.find({
          collection: "pages",
          where: { slug: { equals: "about" } },
        })
      ).items;
      const id = String(about?.id);
      await t.nextly.update({
        collection: "pages",
        id,
        locale: "fr",
        data: { status: "published", _overwrite: true },
      });

      expect((await headOf(t, "en", "about")).alternates?.languages).toEqual({
        en: "/en/about",
        de: "/de/ueber",
        fr: "/fr/a-propos",
        "x-default": "/en/about",
      });

      await t.nextly.update({
        collection: "pages",
        id,
        locale: "de",
        data: { status: "draft", _overwrite: true },
      });

      expect((await headOf(t, "en", "about")).alternates?.languages).toEqual({
        en: "/en/about",
        fr: "/fr/a-propos",
        "x-default": "/en/about",
      });
    });

    it("lists each published version in the sitemap with the same links, and no draft or missing translation", async () => {
      await boot(dialect);

      const listed = entries(await sitemap());

      const links = [
        `en ${SITE}/en/about`,
        `de ${SITE}/de/ueber`,
        `x-default ${SITE}/en/about`,
      ];
      expect(listed).toEqual({
        [`${SITE}/en/about`]: links,
        [`${SITE}/de/ueber`]: links,
        [`${SITE}/en/team`]: [],
      });
    });

    it("keeps SEO text per language", async () => {
      const t = await boot(dialect);

      expect((await headOf(t, "en", "about")).title).toBe("About Acme");
      expect((await headOf(t, "de", "ueber")).title).toBe("Über Acme");
      const [english] = (
        await t.nextly.find({
          collection: "pages",
          locale: "en",
          where: { slug: { equals: "about" } },
        })
      ).items;
      expect((english?.seo as { metaTitle?: string }).metaTitle).toBe(
        "About Acme"
      );
    });

    it("links a language served on a domain of its own at that domain, and leaves it to that domain's sitemap", async () => {
      const t = await boot(dialect, {
        by: "domain",
        domains: {
          en: SITE,
          de: "https://acme.de",
          fr: "https://acme.fr",
        },
      });
      const links = {
        en: `${SITE}/about`,
        de: "https://acme.de/ueber",
        "x-default": `${SITE}/about`,
      };

      expect((await headOf(t, "de", "ueber")).alternates?.languages).toEqual(
        links
      );
      expect((await headOf(t, "en", "about")).alternates?.languages).toEqual(
        links
      );
      expect(entries(await sitemap())).toEqual({
        [`${SITE}/about`]: [
          `en ${SITE}/about`,
          "de https://acme.de/ueber",
          `x-default ${SITE}/about`,
        ],
        [`${SITE}/team`]: [],
      });
    });
  }
);
