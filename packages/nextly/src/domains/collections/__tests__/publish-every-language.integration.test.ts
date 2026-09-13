/**
 * Moving a whole document's lifecycle applies every language's pending change.
 *
 * Each case pairs what must land with what must survive, because a write that
 * applies nothing satisfies every "unchanged" assertion on its own.
 *
 * @module domains/collections/__tests__/publish-every-language.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "pages";
const GUARDED_SLUG = "guardedpages";
const BLOCKS_SLUG = "blockpages";

const OPEN_ACCESS = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "hero",
        localized: true,
        fields: [
          text({ name: "heading", localized: true }),
          text({ name: "variant", localized: false }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: BLOCKS_SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN_ACCESS,
        fields: [
          text({ name: "title", localized: true }),
          fieldGroup({ name: "blocks", component: "hero", repeatable: true }),
        ],
      }),
      defineCollection({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN_ACCESS,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note", localized: false }),
        ],
      }),
      defineCollection({
        slug: GUARDED_SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: OPEN_ACCESS,
        fields: [
          text({ name: "title", localized: true }),
          text({
            name: "note",
            localized: false,
            access: { update: () => false },
          }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A document published in English and German. */
async function publishedInBoth(t: TestNextly, slug = SLUG): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: slug, overrideAccess: true, locale: "en" },
    { title: "EN v1", note: "live note", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  await handlerOf(t).updateEntry(
    { collectionName: slug, entryId: id, overrideAccess: true, locale: "de" },
    { title: "DE v1", status: "published" }
  );
  return id;
}

/** Hold an edit as that language's pending change. */
async function holdEdit(
  t: TestNextly,
  id: string,
  locale: string,
  data: Record<string, unknown>,
  slug = SLUG
): Promise<void> {
  const res = await handlerOf(t).updateEntry(
    { collectionName: slug, entryId: id, overrideAccess: true, locale },
    data
  );
  if (!res.success) throw new Error(`hold failed: ${JSON.stringify(res)}`);
}

/**
 * Date a language's pending change, so which save is later does not depend on
 * two writes landing in different milliseconds, or seconds on MySQL.
 */
async function dateChange(
  t: TestNextly,
  id: string,
  locale: string,
  iso: string
): Promise<void> {
  await t.adapter.update(
    "nextly_versions",
    { updatedAt: new Date(iso) },
    {
      and: [
        { column: "entryId", op: "=", value: id },
        { column: "locale", op: "=", value: locale },
        { column: "versionNo", op: "IS NULL" },
      ],
    }
  );
}

/** What a reader gets for one language, at every status. */
async function live(
  t: TestNextly,
  id: string,
  locale: string,
  slug = SLUG
): Promise<Record<string, unknown>> {
  const doc = (await t.nextly.findByID({
    collection: slug as never,
    id,
    locale,
    overrideAccess: true,
    status: "all",
  } as never)) as Record<string, unknown> | null;
  return doc ?? {};
}

/** The languages this document still holds a pending change for. */
async function pendingLocales(t: TestNextly, id: string): Promise<string[]> {
  // `nextly_versions` is a mapped system table: its rows come back camelCased.
  const rows = await t.adapter.select<{
    entryId?: unknown;
    versionNo?: unknown;
    locale?: unknown;
  }>("nextly_versions", {});
  return rows
    .filter(r => String(r.entryId) === id && r.versionNo === null)
    .map(r => String(r.locale))
    .sort();
}

type Block = { id: string; heading?: unknown; variant?: unknown };

/** A document with one block, published and translated in both languages. */
async function publishedWithOneBlock(
  t: TestNextly
): Promise<{ id: string; firstBlockId: string }> {
  const created = await handlerOf(t).createEntry(
    { collectionName: BLOCKS_SLUG, overrideAccess: true, locale: "en" },
    {
      title: "EN",
      blocks: [{ heading: "EN one", variant: "wide" }],
      status: "published",
    }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  const blocks = (await live(t, id, "en", BLOCKS_SLUG)).blocks as Block[];
  const firstBlockId = blocks[0].id;
  await handlerOf(t).updateEntry(
    {
      collectionName: BLOCKS_SLUG,
      entryId: id,
      overrideAccess: true,
      locale: "de",
    },
    {
      title: "DE",
      blocks: [{ id: firstBlockId, heading: "DE eins", variant: "wide" }],
      status: "published",
    }
  );
  return { id, firstBlockId };
}

/** Whether a block holds a stored translation for one language. */
async function hasTranslation(
  t: TestNextly,
  blockId: string,
  locale: string
): Promise<boolean> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    "comp_hero_locales",
    {
      where: {
        and: [
          { column: "_parent", op: "=", value: blockId },
          { column: "_locale", op: "=", value: locale },
        ],
      },
    }
  );
  return rows.length > 0;
}

/**
 * English adds a block while German translates the existing one; `germanLater`
 * decides which pending change was saved last.
 */
async function blockAddedBesideATranslation(
  t: TestNextly,
  germanLater: boolean
): Promise<string> {
  const { id, firstBlockId } = await publishedWithOneBlock(t);
  await holdEdit(
    t,
    id,
    "de",
    { blocks: [{ id: firstBlockId, heading: "DE eins v2", variant: "wide" }] },
    BLOCKS_SLUG
  );
  await holdEdit(
    t,
    id,
    "en",
    {
      blocks: [
        { id: firstBlockId, heading: "EN one", variant: "wide" },
        { heading: "EN two", variant: "narrow" },
      ],
    },
    BLOCKS_SLUG
  );
  await dateChange(
    t,
    id,
    "de",
    germanLater ? "2026-01-02T00:00:00.000Z" : "2026-01-01T00:00:00.000Z"
  );
  await dateChange(
    t,
    id,
    "en",
    germanLater ? "2026-01-01T00:00:00.000Z" : "2026-01-02T00:00:00.000Z"
  );
  return id;
}

async function publishEveryLanguage(t: TestNextly, id: string, slug = SLUG) {
  return handlerOf(t).updateEntry(
    { collectionName: slug, entryId: id, overrideAccess: true, locale: "*" },
    { status: "published" }
  );
}

describe.each(getConfiguredTestDialects())(
  "a whole-document publish and every language's pending change (%s)",
  dialect => {
    it("publishes every language's pending change and consumes each one", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "en", { title: "EN v2" });
      await holdEdit(t, id, "de", { title: "DE v2" });

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      expect((await live(t, id, "en")).title).toBe("EN v2");
      expect((await live(t, id, "de")).title).toBe("DE v2");
      expect(await pendingLocales(t, id)).toEqual([]);
    });

    it("keeps a shared edit that a later translation-only change never touched", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "en", { note: "EN edited note" });
      await holdEdit(t, id, "de", { title: "DE v2" });
      // German saved later, holding the note as it was live.
      await dateChange(t, id, "en", "2026-01-01T00:00:00.000Z");
      await dateChange(t, id, "de", "2026-01-02T00:00:00.000Z");

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      expect((await live(t, id, "de")).title).toBe("DE v2");
      expect((await live(t, id, "en")).note).toBe("EN edited note");
    });

    it("lets the later save win when two languages edited the same shared value", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t);
      await holdEdit(t, id, "en", { note: "EN note" });
      await holdEdit(t, id, "de", { note: "DE note" });
      await dateChange(t, id, "de", "2026-01-01T00:00:00.000Z");
      await dateChange(t, id, "en", "2026-01-02T00:00:00.000Z");

      const res = await publishEveryLanguage(t, id);

      expect(res.success, JSON.stringify(res)).toBe(true);
      expect((await live(t, id, "de")).note).toBe("EN note");
    });

    it.each([
      ["saved before", false],
      ["saved after", true],
    ])(
      "keeps a block English added when the German translation was %s it",
      async (_label, germanLater) => {
        const t = await boot(dialect);
        const id = await blockAddedBesideATranslation(t, germanLater);

        const res = await publishEveryLanguage(t, id, BLOCKS_SLUG);

        expect(res.success, JSON.stringify(res)).toBe(true);
        const en = (await live(t, id, "en", BLOCKS_SLUG)).blocks as Block[];
        const de = (await live(t, id, "de", BLOCKS_SLUG)).blocks as Block[];
        expect(en.map(block => block.heading)).toEqual(["EN one", "EN two"]);
        expect(de.map(block => block.variant)).toEqual(["wide", "narrow"]);
        expect(de[0].heading).toBe("DE eins v2");
        // German never translated the new block, so no German value is stored
        // for it: a read falling back to English is not a translation.
        expect(await hasTranslation(t, en[1].id, "de")).toBe(false);
        expect(await pendingLocales(t, id)).toEqual([]);
      }
    );

    it("refuses the whole write, and keeps every pending change, when one edits a field the publisher may not", async () => {
      const t = await boot(dialect);
      const id = await publishedInBoth(t, GUARDED_SLUG);
      await holdEdit(t, id, "en", { title: "EN v2" }, GUARDED_SLUG);
      await holdEdit(t, id, "de", { note: "forbidden" }, GUARDED_SLUG);
      await dateChange(t, id, "en", "2026-01-01T00:00:00.000Z");
      await dateChange(t, id, "de", "2026-01-02T00:00:00.000Z");

      const res = await handlerOf(t).updateEntry(
        {
          collectionName: GUARDED_SLUG,
          entryId: id,
          locale: "*",
          routeAuthorized: true,
          user: { id: "editor-1", isActive: true } as never,
        },
        { status: "published" }
      );

      expect(res.success, JSON.stringify(res)).toBe(false);
      // English was applied first and must not survive the refusal.
      expect((await live(t, id, "en", GUARDED_SLUG)).title).toBe("EN v1");
      expect((await live(t, id, "en", GUARDED_SLUG)).note).toBe("live note");
      expect(await pendingLocales(t, id)).toEqual(["de", "en"]);
    });
  }
);
