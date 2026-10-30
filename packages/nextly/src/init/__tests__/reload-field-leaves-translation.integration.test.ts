// A config reload under `next dev` that makes a field of a translated collection shared keeps the
// field's values: the default language's on the main table, every other language in the archive.
// Driven through `reloadNextlyConfig` itself, on every configured dialect.
//
// A Required or Unique field leaving translation is added to the main table without its setting,
// filled from the default language, and given the setting before its translations column goes. When
// the values cannot take the setting, the reload changes nothing and says why.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../config";
import type { PromptDispatcher } from "../../domains/schema/pipeline/pushschema-pipeline-interfaces";
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
/** A second collection, for a reload that moves fields of two at once. */
const OTHER = "rlleavesb";
const OTHER_TABLE = `dc_${OTHER}`;

/** The collection, translated, with `body` translated or shared and its settings. */
type Body = {
  localized: boolean;
  required?: boolean;
  unique?: boolean;
  type?: string;
  /** A shared field beside it, for a reload that changes something else too. */
  summary?: true;
  /** `title`'s type, for a reload with a change that needs review. */
  titleType?: string;
  /** A unique index on `body` declared in the collection's `indexes`. */
  indexedUnique?: true;
};

/** A translated collection whose `body` is translated or shared, with its settings. */
const collectionWith = (
  slug: string,
  { summary, titleType, indexedUnique, ...body }: Body
) =>
  defineCollection({
    slug,
    localized: true,
    ...(indexedUnique ? { indexes: [{ fields: ["body"], unique: true }] } : {}),
    fields: [
      { name: "title", type: titleType ?? "text", localized: false },
      { name: "body", type: "text", ...body },
      ...(summary ? [{ name: "summary", type: "text", localized: false }] : []),
    ] as never,
  });

/** The collection, and `other` beside it when given. */
const configWith = (body: Body, other?: Body) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      collectionWith(SLUG, body),
      ...(other ? [collectionWith(OTHER, other)] : []),
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
      entries: Record<string, { en?: string; es?: string }>,
      table = TABLE
    ): Promise<void> {
      for (const [id, values] of Object.entries(entries)) {
        await handle.adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('${id}', '${id}', '${id}')`
        );
        for (const [locale, value] of Object.entries(values)) {
          await handle.adapter.executeQuery(
            `INSERT INTO ${q(`${table}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) VALUES ('${id}', '${locale}', '${value}')`
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

    async function mainBodies(
      table = TABLE
    ): Promise<Record<string, string | null>> {
      const rows = (await handle.adapter.executeQuery(
        `SELECT ${q("id")} AS id, ${q("body")} AS body FROM ${q(table)} ORDER BY ${q("id")}`
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

    it("moves Required fields of two collections in one reload, each required once its values are copied", async () => {
      loaded.config = configWith({ localized: true }, { localized: true });
      await reloadNextlyConfig();
      await seed({ e1: { en: "Hello", es: "Hola" } });
      await seed({ f1: { en: "Bye", es: "Adiós" } }, OTHER_TABLE);

      loaded.config = configWith(
        { localized: false, required: true },
        { localized: false, required: true }
      );
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Hello" });
      expect(await mainBodies(OTHER_TABLE)).toEqual({ f1: "Bye" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
      expect(await columnsOf(`${OTHER_TABLE}_locales`)).not.toContain("body");
    });

    it("leaves a translations column the registry never recorded as the field's, and the main value", async () => {
      // The field has been shared since the last reload; a column of the same name is left in the
      // translations table, from before.
      loaded.config = configWith({ localized: false });
      await reloadNextlyConfig();
      await handle.adapter.executeQuery(
        `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("body")}) VALUES ('e1', 'e1', 'e1', 'Fresh')`
      );
      await handle.adapter.executeQuery(
        `ALTER TABLE ${q(COMPANION)} ADD COLUMN ${q("body")} TEXT`
      );
      await handle.adapter.executeQuery(
        `INSERT INTO ${q(COMPANION)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) VALUES ('e1', 'en', 'Stale')`
      );

      // A reload that changes something else, so it applies and reaches the move.
      loaded.config = configWith({ localized: false, summary: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Fresh" });
      expect(await columnsOf(COMPANION)).toContain("body");
    });

    it("refuses a field that changes how it is stored as it leaves translation, changing nothing", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });

      loaded.config = configWith({ localized: false, type: "number" });
      await reloadNextlyConfig();

      expect(told()).toMatch(/"rlleaves".*body/s);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });

    it("finishes a move an earlier reload stopped after adding the main column", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });
      // What the first apply of a stopped move leaves: the main column, nullable and empty.
      await handle.adapter.executeQuery(
        `ALTER TABLE ${q(TABLE)} ADD COLUMN ${q("body")} TEXT`
      );

      loaded.config = configWith({ localized: false, required: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Hello" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
    });

    it("stops the reload when the collection a field leaves translation on has a change that needs review", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });

      // `title` changes type, which a reload leaves for review: the field's move waits for it,
      // even where the terminal confirms the type change, as a developer at one may.
      const confirming: PromptDispatcher = {
        dispatch: () =>
          Promise.resolve({
            confirmedRenames: [],
            resolutions: [],
            proceed: true,
          }),
      };
      loaded.config = configWith({ localized: false, titleType: "number" });
      await reloadNextlyConfig({ dispatcher: confirming });

      expect(told()).toMatch(/"rlleaves".*another change/s);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });

    it("refuses a field an index makes unique while two entries share an English value, changing nothing", async () => {
      await seed({ e1: { en: "Same", es: "Uno" }, e2: { en: "Same" } });

      loaded.config = configWith({ localized: false, indexedUnique: true });
      await reloadNextlyConfig();

      expect(told()).toMatch(/would share a value for body/);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
    });

    it("makes a field an index makes unique unique once its values are copied", async () => {
      await seed({ e1: { en: "A", es: "Uno" }, e2: { en: "B", es: "Uno" } });

      loaded.config = configWith({ localized: false, indexedUnique: true });
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
