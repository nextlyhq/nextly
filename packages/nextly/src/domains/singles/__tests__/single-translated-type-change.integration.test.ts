/**
 * A translated Single's field type change, whose values are in each language's row of its translations
 * table: that column takes the new type with the save, on the road that applies it. In development
 * the save's own file gives it (`type-change-conversion`); in production, and wherever the save carries
 * values across its change, the Single's own statements do, by the database's cast, each language's
 * value judged first. Proved on SQLite, PostgreSQL and MySQL.
 *
 * What separates the right answer from plausible wrong ones:
 * - one that changes the Single's own table alone leaves every language's value, and each written
 *   after, in the old type;
 * - one that gives the column its type after the main table has changed leaves the two apart where
 *   it fails, with the registry recording the change;
 * - one that judges the default language alone casts another language's value to what it is not.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  type DataLossConsent,
  resolveDataLossConsent,
} from "../../schema/migrate/data-loss-consent";

import { SingleMetadataService } from "../services/single-metadata-service";
import { rewritesValuesOn } from "../../schema/value-conversion/type-change/field-type-changes";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

// The layout every installation runs: a translated field's values are in its translations table alone.
perLanguageStorageSuite();

const SLUG = "stc_hero";
const TABLE = `single_${SLUG}`;
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LANGUAGES = {
  localization: { locales: ["en", "es"], defaultLocale: "en" },
};

type Field = { name: string; type: string } & Record<string, unknown>;
const text: Field = { name: "v", type: "text", localized: true };
const number: Field = { name: "v", type: "number", localized: true };
const shared = (type: string): Field => ({
  name: "n",
  type,
  localized: false,
});

let instance: TestNextly | undefined;
let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "nextly-single-retype-"));
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(project, { recursive: true, force: true });
  }
});

describe.each(getConfiguredTestDialects())(
  "a translated Single's field type change gives its translations column the new type (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function exec<R>(t: TestNextly, statement: string): Promise<R[]> {
      return (
        t.adapter as unknown as { executeQuery<T>(s: string): Promise<T[]> }
      ).executeQuery<R>(statement);
    }

    /**
     * A database whose Single has `fields` and these values, saved from then on in production unless
     * `options` says where.
     */
    async function boot(
      fields: Field[],
      values: Record<string, Record<string, unknown>>,
      options: { writer?: boolean; saves?: "development" } = {}
    ): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      instance = await createTestNextly({
        dialect,
        ...LANGUAGES,
        ...(options.writer === false ? {} : { basePath: project, db: DB }),
      } as never);
      await dispatchSingles(
        "createSingle",
        {},
        { slug: SLUG, label: "Hero", localized: true, fields }
      );
      await write(instance, values);
      vi.stubEnv("NODE_ENV", options.saves ?? "production");
      return instance;
    }

    async function write(
      t: TestNextly,
      values: Record<string, Record<string, unknown>>
    ): Promise<void> {
      for (const [locale, data] of Object.entries(values)) {
        await t.nextly.updateSingle({
          slug: SLUG,
          data: { ...data, _overwrite: true },
          locale,
        } as never);
      }
    }

    /** The service's save of `fields`, answering its refusal where it has one. */
    async function save(fields: Field[]): Promise<unknown> {
      return dispatchSingles(
        "updateSingleSchema",
        { slug: SLUG },
        { fields }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
    }

    /** `v` in each language, read through the Direct API. */
    async function read(t: TestNextly): Promise<Record<string, unknown>> {
      const found: Record<string, unknown> = {};
      for (const locale of ["en", "es"]) {
        const held = (await t.nextly.findSingle({
          slug: SLUG,
          locale,
        } as never)) as { v?: unknown; item?: { v?: unknown } } | undefined;
        found[locale] = held?.item?.v ?? held?.v ?? null;
      }
      return found;
    }

    /** `v`'s column type in the translations table, as the database names it. */
    async function columnType(t: TestNextly): Promise<string> {
      const [row] = await exec<{ type: string }>(
        t,
        dialect === "sqlite"
          ? `SELECT type FROM pragma_table_info('${TABLE}_locales') WHERE name = 'v'`
          : `SELECT data_type AS type FROM information_schema.columns WHERE table_name = '${TABLE}_locales' AND column_name = 'v'${dialect === "mysql" ? " AND table_schema = DATABASE()" : ""}`
      );
      return String(row?.type).toLowerCase();
    }

    const isNumber = expect.stringMatching(/^(int|integer|bigint)/);
    const isText = expect.stringMatching(/text|char/);

    // MySQL commits each schema statement, so its push retypes no translations column (below).
    const pushes = it.skipIf(dialect === "mysql");

    pushes.each([true, false])(
      "converts each language's value where the push applies the change (files written: %s)",
      async writer => {
        const t = await boot(
          [text],
          { en: { v: "12" }, es: { v: "34" } },
          { writer }
        );
        expect(await columnType(t)).toEqual(isText);

        expect(await save([number])).toBeUndefined();

        expect(await columnType(t)).toEqual(isNumber);
        expect(await read(t)).toEqual({ en: 12, es: 34 });
        // A value written after is one of the new type.
        await write(t, { es: { v: 56 } });
        expect(await read(t)).toEqual({ en: 12, es: 56 });
      }
    );

    // A save stopped between the two tables' statements would leave the translations apart from the
    // Single's own table, with nothing to put them back: refused as it was, every value as it was.
    it.runIf(dialect === "mysql")(
      "refuses a change its push would apply where each statement commits on its own, and changes nothing",
      async () => {
        const t = await boot([text], { en: { v: "12" }, es: { v: "34" } });
        const files = await written();

        expect(JSON.stringify(await save([number]))).toMatch(
          /kept per language/
        );

        expect(await columnType(t)).toEqual(isText);
        expect(await read(t)).toEqual({ en: "12", es: "34" });
        expect(await written()).toEqual(files);
      }
    );

    // In development the save's own file gives the column its type, whatever the database: by the
    // conversion where the road rewrites values, by its `retypes` statements where none does (MySQL).
    it("converts each language's value where the save's file applies the change", async () => {
      const t = await boot(
        [text],
        { en: { v: "12" }, es: { v: "34" } },
        { saves: "development" }
      );
      const before = (await written()).length;

      expect(await save([number])).toBeUndefined();

      expect(await columnType(t)).toEqual(isNumber);
      expect(await read(t)).toEqual({ en: 12, es: 34 });
      expect(
        (await written()).slice(before).some(file => file.includes("retypes"))
      ).toBe(true);
    });

    // Where the file is what applies the save, only a column it retypes is lifted: one planned from a
    // snapshot that keeps no record of the translations columns carries no such step, whatever the
    // registry says. Refused as the collection's is, every value as it was.
    it("refuses a change whose file would leave the column behind, and changes nothing", async () => {
      const t = await boot(
        [text],
        { en: { v: "12" }, es: { v: "34" } },
        { saves: "development" }
      );
      const meta = join(project, "migrations", "meta");
      const newest = (await readdir(meta))
        .filter(file => file.endsWith(".snapshot.json"))
        .sort()
        .at(-1);
      const path = join(meta, newest ?? "");
      const file = JSON.parse(await readFile(path, "utf8")) as {
        snapshot: { tables: { name: string; localizedColumns?: string[] }[] };
      };
      const table = file.snapshot.tables.find(each => each.name === TABLE);
      // The fixture's control: the snapshot records the translations columns.
      expect(table?.localizedColumns).toContain("v");
      delete table?.localizedColumns;
      await writeFile(path, JSON.stringify(file, null, 2));

      const refused = await save([number]);

      if (rewritesValuesOn(dialect)) {
        expect(refused).toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });
      } else {
        expect(JSON.stringify(refused)).toMatch(/kept per language/);
      }
      expect(await columnType(t)).toEqual(isText);
      expect(await read(t)).toEqual({ en: "12", es: "34" });
    });

    it.each([
      ["no number", "abc", /parent .* locale es/],
      ["a number only once rewritten", "034", /parent .* locale es/],
    ])(
      "refuses a value in one language alone that the cast does not read as the new type (%s), naming its row, and changes nothing",
      async (_, es, names) => {
        const t = await boot([text], { en: { v: "12" }, es: { v: es } });
        const files = await written();

        expect(JSON.stringify(await save([number]))).toMatch(names);

        expect(await columnType(t)).toEqual(isText);
        expect(await read(t)).toEqual({ en: "12", es });
        expect(await written()).toEqual(files);
      }
    );

    // A shared field changing type in the same save: the Single's own table and its translations table
    // change together, and on SQLite the main table's rebuild judges both again in its transaction.
    pushes("converts a translated and a shared field in one save", async () => {
      const t = await boot([text, shared("text")], {
        en: { v: "12", n: "7" },
        es: { v: "34" },
      });

      expect(await save([number, shared("number")])).toBeUndefined();

      expect(await read(t)).toEqual({ en: 12, es: 34 });
      const [main] = await exec<{ n: unknown }>(t, `SELECT n FROM ${q(TABLE)}`);
      expect(Number(main?.n)).toBe(7);
    });

    // Both tables change in one transaction. Where the main table's change is refused, the translations
    // column is as it was, every value in its own writing: cast there and back, "5" would come back as
    // "5.0" from SQLite's float column and " 12" without its space.
    pushes(
      "leaves every value in its own writing where the main table's change is refused",
      async () => {
        const t = await boot([text, shared("text")], {
          en: { v: "5", n: "7" },
          es: { v: "34" },
        });
        await exec(
          t,
          `UPDATE ${q(`${TABLE}_locales`)} SET ${q("v")} = ' 12' WHERE ${q("_locale")} = 'es'`
        );
        await exec(t, `CREATE VIEW stc_view AS SELECT n FROM ${q(TABLE)}`);
        const float = { ...number, options: { format: "float" } };

        const refused = await save([float, shared("number")]);

        // The main table's refusal, not the judgement's: every value is one the cast reads.
        expect(refused).toBeInstanceOf(Error);
        expect(JSON.stringify(refused)).not.toContain("TYPE_CHANGE_");
        expect(await columnType(t)).toEqual(isText);
        expect(await read(t)).toEqual({ en: "5", es: " 12" });
        await exec(t, `DROP VIEW stc_view`);
        // The control: with nothing in the way, the same save goes through.
        expect(await save([float, shared("number")])).toBeUndefined();
        expect(await read(t)).toEqual({ en: 5, es: 12 });
      }
    );

    // A process that ended once the tables had changed, before the registry was written: the same save
    // again finds them changed and finishes.
    // A value written between the save's judgement and its statements is judged in their transaction:
    // SQLite's cast would write it as 0, and say nothing.
    pushes(
      "judges a value written after the save was planned, and changes nothing over one the cast does not read",
      async () => {
        const t = await boot([text], { en: { v: "12" }, es: { v: "34" } });
        const service = SingleMetadataService.prototype as unknown as {
          applyMainMigrationOrUndo: (...args: unknown[]) => Promise<void>;
        };
        const apply = service.applyMainMigrationOrUndo;
        vi.spyOn(service, "applyMainMigrationOrUndo").mockImplementation(
          async function (this: unknown, ...args) {
            await exec(
              t,
              `UPDATE ${q(`${TABLE}_locales`)} SET ${q("v")} = 'abc' WHERE ${q("_locale")} = 'es'`
            );
            return apply.apply(this, args);
          }
        );

        expect(JSON.stringify(await save([number]))).toMatch(
          /parent .* locale es/
        );

        expect(await columnType(t)).toEqual(isText);
        expect(await read(t)).toEqual({ en: "12", es: "abc" });
      }
    );

    pushes.each([true, false])(
      "finishes a save that stopped before the registry was written (files written: %s)",
      async writer => {
        const t = await boot(
          [text],
          { en: { v: "12" }, es: { v: "34" } },
          { writer }
        );
        const [before] = await exec<{ fields: unknown; h: unknown }>(
          t,
          `SELECT fields, schema_hash AS h FROM dynamic_singles WHERE slug = '${SLUG}'`
        );
        expect(await save([number])).toBeUndefined();
        const fields =
          typeof before?.fields === "string"
            ? before.fields
            : JSON.stringify(before?.fields);
        await exec(
          t,
          `UPDATE dynamic_singles SET fields = '${fields}', schema_hash = '${String(before?.h)}' WHERE slug = '${SLUG}'`
        );

        expect(await save([number])).toBeUndefined();

        expect(await columnType(t)).toEqual(isNumber);
        expect(await read(t)).toEqual({ en: 12, es: 34 });
      }
    );

    // A field unique within each language keeps its index, made again on the new column.
    pushes("keeps a field unique within each language", async () => {
      const unique = (field: Field) => ({ ...field, unique: true });
      const t = await boot([unique(text)], {
        en: { v: "12" },
        es: { v: "34" },
      });

      expect(await save([unique(number)])).toBeUndefined();

      expect(await read(t)).toEqual({ en: 12, es: 34 });
      const [held] = await exec<{ parent: string }>(
        t,
        `SELECT ${q("_parent")} AS parent FROM ${q(`${TABLE}_locales`)} WHERE ${q("_locale")} = 'en'`
      );
      await exec(
        t,
        `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('other', 'o', 'o')`
      );
      const another = exec(
        t,
        `INSERT INTO ${q(`${TABLE}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("v")}) VALUES ('other', 'en', 12)`
      );
      await expect(another).rejects.toThrow();
      expect(held?.parent).toBeDefined();
    });

    // Unique is turned on or off in the same save: the index the other step makes or drops is on the
    // column of the new type, never in the way of the change.
    pushes.each([
      ["turned on", {}, { unique: true }],
      ["turned off", { unique: true }, {}],
    ])("converts a field whose Unique is %s", async (_, from, next) => {
      const t = await boot([{ ...text, ...from }], {
        en: { v: "12" },
        es: { v: "34" },
      });

      expect(await save([{ ...number, ...next }])).toBeUndefined();

      expect(await columnType(t)).toEqual(isNumber);
      expect(await read(t)).toEqual({ en: 12, es: 34 });
    });

    async function written(): Promise<string[]> {
      return (await readdir(join(project, "migrations")))
        .filter(file => file.endsWith(".sql"))
        .sort();
    }

    async function migrate(
      t: TestNextly,
      step?: number,
      consent: DataLossConsent = resolveDataLossConsent({
        flag: true,
        env: {},
      })
    ): Promise<void> {
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await migrateCore({
        ...(step === undefined ? {} : { step }),
        extensionSchema: undefined,
        dialect: adapter.getCapabilities().dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir: join(project, "migrations"),
        logger: createLogger({ quiet: true }),
        lockMode: "fail-fast",
        consent,
        interactive: false,
        throwOnFailure: true,
      } as never);
    }

    // The save writes its files in production too, for the databases its push does not reach. On MySQL
    // it is the development save's file that applied it here.
    it("leaves its files for nextly migrate, which finds them done here and converts another database's values", async () => {
      const t = await boot(
        [text],
        { en: { v: "12" }, es: { v: "34" } },
        dialect === "mysql" ? { saves: "development" } : {}
      );
      const before = (await written()).length;
      expect(await save([number])).toBeUndefined();
      expect((await written()).length).toBeGreaterThan(before);

      await migrate(t);
      expect(await columnType(t)).toEqual(isNumber);
      expect(await read(t)).toEqual({ en: 12, es: 34 });
      await instance?.destroy();
      instance = undefined;

      vi.stubEnv("NODE_ENV", "development");
      instance = await createTestNextly({
        dialect,
        ...LANGUAGES,
        basePath: project,
        db: DB,
      } as never);
      const second = instance;
      await migrate(second, before);
      await write(second, { en: { v: "5" }, es: { v: "abc" } });
      await expect(migrate(second)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(await read(second)).toEqual({ en: "5", es: "abc" });

      await write(second, { es: { v: "6" } });
      await migrate(second);
      expect(await read(second)).toEqual({ en: 5, es: 6 });
      expect(await columnType(second)).toEqual(isNumber);
    });
  }
);
