/**
 * A translated component read in a language falls back only through the
 * languages its document is published in, as the document's own translated
 * fields do. A language the document holds only as a draft is skipped, and
 * its component values are not read by a public reader.
 */
import { afterEach, describe, expect, it } from "vitest";

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
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
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
  }
);
