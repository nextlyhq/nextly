/**
 * A translated field marked Required or Unique becomes shared in one change, keeping its default
 * language's value as the shared one, when the values in place satisfy the setting.
 *
 * The shared column has to be created without its constraint, filled from the default language,
 * and only then constrained: created constrained, every existing row briefly holds the same
 * placeholder or none, which neither setting accepts. When the default language's values do not
 * satisfy the setting (an entry without one, for Required; a value two entries share, for Unique)
 * the change is refused before anything runs, saying how many entries are in the way.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
}

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
  updateCollection(
    params: { collectionName: string },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntryService(): Entries;
}

/**
 * The field under test. An email field is stored in a bounded text column on every dialect, so
 * MySQL can make it unique (an unbounded text column it cannot key), and the schema dialog's
 * fields payload takes it as it is.
 */
const CODE = { name: "code", type: "email" };

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a Required or Unique field that becomes shared",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The builder's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    function handler(): CollectionsHandler {
      return current.getService(
        "collectionsHandler"
      ) as unknown as CollectionsHandler;
    }

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function schemaVersionOf(slug: string): Promise<number> {
      const [row] = await query<{ version: number | string | null }>(
        `SELECT ${quote(dialect, "schema_version")} AS version FROM ${quote(dialect, "dynamic_collections")} WHERE ${quote(dialect, "slug")} = '${slug}'`
      );
      return Number(row?.version ?? 1);
    }

    /** The two paths a collection's field can become shared by. */
    const CHANGES = [
      {
        path: "the builder saves the field alone",
        change: async (fields: unknown[]) => {
          const saved = await handler().updateCollection(
            { collectionName: "posts" },
            { fields }
          );
          if (!saved.success) throw new Error(JSON.stringify(saved));
        },
      },
      {
        path: "the builder applies the change with the schema dialog",
        change: async (fields: unknown[]) => {
          await dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: "posts" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf("posts"),
            }
          );
        },
      },
    ];

    const SETTINGS = [
      { setting: "required", flags: { required: true } },
      { setting: "unique", flags: { unique: true } },
    ];

    /**
     * A translated collection whose `code` holds, in English, each of `english` (one entry per
     * value; `undefined` writes an entry with no English `code`).
     */
    async function seedCodes(
      flags: Record<string, unknown>,
      english: (string | undefined)[]
    ): Promise<void> {
      const created = await handler().createCollection({
        name: "posts",
        label: "Post",
        localized: true,
        fields: [{ ...CODE }, { name: "views", type: "number" }],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
      const entries = handler().getEntryService();
      for (const value of english) {
        const entry = await entries.createEntry(
          { collectionName: "posts", overrideAccess: true, locale: "en" },
          value === undefined ? { views: 1 } : { code: value, views: 1 }
        );
        expect(entry.success, JSON.stringify(entry)).toBe(true);
      }
      // The setting goes on while the field is still translated, as an author would have it.
      const constrained = await handler().updateCollection(
        { collectionName: "posts" },
        {
          fields: [
            { ...CODE, ...flags },
            { name: "views", type: "number" },
          ],
        }
      );
      expect(constrained.success, JSON.stringify(constrained)).toBe(true);
    }

    async function sharedCodes(): Promise<unknown[]> {
      const rows = await query<{ code: unknown }>(
        `SELECT ${quote(dialect, "code")} AS code FROM ${quote(dialect, "dc_posts")} ORDER BY ${quote(dialect, "code")}`
      );
      return rows.map(row => row.code);
    }

    async function companionCodes(): Promise<unknown[]> {
      const rows = await query<{ code: unknown }>(
        `SELECT ${quote(dialect, "code")} AS code FROM ${quote(dialect, "dc_posts_locales")} ` +
          `WHERE ${quote(dialect, "_locale")} = 'en' ORDER BY ${quote(dialect, "code")}`
      );
      return rows.map(row => row.code);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name);
    }

    /** The error a refused change raised or reported, as text. */
    function reported(refusal: unknown): string {
      return refusal instanceof Error
        ? `${refusal.message} ${JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)}`
        : String(refusal);
    }

    function attempt(promise: Promise<void>): Promise<unknown> {
      return promise.then(
        () => undefined,
        (error: unknown) => error
      );
    }

    /** Whether the database itself refuses a row that breaks the setting. */
    async function databaseRefuses(setting: string): Promise<boolean> {
      const values =
        setting === "unique" ? `'dup-id', 'a1@example.com'` : `'null-id', NULL`;
      const failed = await query(
        `INSERT INTO ${quote(dialect, "dc_posts")} (${quote(dialect, "id")}, ${quote(dialect, "code")}) VALUES (${values})`
      ).then(
        () => false,
        () => true
      );
      return failed;
    }

    it.each(CHANGES.flatMap(c => SETTINGS.map(s => ({ ...c, ...s }))))(
      "keeps English's values as the shared ones and enforces $setting when $path",
      async ({ change, setting, flags }) => {
        await seedCodes(flags, ["a1@example.com", "b2@example.com"]);

        await change([
          { ...CODE, localized: false, ...flags },
          { name: "views", type: "number" },
        ]);

        expect(await sharedCodes()).toEqual([
          "a1@example.com",
          "b2@example.com",
        ]);
        expect(await databaseRefuses(setting)).toBe(true);
      }
    );

    it.each(CHANGES)(
      "refuses a Required field while an entry has no English value, saying how many, when $path",
      async ({ change }) => {
        await seedCodes({ required: false }, ["a1@example.com", undefined]);
        // Required goes on while translated; the entry without English stays without it.
        const constrained = await handler().updateCollection(
          { collectionName: "posts" },
          {
            fields: [
              { ...CODE, required: true },
              { name: "views", type: "number" },
            ],
          }
        );
        expect(constrained.success, JSON.stringify(constrained)).toBe(true);

        const refusal = await attempt(
          change([
            {
              ...CODE,
              localized: false,
              required: true,
            },
            { name: "views", type: "number" },
          ])
        );

        expect(reported(refusal)).toMatch(/1 entry has no English code/);
        // Still translated: the entry without English keeps its NULL there.
        expect((await companionCodes()).filter(code => code !== null)).toEqual([
          "a1@example.com",
        ]);
        expect(await columnsOf("dc_posts")).not.toContain("code");
      }
    );

    it.each(CHANGES)(
      "refuses a Unique field while two entries share an English value, without naming it, when $path",
      async ({ change }) => {
        await seedCodes({}, ["same@example.com", "same@example.com"]);

        const refusal = await attempt(
          change([
            {
              ...CODE,
              localized: false,
              unique: true,
            },
            { name: "views", type: "number" },
          ])
        );

        expect(reported(refusal)).toMatch(
          /2 entries share an English value for code, which must be unique/
        );
        expect(reported(refusal)).not.toContain("same@example.com");
        expect(await companionCodes()).toEqual([
          "same@example.com",
          "same@example.com",
        ]);
        expect(await columnsOf("dc_posts")).not.toContain("code");
      }
    );
  }
);
