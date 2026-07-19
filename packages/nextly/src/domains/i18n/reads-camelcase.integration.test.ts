// M5 prerequisite: companion columns are snake_case (meta_title) but the API row key is the
// camelCase field name (metaTitle). The read helpers must map fieldName -> snake column for the
// companion lookup while keying the row by the field name. Previously camelCase localized fields
// silently resolved to null (all M4 tests used lowercase names).

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        fields: [
          text({ name: "title", localized: false }),
          text({ name: "metaTitle" }), // camelCase localized field → column meta_title
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

async function seedCompanion(
  t: TestNextly,
  rows: { parent: string; locale: string; metaTitle: string }[]
): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "meta_title" text, PRIMARY KEY ("_parent","_locale"))'
  );
  for (const r of rows) {
    await adapter.executeQuery(
      `INSERT INTO "dc_pages_locales" ("_parent","_locale","meta_title") VALUES ('${r.parent}','${r.locale}','${r.metaTitle}') ON CONFLICT ("_parent","_locale") DO UPDATE SET "meta_title" = excluded."meta_title"`
    );
  }
}

describe("camelCase localized field resolution (M5 prerequisite)", () => {
  it("resolves a camelCase localized field (column meta_title) under the camelCase key", async () => {
    const t = await boot();
    const created = await t.nextly.create({
      collection: "pages",
      data: { title: "T" },
    });
    const id = (created as { item: { id: string } }).item.id;
    await seedCompanion(t, [
      { parent: id, locale: "en", metaTitle: "Hello" },
      { parent: id, locale: "de", metaTitle: "Hallo" },
    ]);

    const handler = t.getService("collectionsHandler") as unknown as {
      getEntry: (p: Record<string, unknown>) => Promise<{
        data: Record<string, unknown> | null;
      }>;
      listEntries: (p: Record<string, unknown>) => Promise<{
        data: { docs: Record<string, unknown>[] } | null;
      }>;
    };

    const de = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      locale: "de",
      overrideAccess: true,
    });
    expect(de.data?.metaTitle).toBe("Hallo");

    // Also via list (batch path).
    const list = await handler.listEntries({
      collectionName: "pages",
      locale: "de",
      overrideAccess: true,
      limit: 50,
    });
    expect(list.data?.docs[0]?.metaTitle).toBe("Hallo");
  });
});
