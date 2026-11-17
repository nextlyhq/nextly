/**
 * A translated component read in a language falls back only through the
 * languages its document is published in, as the document's own translated
 * fields do. A language the document holds only as a draft is skipped, and
 * its component values are not read by a public reader.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const PAGES = "crl_pages";
const HOME = "crl_home";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    fieldGroups: [
      defineFieldGroup({
        slug: "crl_seo",
        localized: true,
        fields: [text({ name: "metaTitle" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "seo", component: "crl_seo" }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: HOME,
        localized: true,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "seo", component: "crl_seo" }),
        ],
      }),
    ],
    // Spanish falls back through German, so a read falling back through
    // Spanish passes Spanish, German and then English.
    localization: {
      locales: ["en", { code: "es", fallbackLocale: ["de"] }, "fr", "de"],
      defaultLocale: "en",
    },
  });
  return current;
}

/** The Single service, as reads and writes reach it. */
const singlesOf = (t: TestNextly) =>
  t.getService("singleEntryService") as unknown as {
    update(
      slug: string,
      data: Record<string, unknown>,
      options: Record<string, unknown>
    ): Promise<{ success: boolean }>;
    get(
      slug: string,
      options: Record<string, unknown>
    ): Promise<{
      success: boolean;
      statusCode?: number;
      data?: Record<string, unknown> | null;
    }>;
  };

describe.each(getConfiguredTestDialects())(
  "a translated component read in a language (integration, %s)",
  dialect => {
    // Published in English and French, French with no component value of
    // its own; Spanish a draft holding one. A French read falling back
    // through Spanish skips the Spanish draft and reads the English value.
    it("falls back past an entry's draft language in a component", async () => {
      const t = await boot(dialect);
      const id = String(
        (
          await t.nextly.create({
            collection: PAGES,
            locale: "en",
            data: {
              title: "Page",
              seo: { metaTitle: "SEO in English" },
              status: "published",
            },
          })
        ).item.id
      );
      await t.nextly.update({
        collection: PAGES,
        id,
        locale: "fr",
        data: {
          title: "Page en français",
          status: "published",
          _overwrite: true,
        },
      });
      await t.nextly.update({
        collection: PAGES,
        id,
        locale: "es",
        data: {
          title: "Borrador",
          seo: { metaTitle: "SEO borrador" },
          status: "draft",
          _overwrite: true,
        },
      });

      // The draft is there to a trusted reader.
      const draft = (await t.nextly.findByID({
        collection: PAGES,
        id,
        locale: "es",
        status: "all",
      })) as Record<string, unknown>;
      expect(JSON.stringify(draft.seo)).toContain("SEO borrador");

      const read = (await t.nextly.findByID({
        collection: PAGES,
        id,
        locale: "fr",
        fallbackLocale: "es",
        status: "published",
      })) as Record<string, unknown>;
      expect(read.title).toBe("Page en français");
      expect(JSON.stringify(read)).not.toContain("borrador");
      expect(JSON.stringify(read.seo)).toContain("SEO in English");
    }, 90_000);

    // Three pages, all published in English and in French with no component
    // value of their own there, each holding Spanish and German differently:
    // A both as drafts, B Spanish as a draft and German published, C Spanish
    // published and German a draft. A French list read falling back through
    // Spanish, German, then English fills every page's components in ONE
    // batch, and each page still skips the languages it alone is not
    // published in: a page given another's set reads a different value.
    it("fills a list's components in one batch, each page skipping its own draft languages", async () => {
      const t = await boot(dialect);
      /** A page written language by language, each with its own status. */
      const page = async (
        writes: readonly [string, string, "published" | "draft"][]
      ): Promise<string> => {
        const [[firstLocale, firstSeo, firstStatus], ...rest] = writes;
        const id = String(
          (
            await t.nextly.create({
              collection: PAGES,
              locale: firstLocale,
              data: {
                title: `Page ${firstSeo}`,
                seo: { metaTitle: firstSeo },
                status: firstStatus,
              },
            })
          ).item.id
        );
        for (const [locale, seo, status] of rest) {
          await t.nextly.update({
            collection: PAGES,
            id,
            locale,
            data: {
              title: `Page ${seo || locale}`,
              ...(seo ? { seo: { metaTitle: seo } } : {}),
              status,
              _overwrite: true,
            },
          });
        }
        return id;
      };
      const a = await page([
        ["en", "A in English", "published"],
        ["es", "A borrador", "draft"],
        ["de", "A Entwurf", "draft"],
        ["fr", "", "published"],
      ]);
      const b = await page([
        ["en", "B in English", "published"],
        ["es", "B borrador", "draft"],
        ["de", "B auf Deutsch", "published"],
        ["fr", "", "published"],
      ]);
      const c = await page([
        ["en", "C in English", "published"],
        ["es", "C en español", "published"],
        ["de", "C Entwurf", "draft"],
        ["fr", "", "published"],
      ]);

      const populate = vi.spyOn(
        t.getService("fieldGroupDataService"),
        "populateComponentDataMany"
      );
      const listed = await t.nextly.find({
        collection: PAGES,
        locale: "fr",
        fallbackLocale: "es",
        status: "published",
      });
      const populateCalls = populate.mock.calls.length;
      populate.mockRestore();
      // Every page is on the list, so the call below covers three entries.
      expect(
        listed.items.map(item => String(item.id)).sort(),
        JSON.stringify({
          a,
          b,
          c,
          listed: listed.items.map(item => [item.id, item.title]),
        })
      ).toEqual([a, b, c].sort());
      // One population call for the whole page of entries.
      expect(populateCalls).toBe(1);

      const seoOf = (id: string) =>
        JSON.stringify(
          (
            listed.items.find(item => String(item.id) === id) as
              | Record<string, unknown>
              | undefined
          )?.seo ?? null
        );
      // A skips both drafts and reads its English value.
      expect(seoOf(a)).toContain("A in English");
      // B skips its Spanish draft and reads its published German value.
      expect(seoOf(b)).toContain("B auf Deutsch");
      // C reads its published Spanish value before its German draft.
      expect(seoOf(c)).toContain("C en español");
      expect(JSON.stringify(listed.items)).not.toMatch(/borrador|Entwurf/);
    }, 90_000);

    // A read of every language carries each language's component values
    // beside the document, as it carries the document's own, and on a public
    // read only the languages the document is published in.
    it("carries every published language's component values beside a read of every language", async () => {
      const t = await boot(dialect);
      const id = String(
        (
          await t.nextly.create({
            collection: PAGES,
            locale: "en",
            data: {
              title: "Page",
              seo: { metaTitle: "SEO in English" },
              status: "published",
            },
          })
        ).item.id
      );
      await t.nextly.update({
        collection: PAGES,
        id,
        locale: "fr",
        data: {
          title: "Page en français",
          seo: { metaTitle: "SEO en français" },
          status: "published",
          _overwrite: true,
        },
      });
      await t.nextly.update({
        collection: PAGES,
        id,
        locale: "es",
        data: {
          title: "Borrador",
          seo: { metaTitle: "SEO borrador" },
          status: "draft",
          _overwrite: true,
        },
      });

      const trusted = await t.nextly.findByID({
        collection: PAGES,
        id,
        locale: "all",
        status: "all",
      });
      expect(JSON.stringify(trusted)).toContain("SEO borrador");

      const read = await t.nextly.findByID({
        collection: PAGES,
        id,
        locale: "all",
        status: "published",
      });
      const beside = JSON.stringify(
        (read as Record<string, unknown>)._allLocales
      );
      expect(beside).toContain("SEO in English");
      expect(beside).toContain("SEO en français");
      expect(JSON.stringify(read)).not.toContain("borrador");
    }, 90_000);

    it("falls back past a Single's draft language in a component", async () => {
      const t = await boot(dialect);
      const singles = singlesOf(t);
      for (const [locale, data] of [
        [
          "en",
          {
            title: "Home",
            seo: { metaTitle: "SEO in English" },
            status: "published",
          },
        ],
        ["fr", { title: "Accueil", status: "published" }],
        [
          "es",
          {
            title: "Borrador",
            seo: { metaTitle: "SEO borrador" },
            status: "draft",
          },
        ],
      ] as const) {
        const saved = await singles.update(
          HOME,
          { ...data, _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }

      const draft = await singles.get(HOME, {
        locale: "es",
        status: "all",
        overrideAccess: true,
      });
      expect(JSON.stringify(draft.data?.seo)).toContain("SEO borrador");

      const read = await singles.get(HOME, {
        locale: "fr",
        fallbackLocale: "es",
        status: "published",
      });
      expect(read.data?.title, JSON.stringify(read)).toBe("Accueil");
      expect(JSON.stringify(read.data)).not.toContain("borrador");
      expect(JSON.stringify(read.data?.seo)).toContain("SEO in English");
    }, 90_000);

    // As for an entry: a Single read of every language carries each
    // language's component values beside it, and on a public read only the
    // languages it is published in.
    it("carries every published language's component values beside a Single's read of every language", async () => {
      const t = await boot(dialect);
      const singles = singlesOf(t);
      for (const [locale, data] of [
        [
          "en",
          {
            title: "Home",
            seo: { metaTitle: "SEO in English" },
            status: "published",
          },
        ],
        [
          "fr",
          {
            title: "Accueil",
            seo: { metaTitle: "SEO en français" },
            status: "published",
          },
        ],
        [
          "es",
          {
            title: "Borrador",
            seo: { metaTitle: "SEO borrador" },
            status: "draft",
          },
        ],
      ] as const) {
        const saved = await singles.update(
          HOME,
          { ...data, _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
      }

      const trusted = await singles.get(HOME, {
        translations: "all",
        status: "all",
        overrideAccess: true,
      });
      expect(JSON.stringify(trusted.data?._allLocales)).toContain(
        "SEO borrador"
      );

      const read = await singles.get(HOME, {
        translations: "all",
        status: "published",
      });
      const beside = JSON.stringify(read.data?._allLocales);
      expect(beside).toContain("SEO in English");
      expect(beside).toContain("SEO en français");
      expect(JSON.stringify(read.data)).not.toContain("borrador");
    }, 90_000);
  }
);
