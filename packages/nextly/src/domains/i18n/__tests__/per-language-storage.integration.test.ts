/**
 * A site keeping every translatable field per language from the start
 * (`experimental.perLanguageStorage`): on a site that declares no languages and marks nothing
 * translatable, a collection's translatable fields live in its per-language table, under the
 * site's one implicit language, and its shared fields stay on the main table; so do a Single's and
 * a component's. The Direct API writes and reads them there. With the setting off, the same site
 * stores as it always has.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  number,
  relationship,
  text,
  textarea,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { historyLanguagesOf } from "../../../api/versions-access";
import { createAdapter } from "../../../database/factory";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import type { ServiceContainer } from "../../../services";
import { consoleLogger } from "../../../services/shared";
import { _resetEnvCache } from "../../../shared/lib/env";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { refuseCompanionColumnsThatCannotHold } from "../runtime/companion-io";
import { reconcileCompanionUniqueIndexes } from "../runtime/companion-unique-reconcile";
import {
  _resetPerLanguageStorage,
  perLanguageStorageEnabled,
  setPerLanguageStorage,
} from "../per-language-storage";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
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
        data: { tagline: "Welcome", visits: 2, _overwrite: true },
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
        data: { headline: "Hello again", _overwrite: true },
      });
      expect(
        await t.nextly.findByID({ collection: "articles", id })
      ).toMatchObject({ headline: "Hello again", excerpt: "A first article." });
    });

    // A save of an untranslated entity kept per language is recorded in its language, so the
    // history it can be asked about is every configured language, as a translated entity's is.
    it("asks an untranslated Single's history in every language the site keeps it in", async () => {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        singles: [
          defineSingle({
            slug: "notice",
            versions: true,
            fields: [text({ name: "heading" })],
          }),
        ],
      });
      expect(
        [...(await historyLanguagesOf("single", "notice"))].sort()
      ).toEqual(["de", "en"]);
    });

    // A translatable field's values are in the per-language table, which a grouped read does not
    // aggregate yet: it is refused for that reason, as on a translated collection, not as a field
    // that has no column.
    it("refuses grouping by a translatable field as kept per language, not as missing", async () => {
      const t = await boot(dialect, true);
      const refused = await t.nextly
        .group({
          collection: "articles",
          groupBy: "headline",
          overrideAccess: true,
        })
        .then(
          () => undefined,
          (error: unknown) => error
        );
      expect(JSON.stringify(refused)).toContain("stored per locale");
    });

    // An untranslated Single publishes as a document, and its per-language table keeps no
    // `_status`, so a publish made from another language moves the document's own status rather
    // than being dropped for want of a per-language one.
    it("publishes an untranslated Single as a document when the publish is made from another language", async () => {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        singles: [
          defineSingle({
            slug: "notice",
            status: true,
            fields: [text({ name: "heading" })],
          }),
        ],
      });
      await current.nextly.updateSingle({
        slug: "notice",
        locale: "de",
        data: { heading: "Hallo", status: "published", _overwrite: true },
      });
      const [row] = await current.adapter.select<{ status: unknown }>(
        "single_notice",
        {}
      );
      expect(row?.status).toBe("published");
    });

    // A transform of another plugin's entity is judged by where each field keeps its values, which
    // under the setting is per language for an untranslated entity too. The boot folds plugin
    // contributions with the choice already published, so a fresh process judges as the site does.
    it("refuses at boot a plugin transform that moves another plugin's field out of its per-language table", async () => {
      _resetPerLanguageStorage();
      const shop = {
        name: "shop",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            { slug: "orders", fields: [{ name: "title", type: "text" }] },
          ],
        },
      };
      const reviews = {
        name: "reviews",
        version: "1.0.0",
        nextly: ">=0.0.0",
        dependsOn: { shop: "*" },
        contributes: {
          transforms: [
            {
              target: "orders",
              transform: (entity: { fields: Record<string, unknown>[] }) => ({
                ...entity,
                fields: entity.fields.map(field =>
                  field.name === "title"
                    ? { ...field, localized: false }
                    : field
                ),
              }),
            },
          ],
        },
      };
      const booted = createTestNextly({
        dialect,
        perLanguageStorage: true,
        plugins: [shop, reviews] as never,
      });
      const refused = await booted.then(
        async t => {
          current = t;
          return undefined;
        },
        (error: unknown) => error
      );
      expect(JSON.stringify(refused)).toContain("TRANSFORM_FIELD_PROTECTED");
    });

    // An untranslated Single kept per language holds a value in each language, so a Required field
    // it makes shared through its schema dialog leaves translation as on a translated Single: the
    // main table takes the column without its setting first, the default language's value is
    // copied in, and only then is the setting applied, so the save succeeds with the value shared.
    it("makes a Required field of an untranslated Single shared in its dialog, keeping its value", async () => {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        // A code-first neighbour, so the site has content before the Builder adds its own.
        singles: [
          defineSingle({ slug: "site", fields: [text({ name: "x" })] }),
        ],
      });
      vi.stubEnv("NODE_ENV", "development");
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "hero",
          label: "Hero",
          fields: [{ name: "heading", type: "text", required: true }],
        }
      );
      for (const [locale, heading] of [
        ["en", "Hello"],
        ["de", "Hallo"],
      ] as const) {
        await current.nextly.updateSingle({
          slug: "hero",
          locale,
          data: { heading, _overwrite: true },
        });
      }
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const [row] = await current.adapter.executeQuery<{
        version: number | string | null;
      }>(
        `SELECT ${q("schema_version")} AS version FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'hero'`
      );
      const applied = await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "hero" },
        {
          fields: [
            { name: "heading", type: "text", required: true, localized: false },
          ],
          confirmed: true,
          schemaVersion: Number(row?.version ?? 1),
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(applied).toBeUndefined();
      const [main] = await current.adapter.select<{ heading: unknown }>(
        "single_hero",
        {}
      );
      expect(main?.heading).toBe("Hello");
      const archived = await current.adapter.executeQuery<{
        locale: string;
        value: string;
      }>(
        `SELECT ${q("locale")} AS locale, ${q("value")} AS value FROM ${q("nextly_i18n_archive")}`
      );
      expect(archived).toEqual([{ locale: "de", value: "Hallo" }]);
    });

    // `nextly migrate` refuses, before it records the new definitions, a translations column that
    // cannot hold a field the run newly translates. An untranslated entity's translations table
    // is judged the same way under the setting, since its translatable fields live there.
    it("refuses a per-language column that cannot hold an untranslated entity's new field", async () => {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        collections: [
          defineCollection({
            slug: "notes",
            fields: [text({ name: "headline" })],
          }),
        ],
      });
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await current.adapter.executeQuery(
        `ALTER TABLE ${q("dc_notes_locales")} ADD COLUMN ${q("code")} INTEGER`
      );
      const recorded = new Map([
        [
          "collection:notes",
          {
            localized: true,
            fields: [{ name: "headline", type: "text" }],
          },
        ],
      ]);
      const config = {
        collections: [
          {
            slug: "notes",
            fields: [
              { name: "headline", type: "text" },
              { name: "code", type: "text" },
            ],
          },
        ],
      };

      const refused = await refuseCompanionColumnsThatCannotHold(
        current.adapter as never,
        config as never,
        recorded
      ).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(
        JSON.stringify(
          (refused as { publicData?: { errors?: unknown } } | undefined)
            ?.publicData?.errors
        )
      ).toMatch(/cannot hold every value/);
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

    // The Schema Builder lays an entity it creates out as the site does: a collection, a Single and
    // a component made there, none marked translatable, keep their translatable fields per language.
    it("gives a translatable field a Schema Builder save adds its column in the per-language table", async () => {
      const t = await boot(dialect, true);
      vi.stubEnv("NODE_ENV", "development");
      const handler = t.getService("collectionsHandler") as unknown as {
        createCollection(
          data: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      const made = await handler.createCollection({
        name: "memos",
        label: "Memo",
        fields: [{ name: "heading", type: "text" }],
      });
      expect(made.success, JSON.stringify(made)).toBe(true);
      const { schemaVersion } = (await new DynamicCollectionRegistryService(
        t.adapter,
        consoleLogger
      ).getCollection("memos")) as { schemaVersion?: number };

      // The memos collection is not marked translatable, so only the setting keeps the new
      // field's values per language.
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "memos" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "summary", type: "text" },
          ],
          confirmed: true,
          schemaVersion: schemaVersion ?? 1,
        }
      );

      const created = await t.nextly.create({
        collection: "memos",
        data: { heading: "h", summary: "Kept per language" },
      });
      const id = (created.item as { id: string }).id;
      expect(
        await t.nextly.findByID({ collection: "memos", id })
      ).toMatchObject({ heading: "h", summary: "Kept per language" });
    });

    it("keeps the translatable fields of a collection, a Single and a component made in the Schema Builder per language", async () => {
      const t = await boot(dialect, true);
      // The Schema Builder applies what it creates in development.
      vi.stubEnv("NODE_ENV", "development");
      const handler = t.getService("collectionsHandler") as unknown as {
        createCollection(
          data: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      const made = await handler.createCollection({
        name: "posts",
        label: "Post",
        fields: [
          { name: "heading", type: "text" },
          { name: "count", type: "number" },
        ],
      });
      expect(made.success, JSON.stringify(made)).toBe(true);
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "footer",
          label: "Footer",
          fields: [
            { name: "note", type: "text" },
            { name: "year", type: "number" },
          ],
        }
      );
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "badge",
          label: "Badge",
          fields: [
            { name: "caption", type: "text" },
            { name: "size", type: "number" },
          ],
        }
      );

      const columns = await columnsOf(t, [
        "dc_posts",
        "dc_posts_locales",
        "single_footer",
        "single_footer_locales",
        "comp_badge",
        "comp_badge_locales",
      ]);
      expect(columns.dc_posts).toContain("count");
      expect(columns.dc_posts).not.toContain("heading");
      expect(columns.dc_posts_locales).toContain("heading");
      expect(columns.single_footer).toContain("year");
      expect(columns.single_footer).not.toContain("note");
      expect(columns.single_footer_locales).toContain("note");
      expect(columns.comp_badge).toContain("size");
      expect(columns.comp_badge).not.toContain("caption");
      expect(columns.comp_badge_locales).toContain("caption");

      const created = await t.nextly.create({
        collection: "posts",
        data: { heading: "Made in the Builder", count: 4 },
      });
      const id = (created.item as { id: string }).id;
      expect(
        await t.nextly.findByID({ collection: "posts", id })
      ).toMatchObject({ heading: "Made in the Builder", count: 4 });
    });

    // A Draft/Published Single that is not translated publishes as a document too, so its
    // per-language table holds values only: a `_status` there would stay `draft` and hide its
    // translatable values from a published read.
    it("lays out a Draft/Published Single the Schema Builder makes with no per-language status", async () => {
      const t = await boot(dialect, true);
      vi.stubEnv("NODE_ENV", "development");
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          status: true,
          fields: [{ name: "heading", type: "text" }],
        }
      );
      const columns = await columnsOf(t, ["single_notice_locales"]);
      expect(columns.single_notice_locales).toContain("heading");
      expect(columns.single_notice_locales).not.toContain("_status");
    });

    // A Draft/Published collection that is not translated publishes as a document, so its
    // per-language table holds no `_status`: the process the Builder created it in must not
    // expect one either.
    it("writes an entry to a Draft/Published collection the Schema Builder just made", async () => {
      const t = await boot(dialect, true);
      vi.stubEnv("NODE_ENV", "development");
      const handler = t.getService("collectionsHandler") as unknown as {
        createCollection(
          data: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      const made = await handler.createCollection({
        name: "notices",
        label: "Notice",
        status: true,
        fields: [{ name: "heading", type: "text" }],
      });
      expect(made.success, JSON.stringify(made)).toBe(true);
      expect(
        (await columnsOf(t, ["dc_notices_locales"])).dc_notices_locales
      ).not.toContain("_status");

      const created = await t.nextly.create({
        collection: "notices",
        data: { heading: "Made with a status" },
      });
      const id = (created.item as { id: string }).id;
      expect(
        await t.nextly.findByID({ collection: "notices", id })
      ).toMatchObject({ heading: "Made with a status" });
    });

    // A unique translatable field is unique within each language, as on a translated collection.
    it("refuses a second entry with the same value of a unique translatable field", async () => {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        collections: [
          defineCollection({
            slug: "codes",
            fields: [text({ name: "code", unique: true })],
          }),
        ],
      });
      const t = current;
      const columns = await columnsOf(t, ["dc_codes", "dc_codes_locales"]);
      expect(columns.dc_codes).not.toContain("code");
      expect(columns.dc_codes_locales).toContain("code");

      // Its per-language index, from the reconcile `db:sync` and the dev reload run.
      await reconcileCompanionUniqueIndexes(
        t.adapter,
        {
          builtBy: "codeFirst",
          tableName: "dc_codes",
          fields: [{ name: "code", type: "text", unique: true }],
        },
        error => {
          throw error;
        }
      );
      await t.nextly.create({ collection: "codes", data: { code: "A-1" } });
      await expect(
        t.nextly.create({ collection: "codes", data: { code: "A-1" } })
      ).rejects.toMatchObject({ code: "DUPLICATE" });
      await t.nextly.create({ collection: "codes", data: { code: "A-2" } });
    });

    // A database laid out before the setting keeps a collection's translatable values on its main
    // table. Booting it with the setting on is refused before any schema work, naming them.
    it.runIf(dialect === "sqlite")(
      "refuses to boot over a database that keeps translatable values on a main table",
      async () => {
        const folder = mkdtempSync(join(tmpdir(), "nextly-per-language-"));
        const url = `file:${join(folder, "site.db")}`;
        vi.stubEnv("DB_DIALECT", "sqlite");
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        const onFile = async () =>
          createAdapter({ type: "sqlite", url } as Parameters<
            typeof createAdapter
          >[0]);
        const site = {
          collections: [
            defineCollection({
              slug: "articles",
              fields: [text({ name: "headline" }), number({ name: "views" })],
            }),
          ],
        };
        try {
          const before = await createTestNextly({
            ...site,
            adapter: await onFile(),
          });
          // And one the Schema Builder made, known only from its registry row.
          vi.stubEnv("NODE_ENV", "development");
          const handler = before.getService(
            "collectionsHandler"
          ) as unknown as {
            createCollection(
              data: Record<string, unknown>
            ): Promise<{ success: boolean }>;
          };
          const made = await handler.createCollection({
            name: "posts",
            label: "Post",
            fields: [{ name: "heading", type: "text" }],
          });
          expect(made.success, JSON.stringify(made)).toBe(true);
          vi.stubEnv("NODE_ENV", "test");
          await before.destroy();

          let refused: unknown;
          try {
            current = await createTestNextly({
              ...site,
              adapter: await onFile(),
              perLanguageStorage: true,
            });
          } catch (error) {
            refused = error;
          }
          expect(
            NextlyError.isCode(refused, "NEXTLY_PER_LANGUAGE_STORAGE_MIXED")
          ).toBe(true);
          expect((refused as Error).message).toMatch(
            /the collection "articles" \(headline\)/
          );
          expect((refused as Error).message).toMatch(
            /the collection "dc_posts" \(heading\)/
          );
        } finally {
          _resetEnvCache();
          rmSync(folder, { recursive: true, force: true });
        }
      }
    );

    // A site that declared its languages and then drops its `localization` block would fall back
    // to the implicit English, and its translations in any other language would read as gone. It
    // is refused instead, naming those languages and the way back.
    it.runIf(dialect === "sqlite")(
      "refuses to boot in the implicit language over translations in languages it no longer declares",
      async () => {
        const folder = mkdtempSync(join(tmpdir(), "nextly-per-language-"));
        const url = `file:${join(folder, "site.db")}`;
        vi.stubEnv("DB_DIALECT", "sqlite");
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        const onFile = async () =>
          createAdapter({ type: "sqlite", url } as Parameters<
            typeof createAdapter
          >[0]);
        const site = {
          perLanguageStorage: true,
          collections: [
            defineCollection({
              slug: "articles",
              fields: [text({ name: "headline" })],
            }),
          ],
        };
        try {
          const before = await createTestNextly({
            ...site,
            adapter: await onFile(),
            localization: { locales: ["en", "de"], defaultLocale: "en" },
          });
          const created = await before.nextly.create({
            collection: "articles",
            data: { headline: "Hello" },
          });
          await before.nextly.update({
            collection: "articles",
            id: (created.item as { id: string }).id,
            locale: "de",
            data: { headline: "Hallo", _overwrite: true },
          });
          await before.destroy();

          let refused: unknown;
          try {
            current = await createTestNextly({
              ...site,
              adapter: await onFile(),
            });
          } catch (error) {
            refused = error;
          }
          expect(
            NextlyError.isCode(
              refused,
              "NEXTLY_PER_LANGUAGE_STORAGE_LANGUAGES_UNDECLARED"
            )
          ).toBe(true);
          expect((refused as Error).message).toMatch(/"de"/);
          expect((refused as Error).message).toMatch(/localization block/);
        } finally {
          _resetEnvCache();
          rmSync(folder, { recursive: true, force: true });
        }
      }
    );

    // A Builder-made Single whose table is missing at boot has it created from its stored fields,
    // laid out as the setting keeps it: its translatable columns stay in its per-language table.
    it.runIf(dialect === "sqlite")(
      "recreates a Builder-made Single's missing table at boot without its translatable columns",
      async () => {
        const folder = mkdtempSync(join(tmpdir(), "nextly-per-language-"));
        const url = `file:${join(folder, "site.db")}`;
        vi.stubEnv("DB_DIALECT", "sqlite");
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        const onFile = async () =>
          createAdapter({ type: "sqlite", url } as Parameters<
            typeof createAdapter
          >[0]);
        try {
          // The boot reconciles the Builder's Singles beside the configuration's own.
          const site = {
            perLanguageStorage: true,
            singles: [
              defineSingle({ slug: "site", fields: [number({ name: "n" })] }),
            ],
          };
          const before = await createTestNextly({
            ...site,
            adapter: await onFile(),
          });
          vi.stubEnv("NODE_ENV", "development");
          await dispatchSingles(
            "createSingle",
            {},
            {
              slug: "banner",
              label: "Banner",
              fields: [
                { name: "note", type: "text" },
                { name: "year", type: "number" },
              ],
            }
          );
          vi.stubEnv("NODE_ENV", "test");
          await before.adapter.executeQuery(`DROP TABLE "single_banner"`);
          await before.destroy();

          current = await createTestNextly({
            ...site,
            adapter: await onFile(),
          });
          const columns = await columnsOf(current, ["single_banner"]);
          expect(columns.single_banner).toContain("year");
          expect(columns.single_banner).not.toContain("note");
        } finally {
          _resetEnvCache();
          rmSync(folder, { recursive: true, force: true });
        }
      }
    );

    // A related entry is populated with its translatable values too, from its own companion.
    // A site restarted over the database it laid out: the tables registered at boot, before any
    // service, describe the per-language layout, so the entries it wrote read back.
    it.runIf(dialect === "sqlite")(
      "reads its entries back after a restart over the database it laid out",
      async () => {
        const folder = mkdtempSync(join(tmpdir(), "nextly-per-language-"));
        const url = `file:${join(folder, "site.db")}`;
        vi.stubEnv("DB_DIALECT", "sqlite");
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        const onFile = async () =>
          createAdapter({ type: "sqlite", url } as Parameters<
            typeof createAdapter
          >[0]);
        const site = {
          perLanguageStorage: true,
          collections: [
            defineCollection({
              slug: "articles",
              fields: [text({ name: "headline" }), number({ name: "views" })],
            }),
          ],
        };
        try {
          const before = await createTestNextly({
            ...site,
            adapter: await onFile(),
          });
          const created = await before.nextly.create({
            collection: "articles",
            data: { headline: "Kept", views: 3 },
          });
          const id = (created.item as { id: string }).id;
          await before.destroy();

          // A new process starts with the setting unchosen, as this one did before its first boot.
          setPerLanguageStorage(false);
          current = await createTestNextly({
            ...site,
            adapter: await onFile(),
          });
          expect(
            await current.nextly.findByID({ collection: "articles", id })
          ).toMatchObject({ headline: "Kept", views: 3 });
          // And through the table the boot registered for the adapter, which every read by table
          // name goes through: it names only the columns the main table has.
          const rows = await current.adapter.select<Record<string, unknown>>(
            "dc_articles",
            {}
          );
          expect(rows).toHaveLength(1);
          expect(rows[0]).not.toHaveProperty("headline");
        } finally {
          _resetEnvCache();
          rmSync(folder, { recursive: true, force: true });
        }
      }
    );

    // A database laid out with the setting on keeps an untranslated collection's translatable
    // values only in its per-language table. Booting it with the setting off is refused, naming
    // them, rather than reading columns its main table does not have.
    it.runIf(dialect === "sqlite")(
      "refuses to boot with the setting off over a database it laid out per language",
      async () => {
        const folder = mkdtempSync(join(tmpdir(), "nextly-per-language-"));
        const url = `file:${join(folder, "site.db")}`;
        vi.stubEnv("DB_DIALECT", "sqlite");
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        const onFile = async () =>
          createAdapter({ type: "sqlite", url } as Parameters<
            typeof createAdapter
          >[0]);
        const collections = [
          defineCollection({
            slug: "articles",
            fields: [text({ name: "headline" }), number({ name: "views" })],
          }),
        ];
        try {
          const before = await createTestNextly({
            collections,
            perLanguageStorage: true,
            adapter: await onFile(),
          });
          await before.nextly.create({
            collection: "articles",
            data: { headline: "Kept", views: 3 },
          });
          await before.destroy();

          let refused: unknown;
          try {
            current = await createTestNextly({
              collections,
              adapter: await onFile(),
            });
          } catch (error) {
            refused = error;
          }
          expect(
            NextlyError.isCode(refused, "NEXTLY_PER_LANGUAGE_STORAGE_MIXED")
          ).toBe(true);
          expect((refused as Error).message).toMatch(
            /the collection "articles" \(headline\)/
          );
        } finally {
          _resetEnvCache();
          rmSync(folder, { recursive: true, force: true });
        }
      }
    );

    it("populates a related entry's translatable fields", async () => {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        collections: [
          defineCollection({
            slug: "writers",
            fields: [text({ name: "name" }), number({ name: "age" })],
          }),
          defineCollection({
            slug: "stories",
            fields: [
              text({ name: "headline" }),
              relationship({ name: "writer", relationTo: "writers" }),
            ],
          }),
        ],
      });
      const t = current;
      const writer = await t.nextly.create({
        collection: "writers",
        data: { name: "Ada", age: 36 },
      });
      const writerId = (writer.item as { id: string }).id;
      const story = await t.nextly.create({
        collection: "stories",
        data: { headline: "Told", writer: writerId },
      });
      const id = (story.item as { id: string }).id;

      expect(
        await t.nextly.findByID({ collection: "stories", id, depth: 1 })
      ).toMatchObject({ writer: { id: writerId, name: "Ada", age: 36 } });
      const list = await t.nextly.find({ collection: "stories", depth: 1 });
      expect(list.items).toEqual([
        expect.objectContaining({
          writer: expect.objectContaining({ name: "Ada", age: 36 }),
        }),
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
