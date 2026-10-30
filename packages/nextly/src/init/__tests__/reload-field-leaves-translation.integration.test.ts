// A config reload under `next dev` that makes a field of a translated collection shared keeps the
// field's values: the default language's on the main table, every other language in the archive.
// Driven through `reloadNextlyConfig` itself, on every configured dialect.
//
// A Required or Unique field leaving translation is added to the main table without its setting,
// filled from the default language, and given the setting before its translations column goes. When
// the values cannot take the setting, the reload changes nothing and says why.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { reloadNextlyConfig } from "../reload-config";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

const SLUG = "rlleaves";
const TABLE = `dc_${SLUG}`;
const COMPANION = `${TABLE}_locales`;

/** The collection, translated, with `body` translated or shared and its settings. */
const configWith = (body: {
  localized: boolean;
  required?: boolean;
  unique?: boolean;
}) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text", localized: false },
          { name: "body", type: "text", ...body },
        ] as never,
      }),
    ],
  });

describe.each(getConfiguredTestDialects())(
  "a config reload that makes a translated field shared (%s)",
  dialect => {
    let handle: TestNextly;
    let said: ReturnType<typeof vi.spyOn>[];

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // The reload runs its schema work only under next dev.
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = configWith({ localized: true });
      await reloadNextlyConfig();
      said = [
        vi.spyOn(console, "warn").mockImplementation(() => {}),
        vi.spyOn(console, "error").mockImplementation(() => {}),
      ];
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await handle?.destroy();
    });

    /** Entries with their values of `body` by language; a language left out has no row. */
    async function seed(
      entries: Record<string, { en?: string; es?: string }>
    ): Promise<void> {
      for (const [id, values] of Object.entries(entries)) {
        await handle.adapter.executeQuery(
          `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('${id}', '${id}', '${id}')`
        );
        for (const [locale, value] of Object.entries(values)) {
          await handle.adapter.executeQuery(
            `INSERT INTO ${q(COMPANION)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) VALUES ('${id}', '${locale}', '${value}')`
          );
        }
      }
    }

    async function columnsOf(name: string): Promise<string[]> {
      const rows = (await handle.adapter.executeQuery(
        dialect === "sqlite"
          ? `SELECT name AS name FROM pragma_table_info('${name}')`
          : dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${name}'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${name}'`
      )) as { name: string }[];
      return rows.map(row => row.name);
    }

    async function mainBodies(): Promise<Record<string, string | null>> {
      const rows = (await handle.adapter.executeQuery(
        `SELECT ${q("id")} AS id, ${q("body")} AS body FROM ${q(TABLE)} ORDER BY ${q("id")}`
      )) as { id: string; body: string | null }[];
      return Object.fromEntries(rows.map(row => [row.id, row.body]));
    }

    async function archived(): Promise<{ locale: string; value: string }[]> {
      return (await handle.adapter.executeQuery(
        `SELECT ${q("locale")} AS locale, ${q("value")} AS value FROM ${q("nextly_i18n_archive")} ` +
          `WHERE ${q("collection")} = '${SLUG}' AND ${q("field")} = 'body' ORDER BY ${q("id")}`
      )) as { locale: string; value: string }[];
    }

    const told = () =>
      said.flatMap(spy => spy.mock.calls.flat().map(String)).join("\n");

    it("keeps the default language's value on the main table, and archives the others", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });

      loaded.config = configWith({ localized: false });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Hello" });
      expect(await archived()).toEqual([{ locale: "es", value: "Hola" }]);
      expect(await columnsOf(COMPANION)).not.toContain("body");
    });

    it("makes a Required field required once its values are copied, without asking", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" }, e2: { en: "Bye" } });

      loaded.config = configWith({ localized: false, required: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Hello", e2: "Bye" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
      // NOT NULL, with no default to fill it.
      await expect(
        handle.adapter.executeQuery(
          `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e3', 'e3', 'e3')`
        )
      ).rejects.toThrow();
    });

    it("refuses a Required field while an entry has no English value, changing nothing", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" }, e2: { es: "Solo" } });

      loaded.config = configWith({ localized: false, required: true });
      await reloadNextlyConfig();

      // The refusal of the setting, not the terminal prompt for a required column.
      expect(told()).toMatch(/no English body/);
      expect(told()).toMatch(/remove `required`.*save/s);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });

    it("makes a Unique field unique once its values are copied", async () => {
      await seed({ e1: { en: "A", es: "Uno" }, e2: { en: "B", es: "Uno" } });

      loaded.config = configWith({ localized: false, unique: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "A", e2: "B" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
      await expect(
        handle.adapter.executeQuery(
          `UPDATE ${q(TABLE)} SET ${q("body")} = 'A' WHERE ${q("id")} = 'e2'`
        )
      ).rejects.toThrow();
    });

    it("refuses a Unique field while two entries share an English value, changing nothing", async () => {
      await seed({ e1: { en: "Same", es: "Uno" }, e2: { en: "Same" } });

      loaded.config = configWith({ localized: false, unique: true });
      await reloadNextlyConfig();

      expect(told()).toMatch(/would share a value for body/);
      expect(told()).toMatch(/remove `unique`.*save/s);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });
  }
);
