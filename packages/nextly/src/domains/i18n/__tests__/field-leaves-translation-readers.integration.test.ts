/**
 * A field that stops being translated keeps what its readers see, on every dialect.
 *
 * The shared value a field takes is the value its readers were shown: the default language's
 * where it is published, else that of the first LIVE language in the site's language order, and
 * only then a draft. Every other language's value goes to the archive. An entry with no row in the
 * default language took the first language by CODE, which could be a draft no reader saw, or a
 * language the site lists after another that is just as live.
 */
import { afterEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

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

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a field leaving translation keeps what readers see",
  dialect => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      vi.unstubAllEnvs();
    });

    /**
     * A translated Draft/Published collection whose one entry has no row in the default language:
     * written in two other languages, each published or not as `live` says.
     */
    async function seeded(
      locales: string[],
      values: Record<string, { heading: string; live: boolean }>
    ) {
      // The builder's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales, defaultLocale: "en" },
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
      const [first, ...rest] = Object.entries(values);
      const created = await entries.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: first[0] },
        {
          heading: first[1].heading,
          status: first[1].live ? "published" : "draft",
        }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = String((created.data as { id: unknown }).id);
      for (const [locale, { heading, live }] of rest) {
        const written = await entries.updateEntry(
          {
            collectionName: "posts",
            entryId: id,
            overrideAccess: true,
            locale,
          },
          { heading, status: live ? "published" : "draft", _overwrite: true }
        );
        expect(written.success, JSON.stringify(written)).toBe(true);
      }
      const q = (name: string) => quote(dialect, name);
      // No row in the default language, which is what leaves the choice to the other languages.
      const defaultRows = await current.adapter.executeQuery<{
        n: number | string;
      }>(
        `SELECT COUNT(*) AS n FROM ${q("dc_posts_locales")} WHERE ${q("_locale")} = 'en'`
      );
      expect(Number(defaultRows[0]?.n ?? 0)).toBe(0);
      return { handler, id };
    }

    async function makeShared(handler: CollectionsHandler) {
      const saved = await handler.updateCollection(
        { collectionName: "posts" },
        { fields: [{ name: "heading", type: "text", localized: false }] }
      );
      expect(saved.success, saved.message).toBe(true);
    }

    async function sharedAndArchived(id: string) {
      const q = (name: string) => quote(dialect, name);
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

    it("takes the first live language in the site's order, not the first by code", async () => {
      const { handler, id } = await seeded(["en", "fr", "de"], {
        fr: { heading: "Bonjour", live: true },
        de: { heading: "Hallo", live: true },
      });

      await makeShared(handler);

      // French is kept and archived as its own too, so a later restore can put it back.
      expect(await sharedAndArchived(id)).toEqual({
        shared: "Bonjour",
        archived: ["de", "fr"],
      });
    });

    it("takes a live language over a draft the site lists first", async () => {
      const { handler, id } = await seeded(["en", "de", "fr"], {
        fr: { heading: "Bonjour", live: true },
        de: { heading: "Hallo", live: false },
      });

      await makeShared(handler);

      // French is kept and archived as its own too, so a later restore can put it back.
      expect(await sharedAndArchived(id)).toEqual({
        shared: "Bonjour",
        archived: ["de", "fr"],
      });
    });
  }
);
