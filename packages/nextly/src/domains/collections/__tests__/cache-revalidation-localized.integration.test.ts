/**
 * A localized collection stores its `slug` per locale in the companion table, so
 * a publish-all-locales or a delete must bust every locale's slug tag, not just
 * the default one. These pin that against a real database: companion tables are
 * migration-owned, so the test seeds `dc_locposts_locales` directly, then asserts
 * the registered revalidator receives each locale's `nextly:{collection}:slug:{slug}`
 * tag.
 *
 * SQLite has no connection pool, so this needs no Postgres URL; the tag
 * bookkeeping is dialect-independent.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../../revalidation/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

// Records every flushed intent so a test can assert which tags a write busts.
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  flush(intents: RevalidationIntent[]): void {
    this.flushed.push(...intents);
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

describe("cache revalidation — localized slugs (sqlite)", () => {
  let handle: TestNextly | undefined;
  let spy: RecordingRevalidator;

  beforeEach(() => {
    spy = new RecordingRevalidator();
    // Pre-register the spy so registerServices keeps it over the no-op default.
    container.registerSingleton<CacheRevalidator>(
      "cacheRevalidator",
      () => spy
    );
  });

  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
  });

  async function boot(): Promise<TestNextly> {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    handle = await createTestNextly({
      adapter,
      collections: [
        defineCollection({
          slug: "locposts",
          localized: true,
          status: true,
          access: {
            create: () => true,
            delete: () => true,
            update: () => true,
          },
          // `slug` defaults to localized (a text field), so it lives in the
          // companion table with a per-locale value.
          fields: [
            text({ name: "title", localized: false }),
            text({ name: "slug" }),
          ],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    return handle;
  }

  // Companion tables are migration-owned; seed one with a per-locale slug.
  async function seedCompanionSlugs(
    t: TestNextly,
    parent: string,
    rows: { locale: string; status: string; slug: string }[]
  ): Promise<void> {
    const adapter = t.adapter as unknown as {
      executeQuery: (sql: string) => Promise<unknown>;
    };
    await adapter.executeQuery(
      'CREATE TABLE IF NOT EXISTS "dc_locposts_locales" ("_parent" text, "_locale" text, "_status" text NOT NULL DEFAULT \'draft\', "slug" text, PRIMARY KEY ("_parent","_locale"))'
    );
    for (const r of rows) {
      await adapter.executeQuery(
        `INSERT INTO "dc_locposts_locales" ("_parent","_locale","_status","slug") VALUES ('${parent}','${r.locale}','${r.status}','${r.slug}') ON CONFLICT ("_parent","_locale") DO UPDATE SET "_status" = excluded."_status", "slug" = excluded."slug"`
      );
    }
  }

  function handlerOf(t: TestNextly): CollectionsHandler {
    return t.getService<CollectionsHandler>("collectionsHandler");
  }

  it("busts every locale's slug tag on delete", async () => {
    const t = await boot();
    const created = (await t.nextly.create({
      collection: "locposts",
      data: { title: "A" },
    })) as { item: { id: string } };
    const id = created.item.id;
    await seedCompanionSlugs(t, id, [
      { locale: "en", status: "published", slug: "hello" },
      { locale: "de", status: "published", slug: "bonjour" },
    ]);
    spy.flushed.length = 0; // ignore the create's flush

    await handlerOf(t).deleteEntry({
      collectionName: "locposts",
      entryId: id,
      overrideAccess: true,
    });

    // Both locales' URLs must clear, not just the default one.
    expect(spy.tags).toContain("nextly:locposts:slug:hello");
    expect(spy.tags).toContain("nextly:locposts:slug:bonjour");
  });

  it("busts every locale's slug tag on publishAllLocales", async () => {
    const t = await boot();
    const created = (await t.nextly.create({
      collection: "locposts",
      data: { title: "A" },
    })) as { item: { id: string } };
    const id = created.item.id;
    await seedCompanionSlugs(t, id, [
      { locale: "en", status: "draft", slug: "hello" },
      { locale: "de", status: "draft", slug: "bonjour" },
    ]);
    spy.flushed.length = 0;

    const res = await handlerOf(t).publishAllLocales({
      collectionName: "locposts",
      entryId: id,
      overrideAccess: true,
    });

    // The localized-slug read runs post-commit, so it must never turn a
    // committed publish into a failure.
    expect(res.success).toBe(true);
    expect(spy.tags).toContain("nextly:locposts:slug:hello");
    expect(spy.tags).toContain("nextly:locposts:slug:bonjour");
  });
});
