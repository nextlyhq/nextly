/**
 * A site keeping every translatable field per language from the start
 * (`experimental.perLanguageStorage`): on a site that declares no languages and marks nothing
 * translatable, a collection's translatable fields live in its per-language table, under the
 * site's one implicit language, and its shared fields stay on the main table. The Direct API writes
 * and reads them there. With the setting off, the same site stores as it always has.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, number, text, textarea } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { perLanguageStorageEnabled } from "../per-language-storage";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A site with one collection holding translatable and shared fields, and no languages declared. */
async function boot(dialect: TestDialect, perLanguageStorage: boolean) {
  current = await createTestNextly({
    dialect,
    perLanguageStorage,
    collections: [
      defineCollection({
        slug: "articles",
        fields: [
          text({ name: "headline" }),
          textarea({ name: "excerpt" }),
          number({ name: "views" }),
        ],
      }),
    ],
  });
  return current;
}

/** Each table's columns as the database holds them, none for a table that is not there. */
async function columnsOf(
  t: TestNextly,
  tables: string[]
): Promise<Record<string, string[]>> {
  const snapshot = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect,
    tables
  );
  return Object.fromEntries(
    tables.map(name => [
      name,
      snapshot.tables
        .find(table => table.name === name)
        ?.columns.map(column => column.name) ?? [],
    ])
  );
}

describe.each(getConfiguredTestDialects())(
  "per-language storage (%s)",
  dialect => {
    it("keeps a collection's translatable fields in its per-language table, and its shared ones on the main table", async () => {
      const t = await boot(dialect, true);
      expect(perLanguageStorageEnabled()).toBe(true);

      const columns = await columnsOf(t, [
        "dc_articles",
        "dc_articles_locales",
      ]);
      expect(columns.dc_articles).toContain("views");
      expect(columns.dc_articles).not.toContain("headline");
      expect(columns.dc_articles).not.toContain("excerpt");
      expect(columns.dc_articles_locales).toEqual(
        expect.arrayContaining(["_parent", "_locale", "headline", "excerpt"])
      );
    });

    it("writes and reads a collection's translatable fields through its per-language table", async () => {
      const t = await boot(dialect, true);
      const created = await t.nextly.create({
        collection: "articles",
        data: { headline: "Hello", excerpt: "A first article.", views: 3 },
      });
      const id = (created.item as { id: string }).id;

      const read = await t.nextly.findByID({ collection: "articles", id });
      expect(read).toMatchObject({
        headline: "Hello",
        excerpt: "A first article.",
        views: 3,
      });
      const list = await t.nextly.find({ collection: "articles" });
      expect(list.items).toEqual([
        expect.objectContaining({ id, headline: "Hello", views: 3 }),
      ]);

      await t.nextly.update({
        collection: "articles",
        id,
        data: { headline: "Hello again" },
      });
      expect(
        await t.nextly.findByID({ collection: "articles", id })
      ).toMatchObject({ headline: "Hello again", excerpt: "A first article." });
    });

    it("stores as it always has with the setting off", async () => {
      const t = await boot(dialect, false);
      expect(perLanguageStorageEnabled()).toBe(false);

      const columns = await columnsOf(t, [
        "dc_articles",
        "dc_articles_locales",
      ]);
      expect(columns.dc_articles).toEqual(
        expect.arrayContaining(["headline", "excerpt", "views"])
      );
      expect(columns.dc_articles_locales).toEqual([]);
    });
  }
);
