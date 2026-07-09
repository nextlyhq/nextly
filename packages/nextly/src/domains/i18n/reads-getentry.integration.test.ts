// M4a: getEntry resolves localized fields from the companion table with fallback.
//
// Companion tables are migration-owned (Option B) and NOT created by the harness auto-sync,
// so the test creates + seeds `dc_pages_locales` directly, then reads through the real service
// stack (CollectionsHandler → EntryService → QueryService) with a locale.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text, number } from "../../config";
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
      // Shared (stays on the main table) so we can create rows without the write path.
      text({ name: "title", localized: false }),
      number({ name: "views", localized: false }),
      // Localized (lives in the companion `_locales` table).
      text({ name: "heading" }),
    ],
  });

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [pages()],
    localization: {
      locales: ["en", "de"],
      defaultLocale: "en",
    },
  });
  return current;
}

/** Create the companion table + seed per-locale heading values for a parent id. */
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
  };
}

describe("getEntry — localized field resolution (M4a)", () => {
  it("returns the requested locale's value, and falls back when missing", async () => {
    const t = await boot();
    const created = await t.nextly.create({
      collection: "pages",
      data: { title: "Page 1", views: 3 },
    });
    const id = (created as { item: { id: string } }).item.id;

    // p1 has both German and English; a second logical entry has only English.
    await seedCompanion(t, [
      { parent: id, locale: "en", heading: "Hello" },
      { parent: id, locale: "de", heading: "Hallo" },
    ]);

    const handler = handlerOf(t);

    // Requested German → German value.
    const de = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      locale: "de",
      overrideAccess: true,
    });
    expect(de.data?.heading).toBe("Hallo");
    expect(de.data?.title).toBe("Page 1"); // shared field unchanged

    // No locale → default (en).
    const def = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect(def.data?.heading).toBe("Hello");

    // Invalid locale → default (en).
    const fr = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      locale: "fr",
      overrideAccess: true,
    });
    expect(fr.data?.heading).toBe("Hello");
  });

  it("falls back to the default when the requested language is missing; fallback=none does not", async () => {
    const t = await boot();
    const created = await t.nextly.create({
      collection: "pages",
      data: { title: "Only EN", views: 1 },
    });
    const id = (created as { item: { id: string } }).item.id;
    await seedCompanion(t, [{ parent: id, locale: "en", heading: "Hello" }]);

    const handler = handlerOf(t);

    // Requested de, no German row → falls back to English.
    const withFallback = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      locale: "de",
      overrideAccess: true,
    });
    expect(withFallback.data?.heading).toBe("Hello");

    // fallback disabled → raw German (absent) → null.
    const noFallback = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      locale: "de",
      fallbackLocale: "none",
      overrideAccess: true,
    });
    expect(noFallback.data?.heading).toBeNull();
  });

  it("direct-api findByID forwards locale to the query service", async () => {
    const t = await boot();
    const created = await t.nextly.create({
      collection: "pages",
      data: { title: "Page 1", views: 3 },
    });
    const id = (created as { item: { id: string } }).item.id;
    await seedCompanion(t, [
      { parent: id, locale: "en", heading: "Hello" },
      { parent: id, locale: "de", heading: "Hallo" },
    ]);

    const doc = (await t.nextly.findByID({
      collection: "pages",
      id,
      locale: "de",
      overrideAccess: true,
    } as Parameters<typeof t.nextly.findByID>[0])) as {
      heading?: string;
    } | null;
    expect(doc?.heading).toBe("Hallo");
  });
});
