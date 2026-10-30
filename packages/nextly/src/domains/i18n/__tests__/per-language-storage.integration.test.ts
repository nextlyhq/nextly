/**
 * A site keeping every translatable field per language from the start
 * (`experimental.perLanguageStorage`): on a site that declares no languages and marks nothing
 * translatable, a collection's translatable fields live in its per-language table, under the
 * site's one implicit language, and its shared fields stay on the main table; so do a Single's and
 * a component's. The Direct API writes and reads them there. With the setting off, the same site
 * stores as it always has.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  number,
  text,
  textarea,
} from "../../../config";
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

/**
 * A site with a collection, a Single and a component, each holding translatable and shared fields,
 * and no languages declared.
 */
async function boot(dialect: TestDialect, perLanguageStorage: boolean) {
  current = await createTestNextly({
    dialect,
    perLanguageStorage,
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [text({ name: "heading" }), number({ name: "rank" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "site",
        fields: [text({ name: "tagline" }), number({ name: "visits" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "articles",
        fields: [
          text({ name: "headline" }),
          textarea({ name: "excerpt" }),
          number({ name: "views" }),
          fieldGroup({ name: "card", component: "card" }),
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

    it("keeps a Single's and a component's translatable fields in their per-language tables", async () => {
      const t = await boot(dialect, true);
      const columns = await columnsOf(t, [
        "single_site",
        "single_site_locales",
        "comp_card",
        "comp_card_locales",
      ]);
      expect(columns.single_site).toContain("visits");
      expect(columns.single_site).not.toContain("tagline");
      expect(columns.single_site_locales).toEqual(
        expect.arrayContaining(["_parent", "_locale", "tagline"])
      );
      expect(columns.comp_card).toContain("rank");
      expect(columns.comp_card).not.toContain("heading");
      expect(columns.comp_card_locales).toEqual(
        expect.arrayContaining(["_parent", "_locale", "heading"])
      );
    });

    it("writes and reads a Single's and a component's translatable fields through their per-language tables", async () => {
      const t = await boot(dialect, true);
      await t.nextly.updateSingle({
        slug: "site",
        data: { tagline: "Welcome", visits: 2 },
      });
      expect(await t.nextly.findSingle({ slug: "site" })).toMatchObject({
        tagline: "Welcome",
        visits: 2,
      });

      const created = await t.nextly.create({
        collection: "articles",
        data: { headline: "Carded", card: { heading: "On the card", rank: 1 } },
      });
      const id = (created.item as { id: string }).id;
      expect(
        await t.nextly.findByID({ collection: "articles", id })
      ).toMatchObject({ card: { heading: "On the card", rank: 1 } });
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

    // Publishing stays document-level for an entity that is not translated: its per-language row
    // holds values, not a status of its own, so a published read keeps every translatable value.
    it("keeps the translatable fields of a published entry that is not translated, on a Draft/Published collection", async () => {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        collections: [
          defineCollection({
            slug: "notes",
            status: true,
            fields: [text({ name: "headline" }), number({ name: "views" })],
          }),
        ],
      });
      const t = current;
      // The values the published read must keep are only in the per-language table.
      const columns = await columnsOf(t, ["dc_notes", "dc_notes_locales"]);
      expect(columns.dc_notes).not.toContain("headline");
      expect(columns.dc_notes_locales).toContain("headline");
      const created = await t.nextly.create({
        collection: "notes",
        data: { headline: "Published", views: 1, status: "published" },
      });
      const id = (created.item as { id: string }).id;

      expect(
        await t.nextly.findByID({
          collection: "notes",
          id,
          status: "published",
        })
      ).toMatchObject({ headline: "Published", views: 1 });
      const list = await t.nextly.find({
        collection: "notes",
        status: "published",
      });
      expect(list.items).toEqual([
        expect.objectContaining({ id, headline: "Published" }),
      ]);
    });

    it("stores as it always has with the setting off", async () => {
      const t = await boot(dialect, false);
      expect(perLanguageStorageEnabled()).toBe(false);

      const columns = await columnsOf(t, [
        "dc_articles",
        "dc_articles_locales",
        "single_site",
        "single_site_locales",
        "comp_card",
        "comp_card_locales",
      ]);
      expect(columns.dc_articles).toEqual(
        expect.arrayContaining(["headline", "excerpt", "views"])
      );
      expect(columns.single_site).toEqual(
        expect.arrayContaining(["tagline", "visits"])
      );
      expect(columns.comp_card).toEqual(
        expect.arrayContaining(["heading", "rank"])
      );
      expect(columns.dc_articles_locales).toEqual([]);
      expect(columns.single_site_locales).toEqual([]);
      expect(columns.comp_card_locales).toEqual([]);
    });
  }
);
