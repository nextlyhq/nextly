// A translated field's column on the translations table follows its config, through the
// provisioning pass `db:sync` runs, on every configured dialect.
//
// The pass only ever added translations columns, so a field whose config raised its length or
// precision kept the narrower column, which cuts or refuses the longer values. It now widens such a
// column to the field's declared type, keeping the rest of the column's definition; leaves one that
// is already wide enough as it is; refuses, altering nothing, a column the field changed in this
// run that it cannot be widened into (another kind); and warns, on every run and failing nothing,
// about such a column the run did not change. A field the run newly translates over a column
// already there takes it only if it can hold the field's values.
//
// SQLite enforces no length or precision, so nothing about a size is asserted there.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineConfig } from "../../../config";
import { readRecordedEntities } from "../../../domains/i18n/migration/recorded-before";
import { declaredSize } from "../../../domains/schema/pipeline/diff/declared-size";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import type { ColumnSpec } from "../../../domains/schema/pipeline/diff/types";
import { getColumnDescriptor } from "../../../domains/schema/services/field-column-descriptor";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { createLogger } from "../../utils/logger";
import {
  ensureLocalizedCompanions,
  syncCollections,
  syncComponents,
  syncSingles,
} from "../dev-build";
import { openSyncTarget, type SyncTarget } from "./helpers/sync-target";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { CommandContext } from "../../program";
import type { LoadConfigResult } from "../../utils/config-loader";

let dir: string;
let target: SyncTarget | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  // Each case has a database of its own, so the desired schema a previous case's push cached does
  // not describe it.
  clearCachedSnapshot();
  dir = mkdtempSync(join(tmpdir(), "nextly-companion-follows-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
});

afterEach(async () => {
  await target?.close();
  target = undefined;
  // Integration files share one fork, so a dialect or URL left set here would be read by every
  // file that follows.
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  rmSync(dir, { recursive: true, force: true });
});

const SLUG = "cfollow";
const MAIN = `dc_${SLUG}`;
const COMPANION = `dc_${SLUG}_locales`;

type Field = Record<string, unknown> & { name: string; type: string };

/** A short text field bounded to `maxLength`, translated. */
const code = (maxLength: number): Field => ({
  name: "code",
  type: "text",
  localized: true,
  options: { variant: "short" },
  validation: { maxLength },
});

/** A translated decimal of the given precision and scale. */
const price = (precision: number, scale: number): Field => ({
  name: "price",
  type: "number",
  localized: true,
  dbType: "decimal",
  precision,
  scale,
});

function configWith(...fields: Field[]): LoadConfigResult["config"] {
  return configOf(true, fields);
}

/** The same collection with its translation turned off. */
function configOffWith(...fields: Field[]): LoadConfigResult["config"] {
  return configOf(false, fields);
}

function configOf(
  localized: boolean,
  fields: Field[]
): LoadConfigResult["config"] {
  return defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized,
        fields: [{ name: "title", type: "text" }, ...fields] as never,
      }),
    ],
  });
}

/**
 * The command's own sequence, minus the parts that read from disk: the registry read before the
 * syncs rewrite it, the pass before the pushes, the syncs, and the pass after them handed what was
 * read. Resolves with what the pass warned about; rejects when it refused.
 */
async function runSync(
  dialect: TestDialect,
  config: LoadConfigResult["config"]
): Promise<string[]> {
  process.env.DB_DIALECT = dialect;
  target ??= await openSyncTarget(dir, dialect);
  const { cli, options } = target;
  const warnings: string[] = [];
  const errors: string[] = [];
  const logger = createLogger({ quiet: true });
  const context = {
    logger: {
      ...logger,
      warn: (message: string) => warnings.push(message),
      error: (message: string) => errors.push(message),
    },
    options: {},
    cwd: dir,
  } as unknown as CommandContext;
  const configResult = { config } as LoadConfigResult;
  const recordedBefore = await readRecordedEntities(
    target.adapter as unknown as DrizzleAdapter,
    config
  );
  // What a pass logged travels with its refusal, so a failing case says why.
  const withLogged = (error: unknown): never => {
    throw new Error(errors.join("\n"), { cause: error });
  };
  await ensureLocalizedCompanions(config, cli, context, "beforeApply", {
    recordedBefore,
  }).catch(withLogged);
  await syncCollections(configResult, cli, options, context);
  await syncSingles(configResult, cli, options, context);
  await syncComponents(configResult, cli, options, context);
  await ensureLocalizedCompanions(config, cli, context, "afterApply", {
    recordedBefore,
  }).catch(withLogged);
  return warnings.filter(w => w.includes(COMPANION));
}

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

async function query<T>(statement: string): Promise<T[]> {
  if (!target) throw new Error("no sync target");
  return target.adapter.executeQuery<T>(statement);
}

async function companionColumn(
  dialect: TestDialect,
  name: string
): Promise<ColumnSpec> {
  if (!target) throw new Error("no sync target");
  const snapshot = await introspectLiveSnapshot(
    target.adapter.getDrizzle(),
    dialect,
    [COMPANION]
  );
  const column = snapshot.tables
    .find(t => t.name === COMPANION)
    ?.columns.find(c => c.name === name);
  if (!column) throw new Error(`${COMPANION} has no column ${name}`);
  return column;
}

/** What `sync` refused with, or undefined when it went through. */
async function refusalOf(sync: Promise<unknown>): Promise<unknown> {
  return sync.then(
    () => undefined,
    (error: unknown) => error
  );
}

/**
 * Gives the main table's copy of `field` the column the field now declares, as the push does once
 * an operator confirms the type change it asks about. A code-first table keeps a translated field's
 * column on the main table too, and a run without a terminal cannot confirm a change of its type;
 * that change is not what these cases are about. SQLite cannot retype a column in place, so there
 * the column is replaced by one of the new type holding the same values.
 */
async function confirmMainColumn(
  dialect: TestDialect,
  field: Field
): Promise<void> {
  const column = getColumnDescriptor(field as never, dialect, "codeFirst");
  if (!column) throw new Error(`${field.name} has no column`);
  const q = (name: string) => quote(dialect, name);
  if (dialect === "sqlite") {
    const was = `${column.name}_was`;
    await query(
      `ALTER TABLE ${q(MAIN)} RENAME COLUMN ${q(column.name)} TO ${q(was)}`
    );
    await query(
      `ALTER TABLE ${q(MAIN)} ADD COLUMN ${q(column.name)} ${column.dialectType}`
    );
    await query(`UPDATE ${q(MAIN)} SET ${q(column.name)} = ${q(was)}`);
    await query(`ALTER TABLE ${q(MAIN)} DROP COLUMN ${q(was)}`);
    return;
  }
  await query(
    dialect === "mysql"
      ? `ALTER TABLE ${q(MAIN)} MODIFY COLUMN ${q(column.name)} ${column.dialectType} NULL`
      : `ALTER TABLE ${q(MAIN)} ALTER COLUMN ${q(column.name)} TYPE ${column.dialectType} USING ${q(column.name)}::text::${column.dialectType}`
  );
}

describe.each(getConfiguredTestDialects())(
  "a translated field's column follows its config (%s)",
  (dialect: TestDialect) => {
    const q = (name: string) => quote(dialect, name);
    const sized = dialect !== "sqlite";

    it("widens a short text column whose maxLength is raised, so a longer value saves", async () => {
      await runSync(dialect, configWith(code(20)));
      if (sized) {
        expect(declaredSize(await companionColumn(dialect, "code"))).toBe("20");
      }

      expect(await runSync(dialect, configWith(code(60)))).toEqual([]);

      if (sized) {
        expect(declaredSize(await companionColumn(dialect, "code"))).toBe("60");
      }
      const longer = "x".repeat(45);
      await query(
        `INSERT INTO ${q(MAIN)} (${q("id")}, ${q("slug")}, ${q("title")}) VALUES ('r1', 'r1', 'T')`
      );
      await query(
        `INSERT INTO ${q(COMPANION)} (${q("_parent")}, ${q("_locale")}, ${q("code")}) VALUES ('r1', 'es', '${longer}')`
      );
      const [row] = await query<{ code: string }>(
        `SELECT ${q("code")} AS code FROM ${q(COMPANION)} WHERE ${q("_parent")} = 'r1'`
      );
      expect(row?.code).toBe(longer);
    });

    it("widens a decimal whose precision is raised", async () => {
      await runSync(dialect, configWith(price(8, 2)));
      await confirmMainColumn(dialect, price(12, 2));

      expect(await runSync(dialect, configWith(price(12, 2)))).toEqual([]);

      if (sized) {
        expect(declaredSize(await companionColumn(dialect, "price"))).toBe(
          "12,2"
        );
      }
    });

    it("leaves a column as it is when the field narrows", async () => {
      await runSync(dialect, configWith(code(60)));
      const before = await companionColumn(dialect, "code");

      expect(await runSync(dialect, configWith(code(20)))).toEqual([]);

      expect(await companionColumn(dialect, "code")).toEqual(before);
    });

    it.skipIf(!sized)(
      "finishes a widening a run left undone, judging the column again",
      async () => {
        await runSync(dialect, configWith(code(20)));
        await runSync(dialect, configWith(code(60)));
        // As a run stopped before this column's statement leaves it: the registry already
        // records 60, and the column is still 20.
        await query(
          dialect === "mysql"
            ? `ALTER TABLE ${q(COMPANION)} MODIFY COLUMN ${q("code")} VARCHAR(20) NULL`
            : `ALTER TABLE ${q(COMPANION)} ALTER COLUMN ${q("code")} TYPE VARCHAR(20)`
        );

        expect(await runSync(dialect, configWith(code(60)))).toEqual([]);

        expect(declaredSize(await companionColumn(dialect, "code"))).toBe("60");
      }
    );

    it("refuses a kind change made in this run, altering nothing, and warns on every later run", async () => {
      await runSync(dialect, configWith(code(20)));
      const before = await companionColumn(dialect, "code");
      const asNumber: Field = { name: "code", type: "number", localized: true };
      await confirmMainColumn(dialect, asNumber);

      const refusal = await refusalOf(runSync(dialect, configWith(asNumber)));

      expect(refusal).toBeInstanceOf(Error);
      expect(String((refusal as Error).message)).toMatch(
        /column "code" \(.+\) cannot hold every value code now allows/
      );
      expect(await companionColumn(dialect, "code")).toEqual(before);

      // The registry now records the number, so later runs did not change the field: they warn,
      // and fail nothing.
      for (let run = 0; run < 2; run++) {
        const warnings = await runSync(dialect, configWith(asNumber));
        expect(warnings).toEqual([
          expect.stringMatching(
            /column "code" \(.+\) cannot hold every value code now allows/
          ),
        ]);
      }
      expect(await companionColumn(dialect, "code")).toEqual(before);
    });

    it("takes the field back once its config is fixed after a refusal", async () => {
      await runSync(dialect, configWith(code(20)));
      const asNumber: Field = { name: "code", type: "number", localized: true };
      await confirmMainColumn(dialect, asNumber);
      const refusal = await refusalOf(runSync(dialect, configWith(asNumber)));
      expect(refusal).toBeInstanceOf(Error);
      expect(String((refusal as Error).message)).toMatch(
        /column "code" \(.+\) cannot hold every value code now allows/
      );
      await confirmMainColumn(dialect, code(20));

      expect(await runSync(dialect, configWith(code(20)))).toEqual([]);
    });

    it("refuses a field the run adds as translated over a column of another kind", async () => {
      await runSync(dialect, configWith());
      await query(
        `ALTER TABLE ${q(COMPANION)} ADD COLUMN ${q("code")} INTEGER`
      );
      const before = await companionColumn(dialect, "code");

      const refusal = await refusalOf(runSync(dialect, configWith(code(20))));

      expect(refusal).toBeInstanceOf(Error);
      expect(String((refusal as Error).message)).toMatch(
        /column "code" \(.+\) that cannot hold every value code allows/
      );
      expect(await companionColumn(dialect, "code")).toEqual(before);
    });

    it("refuses turning translation back on over a column the field outgrew while it was off, copying and syncing nothing", async () => {
      const q = (name: string) => quote(dialect, name);
      await runSync(dialect, configWith(price(10, 2)));
      await query(
        `INSERT INTO ${q(MAIN)} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("price")}) VALUES ('r1', 'r1', 'T', 1.11)`
      );
      await query(
        `INSERT INTO ${q(COMPANION)} (${q("_parent")}, ${q("_locale")}, ${q("price")}) VALUES ('r1', 'en', 7.77), ('r1', 'es', 8.88)`
      );
      // Translation off: the translations table, and its rows, survive it.
      await runSync(dialect, configOffWith(price(10, 2)));
      // While off, the field takes more digits, and an entry uses them.
      await confirmMainColumn(dialect, { ...price(12, 4), localized: false });
      await runSync(dialect, configOffWith(price(12, 4)));
      await query(
        `UPDATE ${q(MAIN)} SET ${q("price")} = 1.2345 WHERE ${q("id")} = 'r1'`
      );
      const priceOf = async (table: string, where: string) => {
        const [row] = await query<{ price: unknown }>(
          `SELECT ${q("price")} AS price FROM ${q(table)} WHERE ${where}`
        );
        return Number(row?.price);
      };
      const english = () =>
        priceOf(COMPANION, `${q("_parent")} = 'r1' AND ${q("_locale")} = 'en'`);
      const recordedLocalized = async () => {
        const [row] = await query<{ localized: unknown }>(
          `SELECT ${q("localized")} AS localized FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}'`
        );
        return Boolean(Number(row?.localized) || row?.localized === true);
      };

      const refusal = await refusalOf(
        runSync(dialect, configWith(price(12, 4)))
      );

      if (!sized) {
        // SQLite rounds nothing, so the copy keeps every digit and the run goes through.
        expect(refusal).toBeUndefined();
        expect(await english()).toBe(1.2345);
        return;
      }
      expect(refusal).toBeInstanceOf(Error);
      expect(String((refusal as Error).message)).toMatch(
        /column "price" \(.+\) that cannot hold every value price allows/
      );
      // Nothing was copied into the translations table, and nothing was synced.
      expect(await english()).toBe(7.77);
      expect(await priceOf(MAIN, `${q("id")} = 'r1'`)).toBe(1.2345);
      expect(await recordedLocalized()).toBe(false);
    });

    it.runIf(dialect === "mysql")(
      "keeps the column's NOT NULL, default and collation when MySQL widens it",
      async () => {
        await runSync(dialect, configWith(code(20)));
        await query(
          `ALTER TABLE ${q(COMPANION)} MODIFY COLUMN ${q("code")} VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'none'`
        );

        expect(await runSync(dialect, configWith(code(60)))).toEqual([]);

        const [column] = await query<{
          type: string;
          nullable: string;
          fallback: string | null;
          collation: string | null;
        }>(
          `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS fallback, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${COMPANION}' AND COLUMN_NAME = 'code'`
        );
        expect(column).toEqual({
          type: "varchar(60)",
          nullable: "NO",
          fallback: "none",
          collation: "utf8mb4_bin",
        });
      }
    );

    it.runIf(dialect === "postgresql")(
      "keeps the column's NOT NULL, default and collation when PostgreSQL widens it",
      async () => {
        await runSync(dialect, configWith(code(20)));
        await query(
          `ALTER TABLE ${q(COMPANION)} ALTER COLUMN ${q("code")} TYPE VARCHAR(20) COLLATE "C"`
        );
        await query(
          `ALTER TABLE ${q(COMPANION)} ALTER COLUMN ${q("code")} SET DEFAULT 'none'`
        );
        await query(
          `UPDATE ${q(COMPANION)} SET ${q("code")} = 'none' WHERE ${q("code")} IS NULL`
        );
        await query(
          `ALTER TABLE ${q(COMPANION)} ALTER COLUMN ${q("code")} SET NOT NULL`
        );

        expect(await runSync(dialect, configWith(code(60)))).toEqual([]);

        const [column] = await query<{
          size: number;
          nullable: string;
          fallback: string | null;
          collation: string | null;
        }>(
          `SELECT character_maximum_length AS size, is_nullable AS nullable, column_default AS fallback, collation_name AS collation FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${COMPANION}' AND column_name = 'code'`
        );
        expect(column).toEqual({
          size: 60,
          nullable: "NO",
          fallback: "'none'::character varying",
          collation: "C",
        });
      }
    );
  }
);
