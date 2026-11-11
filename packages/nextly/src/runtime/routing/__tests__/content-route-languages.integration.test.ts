/**
 * A content route under a `[locale]` segment, against a real boot on every
 * configured dialect: one route serves each of the site's languages, reads
 * the language from the segment, answers any other segment as not found,
 * scans each language's own paths at build, and forms the addresses it hands
 * on (a list's first-page redirect) by the site's language rule. A Single
 * route reads its language the same way, and the rule answers both
 * strategies.
 *
 * `next/navigation` is stood in for, so a not-found and a redirect are told
 * apart by what they throw.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { languageAddressOf } from "../../../domains/i18n/language-addresses";
import type { LanguageAddressRule } from "../../../domains/i18n/config/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createPublicContentRoute } from "../content-route";
import type { ContentEntry } from "../resolve-content";
import { createPublicSingleRoute } from "../single-route";

vi.mock("../../next-api", () => ({
  loadNextModule: () => ({
    connection: async () => undefined,
    notFound: () => {
      throw new Error("not found");
    },
    permanentRedirect: (path: string) => {
      throw new Error(`permanent redirect to ${path}`);
    },
  }),
  requireNextApi: (module: Record<string, unknown>, _: string, name: string) =>
    module[name],
}));

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A site in English and German, its pages' addresses translated. */
async function boot(dialect: TestDialect, rule?: LanguageAddressRule) {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    ...(rule === undefined ? {} : { languageAddresses: rule }),
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        access: { read: () => true },
        fields: [
          text({ name: "slug", localized: true }),
          text({ name: "title", localized: true }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        localized: true,
        access: { read: () => true },
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
  });
  const t = current;
  const created = await t.nextly.create({
    collection: "pages",
    locale: "en",
    data: { slug: "about", title: "About us" },
  });
  await t.nextly.update({
    collection: "pages",
    id: String(created.item.id),
    locale: "de",
    data: { slug: "ueber", title: "Über uns", _overwrite: true },
  });
  for (const [locale, headline] of [
    ["en", "Welcome"],
    ["de", "Willkommen"],
  ] as const) {
    await t.nextly.updateSingle({
      slug: "home",
      locale,
      data: { headline, _overwrite: true },
    });
  }
  return t;
}

function pagesRoute(t: TestNextly) {
  return createPublicContentRoute({
    collections: ["pages"],
    nextly: t.nextly,
    // A list of three pages, so the first page's other spelling redirects.
    listPages: () => 3,
    render: (entry: ContentEntry, context) => ({
      title: entry.title,
      locale: context.locale,
    }),
  });
}

describe.each(getConfiguredTestDialects())(
  "a content route under a [locale] segment (%s)",
  dialect => {
    it("serves each language from one route, reading it from the segment", async () => {
      const { ContentPage } = pagesRoute(await boot(dialect));

      expect(
        await ContentPage({ params: { locale: "de", slug: ["ueber"] } })
      ).toEqual({ title: "Über uns", locale: "de" });
      expect(
        await ContentPage({
          params: Promise.resolve({ locale: "en", slug: ["about"] }),
        })
      ).toEqual({ title: "About us", locale: "en" });

      // A language's own address only: the English one is not a German page.
      await expect(
        ContentPage({ params: { locale: "de", slug: ["about"] } })
      ).rejects.toThrow("not found");
      // Nor is a segment naming none of the site's languages a page.
      await expect(
        ContentPage({ params: { locale: "fr", slug: ["about"] } })
      ).rejects.toThrow("not found");
    });

    it("builds each language's own paths, as the layout hands it the language", async () => {
      const { generateStaticParams } = pagesRoute(await boot(dialect));

      const de = await generateStaticParams({ params: { locale: "de" } });
      expect(de.filter(p => !p.slug.includes("page"))).toEqual([
        { slug: ["ueber"] },
      ]);
      const en = await generateStaticParams({
        params: Promise.resolve({ locale: "en" }),
      });
      expect(en.filter(p => !p.slug.includes("page"))).toEqual([
        { slug: ["about"] },
      ]);
      expect(await generateStaticParams({ params: { locale: "fr" } })).toEqual(
        []
      );
    });

    it("hands on addresses formed by the site's rule", async () => {
      const { ContentPage } = pagesRoute(
        await boot(dialect, { by: "prefix", defaultLanguage: "unprefixed" })
      );

      await expect(
        ContentPage({ params: { locale: "de", slug: ["ueber", "page", "1"] } })
      ).rejects.toThrow("permanent redirect to /de/ueber");
      await expect(
        ContentPage({ params: { locale: "en", slug: ["about", "page", "1"] } })
      ).rejects.toThrow("permanent redirect to /about");
    });

    it("serves a Single in the language its segment names", async () => {
      await boot(dialect);
      const { SinglePage } = createPublicSingleRoute({
        slug: "home",
        nextly: current?.nextly,
        render: (document, context) => ({
          headline: document.headline,
          locale: context.locale,
        }),
      });

      expect(await SinglePage({ params: { locale: "de" } })).toEqual({
        headline: "Willkommen",
        locale: "de",
      });
      expect(await SinglePage({ params: { locale: "en" } })).toEqual({
        headline: "Welcome",
        locale: "en",
      });
      await expect(SinglePage({ params: { locale: "fr" } })).rejects.toThrow(
        "not found"
      );
    });

    it("forms a language's address by prefix or by domain, as declared", async () => {
      await boot(dialect);
      // Declaring nothing, every language is prefixed.
      expect(await languageAddressOf("/ueber", "de")).toEqual({
        status: "resolved",
        path: "/de/ueber",
      });
      await current?.destroy();
      current = undefined;

      await boot(dialect, {
        by: "domain",
        domains: { en: "https://example.com", de: "https://example.de" },
      });
      expect(await languageAddressOf("/ueber", "de")).toEqual({
        status: "resolved",
        origin: "https://example.de",
        path: "/ueber",
      });
      expect(await languageAddressOf("/about", "en")).toEqual({
        status: "resolved",
        origin: "https://example.com",
        path: "/about",
      });
    });
  }
);
