// A config reload under `next dev` judges a code-first field's type change by the values its
// column holds, as `db:sync` does, instead of skipping every one for review: a change the database
// converts is applied, one that would clear a value needs the data-loss consent naming its column,
// and one with no conversion Nextly runs is held for a person to confirm at a terminal. Driving
// `reloadNextlyConfig` itself on SQLite, PostgreSQL and MySQL.
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../config";
import { getService } from "../../di/service-access";
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

const SLUG = "rljtc";
const TABLE = `dc_${SLUG}`;
/** A second collection, changed in the same reload. */
const OTHER = "rljtc_other";

/**
 * The collection as code declares it, `v` given as `field`, with `beside` after it; and `other`,
 * where given, as a second collection's fields.
 */
const configWith = (
  field: Record<string, unknown>,
  options: {
    localized?: boolean;
    beside?: Record<string, unknown>[];
    other?: Record<string, unknown>[];
  } = {}
) =>
  defineConfig({
    ...(options.localized === true
      ? { localization: { locales: ["en", "es"], defaultLocale: "en" } }
      : {}),
    collections: [
      defineCollection({
        slug: SLUG,
        ...(options.localized === true ? { localized: true } : {}),
        fields: [{ name: "v", ...field }, ...(options.beside ?? [])] as never,
      }),
      ...(options.other === undefined
        ? []
        : [defineCollection({ slug: OTHER, fields: options.other as never })]),
    ],
  });

describe.each(getConfiguredTestDialects())(
  "a config reload judges a code-first type change (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await handle?.destroy();
      handle = undefined;
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /**
     * The collection made by a reload from `from`, holding `values` by entry id: on its own table,
     * or, translated, in the English row of its translations table.
     */
    async function withValues(
      from: Record<string, unknown>,
      values: Record<string, string>,
      options: Parameters<typeof configWith>[1] = {}
    ): Promise<TestNextly> {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // The reload runs its schema work only under next dev.
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = configWith(from, options);
      await reloadNextlyConfig();
      for (const [id, v] of Object.entries(values)) {
        if (options.localized === true) {
          await handle.adapter.executeQuery(
            `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('${id}', '${id}', '${id}')`
          );
          await handle.adapter.executeQuery(
            `INSERT INTO ${q(`${TABLE}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("v")}) VALUES ('${id}', 'en', '${v}')`
          );
        } else {
          await handle.adapter.executeQuery(
            `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("v")}) VALUES ('${id}', '${id}', '${id}', '${v}')`
          );
        }
      }
      return handle;
    }

    /** The reload of `to`, and everything it said. */
    async function reloadTo(
      to: Record<string, unknown>,
      options: Parameters<typeof configWith>[1] = {},
      /** The reload's prompt dispatcher, where the case stands one in for the terminal's. */
      dispatcher?: unknown
    ): Promise<{ said: string; threw: unknown }> {
      const lines: string[] = [];
      const note = (line: unknown) => {
        lines.push(String(line));
      };
      const logger = {
        warn: note,
        error: note,
        info: () => {},
        debug: () => {},
      };
      vi.spyOn(console, "warn").mockImplementation(note);
      vi.spyOn(console, "error").mockImplementation(note);
      loaded.config = configWith(to, options);
      let threw: unknown;
      const outcome = await reloadNextlyConfig({
        ...(dispatcher === undefined
          ? {}
          : { dispatcher: dispatcher as never }),
        resolver: name =>
          name === "logger"
            ? logger
            : getService(name as Parameters<typeof getService>[0]),
      }).catch((e: unknown) => {
        threw = e;
        return undefined;
      });
      lines.push(`OUTCOME ${JSON.stringify(outcome ?? null).slice(0, 300)}`);
      return { said: lines.join(" | "), threw };
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = (await handle!.adapter.executeQuery(
        dialect === "sqlite"
          ? `SELECT name AS name FROM pragma_table_info('${table}')`
          : dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      )) as { name: string }[];
      return rows.map(row => row.name);
    }

    async function tableExists(table: string): Promise<boolean> {
      return (await columnsOf(table)).length > 0;
    }

    async function stored(): Promise<Record<string, unknown>> {
      const rows = (await handle!.adapter.executeQuery(
        `SELECT ${q("id")} AS id, ${q("v")} AS v FROM ${q(TABLE)} ORDER BY ${q("id")}`
      )) as Array<{ id: string; v: unknown }>;
      return Object.fromEntries(rows.map(r => [r.id, r.v]));
    }

    // SQLite converts a text column into a number by its rebuild; PostgreSQL and MySQL have no
    // conversion Nextly runs for the pair, so it is confirmed by a person at a terminal
    // (`db:sync`): a reload, where nobody is asked, holds the collection back and says so.
    const converts = dialect === "sqlite";

    /** What a reload that holds the change for a person says: the column and where to answer. */
    const heldForConfirmation = (said: string) => {
      expect(said).toMatch(new RegExp(`'${SLUG}' was not applied`));
      expect(said).toMatch(
        new RegExp(
          `${TABLE}\\.v: .* no conversion for, so it is confirmed at a terminal: run nextly db:sync`
        )
      );
    };

    it("applies a text holding whole numbers becoming a number, where the database converts it", async () => {
      await withValues({ type: "text" }, { a: "12", b: "7" });

      const { said, threw } = await reloadTo({ type: "number" });

      expect(threw).toBeUndefined();
      if (converts) {
        expect(await stored()).toEqual({ a: 12, b: 7 });
      } else {
        heldForConfirmation(said);
        expect(await stored()).toEqual({ a: "12", b: "7" });
      }
      expect(said).not.toMatch(/needs review/);
    });

    it("refuses a change that would clear a value without the consent naming its column, and changes nothing", async () => {
      await withValues({ type: "text" }, { a: "12", b: "abc" });

      const { said } = await reloadTo({ type: "number" });

      if (converts) {
        expect(said).toMatch(
          new RegExp(`NEXTLY_ACCEPT_DATA_LOSS=${TABLE}\\.v`)
        );
        expect(said).toMatch(/1 row: id b/);
      } else {
        heldForConfirmation(said);
      }
      expect(await stored()).toEqual({ a: "12", b: "abc" });
    });

    it("refuses the same change under a consent that names another column", async () => {
      await withValues({ type: "text" }, { a: "12", b: "abc" });
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.other`);

      const { said } = await reloadTo({ type: "number" });

      if (converts) {
        expect(said).toMatch(
          new RegExp(`NEXTLY_ACCEPT_DATA_LOSS=${TABLE}\\.v`)
        );
      } else {
        heldForConfirmation(said);
      }
      expect(await stored()).toEqual({ a: "12", b: "abc" });
    });

    it("clears only the value that cannot convert under the consent naming its column", async () => {
      await withValues({ type: "text" }, { a: "12", b: "abc" });
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.v`);

      const { said } = await reloadTo({ type: "number" });

      if (converts) {
        expect(await stored()).toEqual({ a: 12, b: null });
      } else {
        heldForConfirmation(said);
        expect(await stored()).toEqual({ a: "12", b: "abc" });
      }
    });

    // A translated field's values are in the translations table, which the reload keeps in step
    // only where its column already holds what the field allows: a type change is refused there,
    // and its values stay as they were, on every database.
    it("refuses a translated field's type change, keeping its values", async () => {
      await withValues(
        { type: "text", localized: true },
        { a: "12" },
        { localized: true }
      );

      const { said } = await reloadTo(
        { type: "number", localized: true },
        { localized: true }
      );

      expect(said).toMatch(
        /a translated field's values are not converted from one type to another/
      );
      const companion = (await handle!.adapter.executeQuery(
        `SELECT ${q("v")} AS v FROM ${q(`${TABLE}_locales`)}`
      )) as Array<{ v: unknown }>;
      expect(companion).toEqual([{ v: "12" }]);
    });

    // A collection held back is held back alone: the reload applies every other entity's change,
    // and gives the held one's apply nothing to change.
    it("applies another collection's change in the same reload while it holds one back", async () => {
      await withValues(
        { type: "text" },
        { a: "12", b: "abc" },
        { other: [{ name: "w", type: "text" }] }
      );

      const { said } = await reloadTo(
        { type: "number" },
        {
          other: [
            { name: "w", type: "text" },
            { name: "x", type: "text" },
          ],
        }
      );

      expect(said).toMatch(new RegExp(`'${SLUG}' was not applied`));
      expect(await columnsOf(`dc_${OTHER}`)).toContain("x");
      expect(await stored()).toEqual({ a: "12", b: "abc" });
    });

    // A collection held back keeps its translations table's work back with it: a field it starts
    // translating gets no translations table while the change beside it waits.
    it("creates no translations table for a collection whose type change it holds back", async () => {
      await withValues(
        { type: "text" },
        { a: "12", b: "abc" },
        { beside: [{ name: "w", type: "text" }] }
      );

      const { said } = await reloadTo(
        { type: "number", localized: false },
        {
          localized: true,
          beside: [{ name: "w", type: "text", localized: true }],
        }
      );

      expect(said).toMatch(new RegExp(`'${SLUG}' was not applied`));
      expect(await tableExists(`${TABLE}_locales`)).toBe(false);
      expect(await stored()).toEqual({ a: "12", b: "abc" });
    });

    // A reload runs inside the development server: a value is cleared only under the consent
    // naming its column, never on a question, even where a terminal could ask one.
    it("asks no question about a type change, even of a dispatcher that would answer it", async () => {
      await withValues({ type: "text" }, { a: "12", b: "abc" });
      const asked: unknown[] = [];
      const answering = {
        dispatch: (question: unknown) => {
          asked.push(question);
          return Promise.resolve({
            confirmedRenames: [],
            resolutions: [],
            proceed: true,
          });
        },
      };

      await reloadTo({ type: "number" }, {}, answering);

      expect(asked).toEqual([]);
      expect(await stored()).toEqual({ a: "12", b: "abc" });
    });
  }
);
