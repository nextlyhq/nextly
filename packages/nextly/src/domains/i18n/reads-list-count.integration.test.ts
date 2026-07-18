// M4b: listEntries resolves localized fields for the whole page (batch), and
// countEntries stays in parity with listEntries for a locale-scoped read.

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
    listEntries: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: { docs: Record<string, unknown>[]; totalDocs: number } | null;
    }>;
    countEntries: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: { totalDocs: number } | null;
    }>;
  };
}

describe("listEntries / countEntries — localized (M4b)", () => {
  it("resolves each page row's localized field with fallback", async () => {
    const t = await boot();
    const a = (await t.nextly.create({
      collection: "pages",
      data: { title: "A", views: 1 },
    })) as { item: { id: string } };
    const b = (await t.nextly.create({
      collection: "pages",
      data: { title: "B", views: 2 },
    })) as { item: { id: string } };

    // A has German; B only English (must fall back).
    await seedCompanion(t, [
      { parent: a.item.id, locale: "en", heading: "Hello-A" },
      { parent: a.item.id, locale: "de", heading: "Hallo-A" },
      { parent: b.item.id, locale: "en", heading: "Hello-B" },
    ]);

    const handler = handlerOf(t);
    const list = await handler.listEntries({
      collectionName: "pages",
      locale: "de",
      overrideAccess: true,
      limit: 50,
    });
    expect(list.data).not.toBeNull();
    const byTitle = Object.fromEntries(
      list.data!.docs.map(d => [d.title, d.heading])
    );
    expect(byTitle["A"]).toBe("Hallo-A"); // German
    expect(byTitle["B"]).toBe("Hello-B"); // fell back to English
  });

  it("countEntries equals listEntries page length for a locale-scoped read (parity)", async () => {
    const t = await boot();
    for (const d of [
      { title: "A", views: 1 },
      { title: "B", views: 2 },
      { title: "C", views: 3 },
    ]) {
      await t.nextly.create({ collection: "pages", data: d });
    }

    const handler = handlerOf(t);
    const list = await handler.listEntries({
      collectionName: "pages",
      locale: "de",
      overrideAccess: true,
      limit: 50,
    });
    const count = await handler.countEntries({
      collectionName: "pages",
      locale: "de",
      overrideAccess: true,
    });
    expect(count.data?.totalDocs).toBe(list.data?.docs.length);
    expect(count.data?.totalDocs).toBe(3);
  });

  it("sorts by a localized field using the requested locale's value", async () => {
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
    const c = await mk("C");

    // German headings deliberately out of creation order.
    await seedCompanion(t, [
      { parent: a, locale: "de", heading: "Zebra" },
      { parent: b, locale: "de", heading: "Apple" },
      { parent: c, locale: "de", heading: "Mango" },
    ]);

    const handler = handlerOf(t);
    const asc = await handler.listEntries({
      collectionName: "pages",
      locale: "de",
      sort: "heading",
      overrideAccess: true,
      limit: 50,
    });
    // Apple(B) < Mango(C) < Zebra(A)
    expect(asc.data!.docs.map(d => d.title)).toEqual(["B", "C", "A"]);

    const desc = await handler.listEntries({
      collectionName: "pages",
      locale: "de",
      sort: "-heading",
      overrideAccess: true,
      limit: 50,
    });
    expect(desc.data!.docs.map(d => d.title)).toEqual(["A", "C", "B"]);
  });
});
