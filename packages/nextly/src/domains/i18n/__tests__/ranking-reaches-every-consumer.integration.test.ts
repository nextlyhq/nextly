/**
 * Every place that decides which language's value an entry keeps when translation stops picks the
 * same one: the value its readers saw. On every dialect.
 *
 * The entry below has no row in the default language, a draft in German, which the site lists
 * first, and a published French. Readers see French, so French is kept: by the copy when one field
 * stops being translated, by the copy when the whole collection stops being translated, by the
 * Required check that judges whether every entry keeps a value, and by the preview of that check.
 * A consumer that skips the ranking takes the German draft (the default language's row, else the
 * first by code or in the site's order), which no reader ever saw, or refuses a change whose kept
 * values are all there.
 */
import { afterEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

interface Entries {
  createEntry(
    params: {
      collectionName: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
  updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean }>;
}

interface CollectionsHandler {
  createCollection(
    data: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  updateCollection(
    params: { collectionName: string },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntryService(): Entries;
}

interface Preview {
  leavingTranslation?: { name: string; refusal?: unknown }[];
}

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

const SHARED_REQUIRED = [
  { name: "heading", type: "text", localized: false, required: true },
];

describeEachDialect(
  "the language an entry keeps, as every consumer of the choice picks it",
  dialect => {
    let current: TestNextly | undefined;
    const q = (name: string) => quote(dialect, name);

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      vi.unstubAllEnvs();
    });

    /**
     * A translated Draft/Published collection with one entry: no default-language row, a German
     * draft and a published French, in a site that lists German before French.
     */
    async function seeded(): Promise<{
      handler: CollectionsHandler;
      id: string;
    }> {
      // The builder's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
      });
      const handler = current.getService(
        "collectionsHandler"
      ) as unknown as CollectionsHandler;
      const made = await handler.createCollection({
        name: "posts",
        label: "Post",
        localized: true,
        status: true,
        fields: [{ name: "heading", type: "text" }],
      });
      expect(made.success, JSON.stringify(made)).toBe(true);
      const entries = handler.getEntryService();
      const created = await entries.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "fr" },
        { heading: "Bonjour", status: "published" }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = String((created.data as { id: unknown }).id);
      const german = await entries.updateEntry(
        {
          collectionName: "posts",
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { heading: "Hallo", status: "draft", _overwrite: true }
      );
      expect(german.success, JSON.stringify(german)).toBe(true);
      // The fixture the choice turns on: no default-language row, German a draft, French live.
      const rows = await current.adapter.executeQuery<{
        locale: string;
        status: string;
      }>(
        `SELECT ${q("_locale")} AS locale, ${q("_status")} AS status FROM ${q("dc_posts_locales")} ORDER BY ${q("_locale")}`
      );
      expect(rows).toEqual([
        { locale: "de", status: "draft" },
        { locale: "fr", status: "published" },
      ]);
      return { handler, id };
    }

    async function kept(id: string) {
      const [main] = await current!.adapter.executeQuery<{
        heading: string | null;
      }>(
        `SELECT ${q("heading")} AS heading FROM ${q("dc_posts")} WHERE ${q("id")} = '${id}'`
      );
      const archived = await current!.adapter.executeQuery<{ locale: string }>(
        `SELECT ${q("locale")} AS locale FROM ${q("nextly_i18n_archive")} WHERE ${q("entry_id")} = '${id}' AND ${q("field")} = 'heading' ORDER BY ${q("locale")}`
      );
      return { shared: main?.heading, archived: archived.map(r => r.locale) };
    }

    async function companionSql(statement: string): Promise<void> {
      await current!.adapter.executeQuery(statement);
    }

    async function makeHeadingShared(handler: CollectionsHandler) {
      const saved = await handler.updateCollection(
        { collectionName: "posts" },
        { fields: [{ name: "heading", type: "text", localized: false }] }
      );
      expect(saved.success, saved.message).toBe(true);
    }

    // A language removed in Settings keeps its rows, which no reader can reach: a published one
    // is not what readers saw.
    it("keeps a draft of a language the site lists over a published one of a language it removed", async () => {
      const { handler, id } = await seeded();
      await companionSql(
        `UPDATE ${q("dc_posts_locales")} SET ${q("_status")} = 'draft' WHERE ${q("_locale")} = 'fr'`
      );
      await companionSql(
        `INSERT INTO ${q("dc_posts_locales")} (${q("_parent")}, ${q("_locale")}, ${q("_status")}, ${q("heading")}) VALUES ('${id}', 'it', 'published', 'Ciao')`
      );

      await makeHeadingShared(handler);

      expect(await kept(id)).toEqual({
        shared: "Hallo",
        archived: ["fr", "it"],
      });
    });

    // A reader whose language's row is empty is shown the next language that has the field, so
    // the value kept is that one, not the empty row.
    it("keeps the next live language's value where the first live one has the field empty", async () => {
      const { handler, id } = await seeded();
      await companionSql(
        `UPDATE ${q("dc_posts_locales")} SET ${q("_status")} = 'published', ${q("heading")} = NULL WHERE ${q("_locale")} = 'de'`
      );

      await makeHeadingShared(handler);

      expect(await kept(id)).toEqual({ shared: "Bonjour", archived: [] });
    });

    // Readers of a published row whose field is empty saw nothing there; a draft with a value is
    // not what they saw, so it is not made public.
    it("keeps a published English that is empty rather than a draft that has the field", async () => {
      const { handler, id } = await seeded();
      await companionSql(
        `UPDATE ${q("dc_posts_locales")} SET ${q("_status")} = 'draft' WHERE ${q("_locale")} = 'fr'`
      );
      await companionSql(
        `INSERT INTO ${q("dc_posts_locales")} (${q("_parent")}, ${q("_locale")}, ${q("_status")}, ${q("heading")}) VALUES ('${id}', 'en', 'published', NULL)`
      );

      await makeHeadingShared(handler);

      expect(await kept(id)).toEqual({
        shared: null,
        archived: ["de", "fr"],
      });
    });

    it("keeps the published French when the whole collection stops being translated", async () => {
      const { handler, id } = await seeded();

      const saved = await handler.updateCollection(
        { collectionName: "posts" },
        { localized: false, fields: [{ name: "heading", type: "text" }] }
      );

      expect(saved.success, saved.message).toBe(true);
      expect(await kept(id)).toEqual({ shared: "Bonjour", archived: ["de"] });
    });

    it("judges a Required field leaving translation on the French it keeps, and applies it", async () => {
      const { handler, id } = await seeded();

      const saved = await handler.updateCollection(
        { collectionName: "posts" },
        { fields: SHARED_REQUIRED }
      );

      expect(saved.success, saved.message).toBe(true);
      expect(await kept(id)).toEqual({ shared: "Bonjour", archived: ["de"] });
    });

    it("previews no refusal for the Required field the apply accepts", async () => {
      await seeded();

      const response = (await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "posts" },
        { fields: SHARED_REQUIRED, localized: true }
      )) as Response;
      const body = (await response.json()) as Preview & { data?: Preview };
      const preview = body.data ?? body;

      expect(preview.leavingTranslation?.map(f => f.name)).toEqual(["heading"]);
      expect(preview.leavingTranslation?.[0]?.refusal).toBeUndefined();
    });
  }
);
