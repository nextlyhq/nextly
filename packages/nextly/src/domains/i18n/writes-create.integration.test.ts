// M5a: createEntry routes translatable field values to the companion `_locales` row for the
// write's locale (when the companion table exists / migration has run). Shared fields stay on
// the main table. Before migration (no companion table), localized values stay on main (dev).

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

/** Simulate the companion migration having run: create the companion table. */
async function createCompanionTable(t: TestNextly): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE "dc_pages_locales" ("_parent" text, "_locale" text, "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      body: Record<string, unknown>
    ) => Promise<{ success: boolean; message?: string }>;
    getEntry: (p: Record<string, unknown>) => Promise<{
      data: Record<string, unknown> | null;
    }>;
  };
}

describe("createEntry — localized write routing (M5a)", () => {
  it("routes the localized value to the companion row for the write locale", async () => {
    const t = await boot();
    await createCompanionTable(t);
    const handler = handlerOf(t);

    // Create the German content.
    const res = await handler.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", views: 2, heading: "Hallo" }
    );
    expect(res.success).toBe(true);

    // The companion row exists for `de` with the heading; the main table has no heading.
    const adapter = t.adapter as unknown as {
      executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
    };
    const companionRows = await adapter.executeQuery(
      'SELECT "_locale","heading" FROM "dc_pages_locales"'
    );
    expect(companionRows).toEqual([{ _locale: "de", heading: "Hallo" }]);

    // Reading back in German resolves the companion value; the shared field is intact.
    const list = (await adapter.executeQuery(
      'SELECT "id" FROM "dc_pages"'
    )) as { id: string }[];
    const de = await handler.getEntry({
      collectionName: "pages",
      entryId: list[0].id,
      locale: "de",
      overrideAccess: true,
    });
    expect(de.data?.heading).toBe("Hallo");
    expect(de.data?.title).toBe("T");
    expect(de.data?.views).toBe(2);
  });

  it("keeps different locales in separate companion rows", async () => {
    const t = await boot();
    await createCompanionTable(t);
    const handler = handlerOf(t);

    await handler.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "T", heading: "Hello" }
    );
    const adapter = t.adapter as unknown as {
      executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
    };
    const rows = await adapter.executeQuery(
      'SELECT "_locale","heading" FROM "dc_pages_locales"'
    );
    expect(rows).toEqual([{ _locale: "en", heading: "Hello" }]);
  });

  it("dev (no companion table): localized value stays on the main table, write succeeds", async () => {
    const t = await boot();
    const handler = handlerOf(t);
    // No companion table created → dev/unmigrated path.
    const res = await handler.createEntry(
      { collectionName: "pages", locale: "de", overrideAccess: true },
      { title: "T", heading: "Hallo" }
    );
    expect(res.success).toBe(true);
    const adapter = t.adapter as unknown as {
      executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
    };
    const rows = await adapter.executeQuery('SELECT "heading" FROM "dc_pages"');
    expect(rows).toEqual([{ heading: "Hallo" }]);
  });
});
