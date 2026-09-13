/**
 * Moving a whole document's lifecycle applies every language's pending change.
 *
 * Each case pairs what must land with what must survive, because a write that
 * applies nothing satisfies every "unchanged" assertion on its own.
 *
 * @module domains/collections/__tests__/publish-every-language.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
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

const OPEN_ACCESS = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
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
