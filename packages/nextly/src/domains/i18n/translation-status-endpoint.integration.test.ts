// M7: the translation-status overview flows end-to-end through the real service stack
// (CollectionsHandler → EntryService → QueryService) and survives response serialization.
//
// Companion tables are migration-owned (Option B), so the test creates + seeds
// `dc_pages_locales` directly, then reads through the handler with `translationStatus: true`.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pages = () =>
  defineCollection({
    slug: "pages",
    localized: true,
    fields: [
      text({ name: "title", localized: false }),
      text({ name: "heading" }), // localized → companion
    ],
  });

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [pages()],
    localization: {
      locales: ["en", "de", "fr"],
      defaultLocale: "en",
    },
  });
  return current;
}

async function seedCompanion(
  t: TestNextly,
  rows: { parent: string; locale: string; heading: string }[]
): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "heading" text)'
  );
  for (const r of rows) {
    await adapter.executeQuery(
      `INSERT INTO "dc_pages_locales" ("_parent","_locale","heading") VALUES ('${r.parent}','${r.locale}','${r.heading}')`
    );
  }
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    getEntry: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: Record<string, unknown> | null;
    }>;
    listEntries: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: { docs: Record<string, unknown>[] } | null;
    }>;
  };
}

type TranslationsMap = Record<string, { translated: boolean; status?: string }>;

describe("translation-status overview endpoint (M7)", () => {
  it("getEntry attaches _translations when requested", async () => {
    const t = await boot();
    const created = await t.nextly.create({
      collection: "pages",
      data: { title: "Page 1" },
    });
    const id = (created as { item: { id: string } }).item.id;
    await seedCompanion(t, [
      { parent: id, locale: "en", heading: "Hello" },
      { parent: id, locale: "de", heading: "Hallo" },
      // fr: no row → untranslated
    ]);

    const res = await handlerOf(t).getEntry({
      collectionName: "pages",
      entryId: id,
      translationStatus: true,
      overrideAccess: true,
    });

    expect(res.success).toBe(true);
    const translations = res.data?._translations as TranslationsMap;
    expect(translations).toBeDefined();
    expect(translations.en.translated).toBe(true);
    expect(translations.de.translated).toBe(true);
    expect(translations.fr.translated).toBe(false);
  });

  it("does NOT attach _translations unless requested", async () => {
    const t = await boot();
    const created = await t.nextly.create({
      collection: "pages",
      data: { title: "Page 1" },
    });
    const id = (created as { item: { id: string } }).item.id;
    await seedCompanion(t, [{ parent: id, locale: "de", heading: "Hallo" }]);

    const res = await handlerOf(t).getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });

    expect(res.success).toBe(true);
    expect(res.data?._translations).toBeUndefined();
  });

  it("listEntries attaches _translations to every row when requested", async () => {
    const t = await boot();
    const a = (
      (await t.nextly.create({
        collection: "pages",
        data: { title: "A" },
      })) as { item: { id: string } }
    ).item.id;
    const b = (
      (await t.nextly.create({
        collection: "pages",
        data: { title: "B" },
      })) as { item: { id: string } }
    ).item.id;
    await seedCompanion(t, [
      { parent: a, locale: "en", heading: "A-en" },
      { parent: a, locale: "de", heading: "A-de" },
      { parent: b, locale: "en", heading: "B-en" },
      // b has no de/fr
    ]);

    const res = await handlerOf(t).listEntries({
      collectionName: "pages",
      translationStatus: true,
      limit: 50,
      overrideAccess: true,
    });

    expect(res.success).toBe(true);
    const docs = res.data?.docs ?? [];
    const byId = new Map(docs.map(d => [d.id, d._translations as TranslationsMap]));
    expect(byId.get(a)?.de.translated).toBe(true);
    expect(byId.get(b)?.de.translated).toBe(false);
    // fr never seeded → untranslated for both
    expect(byId.get(a)?.fr.translated).toBe(false);
    expect(byId.get(b)?.fr.translated).toBe(false);
  });
});
