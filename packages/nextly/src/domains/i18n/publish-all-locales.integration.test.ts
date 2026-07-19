// M7: publishAllLocales sets the main status + every companion _status to 'published' atomically,
// through the real service stack. Companion tables are migration-owned, so the test seeds them.

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
        status: true,
        fields: [
          text({ name: "title", localized: false }),
          text({ name: "heading" }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

async function seedCompanion(
  t: TestNextly,
  rows: { parent: string; locale: string; status: string; heading: string }[]
): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "_status" text NOT NULL DEFAULT \'draft\', "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
  for (const r of rows) {
    await adapter.executeQuery(
      `INSERT INTO "dc_pages_locales" ("_parent","_locale","_status","heading") VALUES ('${r.parent}','${r.locale}','${r.status}','${r.heading}')`
    );
  }
}

async function readStatuses(
  t: TestNextly,
  parent: string
): Promise<Record<string, string>> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<{ rows?: unknown[] } | unknown[]>;
  };
  const res = await adapter.executeQuery(
    `SELECT "_locale", "_status" FROM "dc_pages_locales" WHERE "_parent" = '${parent}'`
  );
  const rows = (
    Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows
  ) as Array<{ _locale: string; _status: string }> | undefined;
  const out: Record<string, string> = {};
  for (const r of rows ?? []) out[r._locale] = r._status;
  return out;
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    publishAllLocales: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: Record<string, unknown> | null;
    }>;
    getEntry: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: Record<string, unknown> | null;
    }>;
  };
}

describe("publishAllLocales (M7)", () => {
  it("sets every companion _status and the main status to published", async () => {
    const t = await boot();
    const created = (await t.nextly.create({
      collection: "pages",
      data: { title: "A" },
    })) as { item: { id: string } };
    const id = created.item.id;

    await seedCompanion(t, [
      { parent: id, locale: "en", status: "published", heading: "A-en" },
      { parent: id, locale: "de", status: "draft", heading: "A-de" },
    ]);

    // Precondition: de is a draft.
    expect((await readStatuses(t, id)).de).toBe("draft");

    const res = await handlerOf(t).publishAllLocales({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect(res.success).toBe(true);

    // Every companion row is now published.
    const statuses = await readStatuses(t, id);
    expect(statuses.en).toBe("published");
    expect(statuses.de).toBe("published");

    // Main status is published too.
    const entry = await handlerOf(t).getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect(entry.data?.status).toBe("published");
  });

  it("404s for a missing entry", async () => {
    const t = await boot();
    const res = await handlerOf(t).publishAllLocales({
      collectionName: "pages",
      entryId: "does-not-exist",
      overrideAccess: true,
    });
    expect(res.success).toBe(false);
  });
});
