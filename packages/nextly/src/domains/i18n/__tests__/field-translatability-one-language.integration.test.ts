/**
 * A site with one language keeps every value when a field's translatability changes, both ways,
 * on every dialect: the value moves between the shared and the translated storage, and nothing is
 * archived, since no other language holds a value to lose.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

const TRANSLATED = [{ name: "heading", type: "text" }];
const SHARED = [{ name: "heading", type: "text", localized: false }];

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a field's translatability on a one-language site",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The builder's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const handler = () =>
      current.getService("collectionsHandler") as unknown as CollectionsHandler;

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    /** Every entry's heading, read through the Direct API, by id. */
    async function headings(): Promise<Record<string, unknown>> {
      // Read as the Direct API types it: rows of unknown values, keyed by id.
      const { items } = await current.nextly.find({
        collection: "onelangposts",
        limit: 10,
      });
      return Object.fromEntries(
        items.map(item => [String(item.id), item.heading])
      );
    }

    async function archived(): Promise<number> {
      const rows = await query<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM ${quote(dialect, "nextly_i18n_archive")}`
      ).catch(() => [{ n: 0 }]);
      return Number(rows[0]?.n ?? 0);
    }

    async function seeded(fields: Record<string, unknown>[]) {
      const made = await handler().createCollection({
        name: "onelangposts",
        label: "Post",
        localized: true,
        fields,
      });
      expect(made.success, JSON.stringify(made)).toBe(true);
      for (const heading of ["Hello", "World"]) {
        const created = await handler().getEntryService().createEntry(
          {
            collectionName: "onelangposts",
            overrideAccess: true,
            locale: "en",
          },
          { heading }
        );
        expect(created.success, JSON.stringify(created)).toBe(true);
      }
      return headings();
    }

    async function change(fields: Record<string, unknown>[]) {
      const saved = await handler().updateCollection(
        { collectionName: "onelangposts" },
        { fields }
      );
      expect(saved.success, saved.message).toBe(true);
    }

    it("keeps every value when a field stops being translated, and archives nothing", async () => {
      const before = await seeded(TRANSLATED);

      await change(SHARED);

      expect(await headings()).toEqual(before);
      expect(Object.values(before).sort()).toEqual(["Hello", "World"]);
      expect(await archived()).toBe(0);
    });

    it("keeps every value when a field becomes translated, and archives nothing", async () => {
      const before = await seeded(SHARED);

      await change(TRANSLATED);

      expect(await headings()).toEqual(before);
      expect(Object.values(before).sort()).toEqual(["Hello", "World"]);
      expect(await archived()).toBe(0);
    });
  }
);
