// M6c: per-locale draft/publish. A locale's DRAFT companion content must NEVER leak to a public
// (status=published) read — it is filtered out and the field falls back to the published default.
// Admin (status=all) sees drafts.

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
        status: true, // Draft/Published → per-locale _status on the companion
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

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      body: Record<string, unknown>
    ) => Promise<{ success: boolean; item?: { id: string } }>;
    getEntry: (p: Record<string, unknown>) => Promise<{
      data: Record<string, unknown> | null;
    }>;
  };
}

/** Seed the companion (with `_status`) directly — en published, de draft. */
async function seed(
  t: TestNextly,
  id: string,
  rows: { locale: string; status: string; heading: string }[]
): Promise<void> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(
    'CREATE TABLE IF NOT EXISTS "dc_pages_locales" ("_parent" text, "_locale" text, "_status" text, "heading" text, PRIMARY KEY ("_parent","_locale"))'
  );
  for (const r of rows) {
    await adapter.executeQuery(
      `INSERT INTO "dc_pages_locales" ("_parent","_locale","_status","heading") VALUES ('${id}','${r.locale}','${r.status}','${r.heading}')`
    );
  }
}

async function setup(): Promise<{ t: TestNextly; id: string }> {
  const t = await boot();
  // Create the entry PUBLISHED (main.status=published so the entry is publicly visible); the
  // localized content is seeded separately below with per-locale _status.
  await handlerOf(t).createEntry(
    { collectionName: "pages", locale: "en", overrideAccess: true },
    { title: "T", heading: "x", status: "published" }
  );
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<{ id: string }[]>;
  };
  const id = (await adapter.executeQuery('SELECT "id" FROM "dc_pages"'))[0].id;
  await seed(t, id, [
    { locale: "en", status: "published", heading: "Hello" },
    { locale: "de", status: "draft", heading: "Entwurf" },
  ]);
  return { t, id };
}

describe("per-locale draft/publish read filter (M6c)", () => {
  it("public de read does NOT leak the de draft — falls back to the published default (en)", async () => {
    const { t, id } = await setup();
    const res = await handlerOf(t).getEntry({
      collectionName: "pages",
      entryId: id,
      locale: "de",
      status: "published",
      overrideAccess: true,
    });
    expect(res.data).not.toBeNull();
    expect(res.data?.heading).toBe("Hello"); // de draft filtered → published en
    expect(res.data?.heading).not.toBe("Entwurf");
  });

  it("admin (status=all) sees the de draft", async () => {
    const { t, id } = await setup();
    const res = await handlerOf(t).getEntry({
      collectionName: "pages",
      entryId: id,
      locale: "de",
      status: "all",
      overrideAccess: true,
    });
    expect(res.data?.heading).toBe("Entwurf");
  });

  it("once the de translation is published, the public de read shows it", async () => {
    const { t, id } = await setup();
    const adapter = t.adapter as unknown as {
      executeQuery: (sql: string) => Promise<unknown>;
    };
    await adapter.executeQuery(
      `UPDATE "dc_pages_locales" SET "_status"='published' WHERE "_parent"='${id}' AND "_locale"='de'`
    );
    const res = await handlerOf(t).getEntry({
      collectionName: "pages",
      entryId: id,
      locale: "de",
      status: "published",
      overrideAccess: true,
    });
    expect(res.data?.heading).toBe("Entwurf"); // now published → shown
  });
});
