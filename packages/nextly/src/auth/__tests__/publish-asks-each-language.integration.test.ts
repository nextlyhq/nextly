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
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../config";
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
const NO_ENGLISH_ARTICLES = "noenglisharticles";
const GROUPED_ARTICLES = "groupedarticles";
const HELD_PAGES = "heldpages";
const BANNER = "banner";
const NO_ENGLISH = "noenglishbanner";
const UNPUBLISHABLE = "unpublishablebanner";
const GROWING_ARTICLES = "growingarticles";
const GROWING_BANNER = "growingbanner";
const SHARED_ARTICLES = "sharedarticles";
const SHARED_BANNER = "sharedbanner";
const PENDING_PAGES = "pendingpages";
const PENDING_BANNER = "pendingbanner";
const USER = { id: "user-1", isActive: true };

/** Every question the publish rule was asked, in order. */
let asked: { locale?: string; locales: string[] }[] = [];

/** Refuses English, the default language. */
const englishRefused = ({ locale }: AccessRuleContext) => locale !== "en";

/** Refuses anything involving French, by the languages it is told. */
const frenchInvolvedRefused = ({ locales }: AccessRuleContext) =>
  !locales.includes("fr");

/** Each rule ask and each transaction opened, in the order they happened. */
let order: string[] = [];

/** Refuses French, and records what it was asked. */
const frenchRefused = ({ locale, locales }: AccessRuleContext) => {
  asked.push({ locale, locales: [...locales] });
  order.push("ask");
  return locale !== "fr";
};

/**
 * Run once, when the publish rule is first asked, then cleared: a case uses it
 * to change what goes live between the rule's answer and the publish's write,
 * as a concurrent writer could.
 */
let onFirstAsk: (() => Promise<void>) | undefined;

/** Allows, after running `onFirstAsk`. */
const changesWhatGoesLive = async () => {
  const run = onFirstAsk;
  onFirstAsk = undefined;
  await run?.();
  return true;
};

/** Records each transaction the publish opens, beside the rule's asks. */
function recordTransactions(t: TestNextly): void {
  const open = t.adapter.transaction.bind(t.adapter);
  vi.spyOn(t.adapter, "transaction").mockImplementation(((
    ...args: Parameters<typeof open>
  ) => {
    order.push("transaction");
    return open(...args);
  }) as typeof open);
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  asked = [];
  order = [];
  onFirstAsk = undefined;
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "fr", "de"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({
        slug: "articlemeta",
        localized: true,
        fields: [text({ name: "note" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: SHARED_ARTICLES,
        // Not localized: one set of values, shown in every language.
        status: true,
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
          publish: frenchInvolvedRefused,
        },
        fields: [text({ name: "heading" })],
      }),
      defineCollection({
        slug: GROWING_ARTICLES,
        localized: true,
        status: true,
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
          publish: changesWhatGoesLive,
        },
        fields: [text({ name: "heading" })],
      }),
      defineCollection({
        slug: NO_ENGLISH_ARTICLES,
        localized: true,
        status: true,
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
          publish: englishRefused,
        },
        fields: [text({ name: "heading" })],
      }),
      defineCollection({
        slug: GROUPED_ARTICLES,
        localized: true,
        status: true,
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
          publish: frenchRefused,
        },
        fields: [
          text({ name: "heading" }),
          // Its values are stored per language, in the group's own table.
          fieldGroup({ name: "meta", component: "articlemeta" }),
        ],
      }),
      defineCollection({
        slug: HELD_PAGES,
        localized: true,
        status: true,
        // Keeps drafts, so a status-less save on a published entry is held.
        versions: { drafts: true },
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
          publish: () => false,
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: PENDING_PAGES,
        localized: true,
        status: true,
        // Keeps drafts, so a status-less save on a published entry is held.
        versions: { drafts: true },
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
          publish: englishRefused,
        },
        fields: [text({ name: "title" })],
      }),
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
        slug: SHARED_BANNER,
        // Not localized: one set of values, shown in every language.
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: frenchInvolvedRefused,
        },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: GROWING_BANNER,
        localized: true,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: changesWhatGoesLive,
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
        slug: PENDING_BANNER,
        localized: true,
        status: true,
        // Keeps drafts, so a status-less save on a published Single is held.
        versions: { drafts: true },
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

    it("asks the default language when an entry with no translation rows goes live", async () => {
      const t = await boot(dialect);
      // A draft that stores no translation row, as an entry stored before
      // its collection was localized does: its main row, the default
      // language's content, is what publishing every language puts live.
      const created = await t.nextly.create({
        collection: NO_ENGLISH_ARTICLES,
        data: { status: "draft" },
      });
      const { id } = created.item;
      if (typeof id !== "string")
        throw new TypeError("a created entry has an id");
      const translations = `dc_${NO_ENGLISH_ARTICLES}_locales`;
      const ofThisEntry = {
        and: [{ column: "_parent", op: "=" as const, value: id }],
      };
      await t.adapter.delete(translations, ofThisEntry);
      // The state the case is about: no translation row at all.
      expect(
        await t.adapter.select(translations, { where: ofThisEntry })
      ).toHaveLength(0);

      const refused = await handlerOf(t).publishAllLocales({
        collectionName: NO_ENGLISH_ARTICLES,
        entryId: id,
        overrideAccess: false,
        user: USER,
      });
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("asks every configured language when an entry reaches a localized field group", async () => {
      const t = await boot(dialect);
      // English alone in the entry's own table; the field group stores its
      // values per language in a table of its own, which those statuses do
      // not cover, so every language is asked.
      const created = await t.nextly.create({
        collection: GROUPED_ARTICLES,
        data: { heading: "en", status: "draft" },
      });
      const { id } = created.item;
      if (typeof id !== "string")
        throw new TypeError("a created entry has an id");
      asked = [];

      const refused = await handlerOf(t).publishAllLocales({
        collectionName: GROUPED_ARTICLES,
        entryId: id,
        overrideAccess: false,
        user: USER,
      });
      expect(publishedLocales().map(question => question.locale)).toContain(
        "fr"
      );
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("refuses a caller who may not publish an entry before saying which languages hold unreleased work", async () => {
      const t = await boot(dialect);
      // Published in English, then a German edit held as a draft.
      const created = await handlerOf(t).createEntry(
        { collectionName: HELD_PAGES, overrideAccess: true, locale: "en" },
        { title: "en", status: "published" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string")
        throw new TypeError("a created entry has an id");
      await handlerOf(t).updateEntry(
        {
          collectionName: HELD_PAGES,
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { title: "de pending" }
      );
      const publishEvery = (trusted: boolean) =>
        handlerOf(t).updateEntry(
          {
            collectionName: HELD_PAGES,
            entryId: id,
            overrideAccess: trusted,
            ...(trusted ? {} : { user: USER }),
            locale: "*",
          },
          { status: "published" }
        );
      // The control: a trusted publish of every language meets the held draft.
      expect((await publishEvery(true)).statusCode).toBe(409);

      const refused = await publishEvery(false);
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("asks a translation already marked published that publishing the main row exposes", async () => {
      const t = await boot(dialect);
      // English a draft, and French marked published on its own: a read goes
      // by the main row's status, so French is hidden until the main row is
      // published, and publishing every language puts it live.
      const id = await draftArticle(t, ["en", "fr"]);
      await t.nextly.update({
        collection: ARTICLES,
        id,
        locale: "fr",
        data: { status: "published" },
      });
      expect(await mainStatus(t, id)).toBe("draft");
      asked = [];

      const refused = await handlerOf(t).publishAllLocales({
        collectionName: ARTICLES,
        entryId: id,
        overrideAccess: false,
        user: USER,
      });
      expect(publishedLocales().map(question => question.locale)).toContain(
        "fr"
      );
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("asks the publish rule about each language before the publish's transaction opens", async () => {
      // A rule is the app's own code and may read the database; asked on a
      // connection the publish transaction holds, its read would wait for one
      // that transaction keeps.
      const t = await boot(dialect);
      const id = await draftArticle(t, ["en", "de"]);
      for (const locale of ["en", "de"]) {
        await singlesOf(t).update(
          BANNER,
          { headline: locale },
          { overrideAccess: true, locale }
        );
      }
      recordTransactions(t);
      const publishes: Array<() => Promise<{ success: boolean }>> = [
        () =>
          handlerOf(t).publishAllLocales({
            collectionName: ARTICLES,
            entryId: id,
            overrideAccess: false,
            user: USER,
          }),
        () =>
          handlerOf(t).updateEntry(
            {
              collectionName: ARTICLES,
              entryId: id,
              overrideAccess: false,
              user: USER,
              locale: "*",
            },
            { status: "published" }
          ),
        () =>
          singlesOf(t).publishAllLocales(BANNER, {
            overrideAccess: false,
            user: USER,
          }),
        () =>
          singlesOf(t).update(
            BANNER,
            { status: "published" },
            { overrideAccess: false, user: USER, locale: "*" }
          ),
      ];
      for (const publish of publishes) {
        order = [];
        expect((await publish()).success).toBe(true);
        expect(order).toContain("ask");
        expect(order).toContain("transaction");
        expect(order.lastIndexOf("ask")).toBeLessThan(
          order.indexOf("transaction")
        );
      }
    });

    it("refuses with a conflict, publishing nothing, a language that goes live after the rule was asked", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: GROWING_ARTICLES,
        data: { heading: "en", status: "draft" },
      });
      const { id } = created.item;
      if (typeof id !== "string")
        throw new TypeError("a created entry has an id");
      // As the rule answers, a French draft lands: under the lock, French is
      // going live and was never asked about.
      const draftFrench = async () => {
        await t.nextly.update({
          collection: GROWING_ARTICLES,
          id,
          locale: "fr",
          data: { heading: "fr" },
        });
      };

      onFirstAsk = draftFrench;
      const publishAll = await handlerOf(t).publishAllLocales({
        collectionName: GROWING_ARTICLES,
        entryId: id,
        overrideAccess: false,
        user: USER,
      });
      expect(publishAll.success).toBe(false);
      expect(publishAll.statusCode).toBe(409);
      expect(
        (
          await handlerOf(t).getEntry({
            collectionName: GROWING_ARTICLES,
            entryId: id,
            overrideAccess: true,
          })
        ).data
      ).toMatchObject({ status: "draft" });

      // The write to every language that publishes, the same way. French is a
      // draft already, so a German draft is what lands this time.
      onFirstAsk = async () => {
        await t.nextly.update({
          collection: GROWING_ARTICLES,
          id,
          locale: "de",
          data: { heading: "de" },
        });
      };
      const everyLanguage = await handlerOf(t).updateEntry(
        {
          collectionName: GROWING_ARTICLES,
          entryId: id,
          overrideAccess: false,
          user: USER,
          locale: "*",
        },
        { status: "published" }
      );
      expect(everyLanguage.success).toBe(false);
      expect(everyLanguage.statusCode).toBe(409);
    });

    it("answers an entry deleted after the rule was asked as missing, not as a refusal", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: GROWING_ARTICLES,
        data: { heading: "en", status: "draft" },
      });
      const { id } = created.item;
      if (typeof id !== "string")
        throw new TypeError("a created entry has an id");
      // As the rule answers, the entry goes, so the lock finds no row: the
      // comparison has nothing to read and the caller is told it is gone.
      onFirstAsk = async () => {
        await t.nextly.delete({ collection: GROWING_ARTICLES, id });
      };

      const everyLanguage = await handlerOf(t).updateEntry(
        {
          collectionName: GROWING_ARTICLES,
          entryId: id,
          overrideAccess: false,
          user: USER,
          locale: "*",
        },
        { status: "published" }
      );
      expect(everyLanguage.success).toBe(false);
      expect(everyLanguage.statusCode).toBe(404);
    });

    it("refuses a Single's publish of every language with a conflict when a language goes live after the rule was asked", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        GROWING_BANNER,
        { headline: "en" },
        { overrideAccess: true, locale: "en" }
      );
      const draftIn = (locale: string) => async () => {
        await singlesOf(t).update(
          GROWING_BANNER,
          { headline: locale },
          { overrideAccess: true, locale }
        );
      };

      onFirstAsk = draftIn("fr");
      const publishAll = await singlesOf(t).publishAllLocales(GROWING_BANNER, {
        overrideAccess: false,
        user: USER,
      });
      expect(publishAll.success).toBe(false);
      expect(publishAll.statusCode).toBe(409);

      onFirstAsk = draftIn("de");
      const everyLanguage = await singlesOf(t).update(
        GROWING_BANNER,
        { status: "published" },
        { overrideAccess: false, user: USER, locale: "*" }
      );
      expect(everyLanguage.success).toBe(false);
      expect(everyLanguage.statusCode).toBe(409);
    });

    it("tells a publish of content stored the same in every language every language", async () => {
      // Not localized, on a site with languages: publishing it puts the same
      // values live in every language, French included, so a rule refusing
      // anything that involves French refuses it.
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: SHARED_ARTICLES,
        data: { heading: "shared", status: "draft" },
      });
      const { id } = created.item;
      if (typeof id !== "string")
        throw new TypeError("a created entry has an id");
      const entry = await handlerOf(t).publishAllLocales({
        collectionName: SHARED_ARTICLES,
        entryId: id,
        overrideAccess: false,
        user: USER,
      });
      expect(entry.success).toBe(false);
      expect(entry.statusCode).toBe(403);

      await singlesOf(t).update(
        SHARED_BANNER,
        { headline: "shared" },
        { overrideAccess: true }
      );
      const single = await singlesOf(t).publishAllLocales(SHARED_BANNER, {
        overrideAccess: false,
        user: USER,
      });
      expect(single.success).toBe(false);
      expect(single.statusCode).toBe(403);
    });

    it("refuses a caller who may not publish a Single before saying its translations are not ready", async () => {
      const t = await boot(dialect);
      // Its translations table gone before anything is written, as before a
      // migration has run: a write the caller may make is refused with what to
      // run to repair it.
      await t.adapter.executeQuery(
        `DROP TABLE IF EXISTS single_${UNPUBLISHABLE}_locales`
      );
      const publishEvery = (trusted: boolean) =>
        singlesOf(t).update(
          UNPUBLISHABLE,
          { status: "published" },
          trusted
            ? { overrideAccess: true, locale: "*" }
            : { overrideAccess: false, user: USER, locale: "*" }
        );
      // The control: a trusted publish of every language meets the repair
      // message, so the state the case is about holds.
      expect((await publishEvery(true)).statusCode).toBe(409);

      const refused = await publishEvery(false);
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("refuses a caller who may not publish a Single before the work only a publish needs", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        UNPUBLISHABLE,
        { headline: "en" },
        { overrideAccess: true, locale: "en" }
      );
      // The field groups' readiness, which only a publish goes on to need,
      // failing: a caller refused the publish never reaches it.
      vi.spyOn(
        t.getService("fieldGroupDataService"),
        "assertLocalizedFieldGroupsWritable"
      ).mockRejectedValue(new Error("field groups unavailable"));
      const publishAll = (trusted: boolean) =>
        singlesOf(t).publishAllLocales(
          UNPUBLISHABLE,
          trusted
            ? { overrideAccess: true }
            : { overrideAccess: false, user: USER }
        );
      // The control: a trusted publish of every language meets the failure.
      await expect(publishAll(true)).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
      });

      const refused = await publishAll(false);
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
    });

    it("asks the default language when a Single's every-language publish promotes its pending English change", async () => {
      const t = await boot(dialect);
      // Live in every language, then an English edit held as a draft: English
      // is already published, but publishing every language puts the edit live.
      for (const locale of ["en", "fr", "de"]) {
        await singlesOf(t).update(
          PENDING_BANNER,
          { headline: locale, status: "published" },
          { overrideAccess: true, locale }
        );
      }
      await singlesOf(t).update(
        PENDING_BANNER,
        { headline: "en pending" },
        { overrideAccess: true, locale: "en" }
      );
      const liveEnglish = async () =>
        (
          (
            await singlesOf(t).get(PENDING_BANNER, {
              locale: "en",
              overrideAccess: true,
            })
          ).data as { headline?: unknown } | undefined
        )?.headline;
      expect(await liveEnglish()).toBe("en");

      const everyLanguage = await singlesOf(t).update(
        PENDING_BANNER,
        { status: "published" },
        { overrideAccess: false, user: USER, locale: "*" }
      );
      expect(everyLanguage.success).toBe(false);
      expect(everyLanguage.statusCode).toBe(403);
      expect(await liveEnglish()).toBe("en");
      // Publishing every language, which promotes it too, answers the same.
      const publishAll = await singlesOf(t).publishAllLocales(PENDING_BANNER, {
        overrideAccess: false,
        user: USER,
      });
      expect(publishAll.statusCode).toBe(403);
      expect(await liveEnglish()).toBe("en");

      // The control: a trusted publish of every language puts the edit live.
      const trusted = await singlesOf(t).update(
        PENDING_BANNER,
        { status: "published" },
        { overrideAccess: true, locale: "*" }
      );
      expect(trusted.success).toBe(true);
      expect(await liveEnglish()).toBe("en pending");
    });

    it("asks the default language when an entry's every-language publish promotes its pending English change", async () => {
      const t = await boot(dialect);
      // Live in every language, then an English edit held as a draft.
      const created = await handlerOf(t).createEntry(
        { collectionName: PENDING_PAGES, overrideAccess: true, locale: "en" },
        { title: "en", status: "published" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string")
        throw new TypeError("a created entry has an id");
      const write = (locale: string, data: Record<string, unknown>) =>
        handlerOf(t).updateEntry(
          {
            collectionName: PENDING_PAGES,
            entryId: id,
            overrideAccess: true,
            locale,
          },
          data
        );
      await write("fr", { title: "fr", status: "published" });
      await write("de", { title: "de", status: "published" });
      await write("en", { title: "en pending" });
      const liveEnglish = async () =>
        (
          (
            await handlerOf(t).getEntry({
              collectionName: PENDING_PAGES,
              entryId: id,
              overrideAccess: true,
              locale: "en",
            })
          ).data as { title?: unknown } | null
        )?.title;
      expect(await liveEnglish()).toBe("en");

      const everyLanguage = await handlerOf(t).updateEntry(
        {
          collectionName: PENDING_PAGES,
          entryId: id,
          overrideAccess: false,
          user: USER,
          locale: "*",
        },
        { status: "published" }
      );
      expect(everyLanguage.success).toBe(false);
      expect(everyLanguage.statusCode).toBe(403);
      expect(await liveEnglish()).toBe("en");

      // The control: a trusted publish of every language puts the edit live.
      const trusted = await write("*", { status: "published" });
      expect(trusted.success).toBe(true);
      expect(await liveEnglish()).toBe("en pending");
    });
  }
);
