// M7: the `_translated` language filter narrows listEntries by translation state in a locale,
// through the real service stack. Companion tables are migration-owned, so the test seeds them.

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
      text({ name: "heading" }),
    ],
  });

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [pages()],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

async function seedCompanion(
  t: TestNextly,
  rows: { parent: string; locale: string; heading: string; status?: string }[],
  withStatus = false
): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    withStatus
      ? 'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "_status" text NOT NULL DEFAULT \'draft\', "heading" text, PRIMARY KEY ("_parent","_locale"))'
      : 'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
  for (const r of rows) {
    if (withStatus) {
      await adapter.executeQuery(
        `INSERT INTO "dc_pages_locales" ("_parent","_locale","_status","heading") VALUES ('${r.parent}','${r.locale}','${r.status ?? "draft"}','${r.heading}')`
      );
    } else {
      await adapter.executeQuery(
        `INSERT INTO "dc_pages_locales" ("_parent","_locale","heading") VALUES ('${r.parent}','${r.locale}','${r.heading}')`
      );
    }
  }
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    listEntries: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: { docs: Record<string, unknown>[] } | null;
    }>;
  };
}

async function create(t: TestNextly, title: string): Promise<string> {
  const r = (await t.nextly.create({
    collection: "pages",
    data: { title },
  })) as { item: { id: string } };
  return r.item.id;
}

async function listIds(
  t: TestNextly,
  translated: { locale: string; state: string }
): Promise<Set<string>> {
  const res = await handlerOf(t).listEntries({
    collectionName: "pages",
    where: { _translated: translated },
    overrideAccess: true,
    limit: 50,
  });
  expect(res.success).toBe(true);
  return new Set((res.data?.docs ?? []).map(d => d.id as string));
}

describe("translation-status list filter (_translated) (M7)", () => {
  it("filters missing vs translated in a locale (no status)", async () => {
    const t = await boot();
    const a = await create(t, "A"); // en + de
    const b = await create(t, "B"); // en only
    const c = await create(t, "C"); // en + de blank
    await seedCompanion(t, [
      { parent: a, locale: "en", heading: "A-en" },
      { parent: a, locale: "de", heading: "A-de" },
      { parent: b, locale: "en", heading: "B-en" },
      { parent: c, locale: "en", heading: "C-en" },
      { parent: c, locale: "de", heading: "" }, // present but blank → untranslated
    ]);

    const translatedDe = await listIds(t, {
      locale: "de",
      state: "translated",
    });
    expect(translatedDe).toEqual(new Set([a]));

    const missingDe = await listIds(t, { locale: "de", state: "missing" });
    expect(missingDe).toEqual(new Set([b, c]));
  });

  it("treats the default locale as always translated / never missing", async () => {
    const t = await boot();
    const a = await create(t, "A");
    await seedCompanion(t, [{ parent: a, locale: "en", heading: "A-en" }]);

    // Every entry is translated in the default locale...
    const translatedEn = await listIds(t, {
      locale: "en",
      state: "translated",
    });
    expect(translatedEn.has(a)).toBe(true);
    // ...and none are missing.
    const missingEn = await listIds(t, { locale: "en", state: "missing" });
    expect(missingEn.size).toBe(0);
  });

  it("filters draft vs published per locale when the collection has status", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          localized: true,
          status: true,
          fields: [
            text({ name: "title", localized: false }),
            text({ name: "heading" }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const t = current;
    const a = await create(t, "A"); // de published
    const b = await create(t, "B"); // de draft
    await seedCompanion(
      t,
      [
        { parent: a, locale: "de", heading: "A-de", status: "published" },
        { parent: b, locale: "de", heading: "B-de", status: "draft" },
      ],
      true
    );

    const publishedDe = await listIds(t, { locale: "de", state: "published" });
    expect(publishedDe).toEqual(new Set([a]));

    const draftDe = await listIds(t, { locale: "de", state: "draft" });
    expect(draftDe).toEqual(new Set([b]));
  });
});
