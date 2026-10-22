/**
 * Publishing several languages at once asks the publish rule once for each
 * language going live, on a real database.
 *
 * The rule here refuses French alone. Asked once for the whole publish, told
 * every language and no single one, a rule written `locale !== "fr"` lets
 * French go live; asked once per language, it refuses the publish, and since
 * the publish is one transaction, nothing goes live. A publish with no French
 * going live is allowed. Asked as a signed-in user who is not a super-admin,
 * so the rule decides.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { AccessRuleContext } from "../../shared/types/access";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ARTICLES = "articles";
const BANNER = "banner";
const NO_ENGLISH = "noenglishbanner";
const UNPUBLISHABLE = "unpublishablebanner";
const USER = { id: "user-1", isActive: true };

/** Every question the publish rule was asked, in order. */
let asked: { locale?: string; locales: string[] }[] = [];

/** Refuses English, the default language. */
const englishRefused = ({ locale }: AccessRuleContext) => locale !== "en";

/** Refuses French, and records what it was asked. */
const frenchRefused = ({ locale, locales }: AccessRuleContext) => {
  asked.push({ locale, locales: [...locales] });
  return locale !== "fr";
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  asked = [];
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "fr", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: ARTICLES,
        localized: true,
        status: true,
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
          publish: frenchRefused,
        },
        fields: [text({ name: "heading" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        localized: true,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: frenchRefused,
        },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: NO_ENGLISH,
        localized: true,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: englishRefused,
        },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: UNPUBLISHABLE,
        localized: true,
        status: true,
        // Keeps drafts, so a status-less save on a published Single is held.
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => false,
        },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler");
const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

/** An article with a draft in each of `locales`, written by trusted code. */
async function draftArticle(
  t: TestNextly,
  locales: readonly string[]
): Promise<string> {
  const created = await t.nextly.create({
    collection: ARTICLES,
    data: { heading: "en", status: "draft" },
  });
  const { id } = created.item;
  if (typeof id !== "string") throw new TypeError("a created entry has an id");
  for (const locale of locales.filter(code => code !== "en")) {
    await t.nextly.update({
      collection: ARTICLES,
      id,
      locale,
      data: { heading: locale },
    });
  }
  return id;
}

async function mainStatus(t: TestNextly, id: string): Promise<unknown> {
  const entry = await handlerOf(t).getEntry({
    collectionName: ARTICLES,
    entryId: id,
    overrideAccess: true,
  });
  return (entry.data as { status?: unknown } | null)?.status;
}

const publishedLocales = () =>
  asked.filter(question => question.locale !== undefined);

describe.each(getConfiguredTestDialects())(
  "publishing several languages at once asks each language (%s)",
  dialect => {
    it("refuses publishing every language of an entry with a French draft, and publishes nothing", async () => {
      const t = await boot(dialect);
      const id = await draftArticle(t, ["en", "fr", "de"]);
      asked = [];

      const refused = await handlerOf(t).publishAllLocales({
        collectionName: ARTICLES,
        entryId: id,
        overrideAccess: false,
        user: USER,
      });

      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
      expect(await mainStatus(t, id)).toBe("draft");
      // Asked once for each language going live, each told all of them.
      expect(
        publishedLocales()
          .map(question => question.locale)
          .sort()
      ).toEqual(["de", "en", "fr"]);
      for (const question of publishedLocales()) {
        expect([...question.locales].sort()).toEqual(["de", "en", "fr"]);
      }
    });

    it("publishes every language of an entry with no French draft", async () => {
      const t = await boot(dialect);
      const id = await draftArticle(t, ["en", "de"]);

      const allowed = await handlerOf(t).publishAllLocales({
        collectionName: ARTICLES,
        entryId: id,
        overrideAccess: false,
        user: USER,
      });

      expect(allowed.success).toBe(true);
      expect(await mainStatus(t, id)).toBe("published");
    });

    it("refuses publishing every language through the Direct API's every-language write", async () => {
      const t = await boot(dialect);
      const id = await draftArticle(t, ["en", "fr", "de"]);

      await expect(
        t.nextly.update({
          collection: ARTICLES,
          id,
          locale: "*",
          data: { status: "published" },
          overrideAccess: false,
          user: USER,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await mainStatus(t, id)).toBe("draft");
    });

    it("refuses publishing every language of a Single with a French draft, and allows it without one", async () => {
      const t = await boot(dialect);
      // Drafts in English and German first: publishing those is allowed.
      for (const locale of ["en", "de"]) {
        await singlesOf(t).update(
          BANNER,
          { headline: locale },
          { overrideAccess: true, locale }
        );
      }
      const allowed = await singlesOf(t).publishAllLocales(BANNER, {
        overrideAccess: false,
        user: USER,
      });
      expect(allowed.success).toBe(true);

      // Then a French draft: publishing every language now refuses.
      await singlesOf(t).update(
        BANNER,
        { headline: "fr" },
        { overrideAccess: true, locale: "fr" }
      );
      const refused = await singlesOf(t).publishAllLocales(BANNER, {
        overrideAccess: false,
        user: USER,
      });
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("refuses publishing every language of a Single through its every-language write when French would go live", async () => {
      const t = await boot(dialect);
      const publishEvery = () =>
        singlesOf(t).update(
          BANNER,
          { status: "published" },
          { overrideAccess: false, user: USER, locale: "*" }
        );
      for (const locale of ["en", "de"]) {
        await singlesOf(t).update(
          BANNER,
          { headline: locale },
          { overrideAccess: true, locale }
        );
      }
      expect((await publishEvery()).success).toBe(true);

      await singlesOf(t).update(
        BANNER,
        { headline: "fr" },
        { overrideAccess: true, locale: "fr" }
      );
      const refused = await publishEvery();
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("asks the default language when a Single's main row goes live, beside its translations", async () => {
      const t = await boot(dialect);
      // A German draft and no English translation: publishing every language
      // still puts the main row, the default language's shared content, live.
      await singlesOf(t).update(
        NO_ENGLISH,
        { headline: "de" },
        { overrideAccess: true, locale: "de" }
      );
      const refused = await singlesOf(t).publishAllLocales(NO_ENGLISH, {
        overrideAccess: false,
        user: USER,
      });
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("refuses a caller who may not publish before saying which languages hold unreleased work", async () => {
      const t = await boot(dialect);
      // Published in every language, then a German edit held as a draft.
      await singlesOf(t).update(
        UNPUBLISHABLE,
        { headline: "de", status: "published" },
        { overrideAccess: true, locale: "de" }
      );
      await singlesOf(t).update(
        UNPUBLISHABLE,
        { status: "published" },
        { overrideAccess: true, locale: "*" }
      );
      await singlesOf(t).update(
        UNPUBLISHABLE,
        { headline: "de pending" },
        { overrideAccess: true, locale: "de" }
      );
      // The control: a trusted publish of every language meets the held draft.
      const held = await singlesOf(t).update(
        UNPUBLISHABLE,
        { status: "published" },
        { overrideAccess: true, locale: "*" }
      );
      expect(held.statusCode).toBe(409);

      const refused = await singlesOf(t).update(
        UNPUBLISHABLE,
        { status: "published" },
        { overrideAccess: false, user: USER, locale: "*" }
      );
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });
  }
);
