// M4c: search + where-DSL match localized fields via a companion EXISTS on the
// requested locale (previously localized fields were silently dropped from both).

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
      text({ name: "title", localized: false }),
      number({ name: "views", localized: false }),
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
  rows: { parent: string; locale: string; heading: string }[]
): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
  for (const r of rows) {
    await adapter.executeQuery(
      `INSERT INTO "dc_pages_locales" ("_parent","_locale","heading") VALUES ('${r.parent}','${r.locale}','${r.heading}') ON CONFLICT ("_parent","_locale") DO UPDATE SET "heading" = excluded."heading"`
    );
  }
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    listEntries: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: { docs: Record<string, unknown>[]; totalDocs: number } | null;
    }>;
  };
}

async function setup(): Promise<{ t: TestNextly; a: string; b: string }> {
  const t = await boot();
  const mk = async (title: string) =>
    (
      (await t.nextly.create({
        collection: "pages",
        data: { title, views: 0 },
      })) as { item: { id: string } }
    ).item.id;
  const a = await mk("A");
  const b = await mk("B");
  await seedCompanion(t, [
    { parent: a, locale: "de", heading: "Hallo" },
    { parent: a, locale: "en", heading: "Hi" },
    { parent: b, locale: "de", heading: "Welt" },
    { parent: b, locale: "en", heading: "World" },
  ]);
  return { t, a, b };
}

describe("search + where — localized (M4c)", () => {
  it("search matches a localized field in the requested locale", async () => {
    const { t } = await setup();
    const handler = handlerOf(t);
    const res = await handler.listEntries({
      collectionName: "pages",
      search: "Hallo",
      locale: "de",
      overrideAccess: true,
      limit: 50,
    });
    expect(res.data!.docs.map(d => d.title)).toEqual(["A"]);

    // Same term against English locale finds nothing (German-only value).
    const en = await handler.listEntries({
      collectionName: "pages",
      search: "Hallo",
      locale: "en",
      overrideAccess: true,
      limit: 50,
    });
    expect(en.data!.docs.length).toBe(0);
  });

  it("where filter on a localized field filters within the requested locale", async () => {
    const { t } = await setup();
    const handler = handlerOf(t);
    const res = await handler.listEntries({
      collectionName: "pages",
      where: { heading: { equals: "Welt" } },
      locale: "de",
      overrideAccess: true,
      limit: 50,
    });
    expect(res.data!.docs.map(d => d.title)).toEqual(["B"]);
  });
});
