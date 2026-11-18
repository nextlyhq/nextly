// A translated date field keeps its instant on a PostgreSQL server whose time zone is not UTC,
// through the development sync and `nextly migrate`.
//
// The main table keeps a date as `timestamp`, holding the UTC wall clock Nextly writes. A
// translations table that kept it as `timestamp with time zone` stored each moved or written value
// read in the session's zone, so its instant was off by the zone's offset for every reader but
// Nextly, and for Nextly too once the zone changed. A translations table's date column is now plain
// `timestamp` as well, and one made the old way is converted, each value read back in the zone it
// was written in, by the development sync and by `nextly migrate`; an unattended production start
// leaves it, and says that `nextly migrate` converts it.
//
// Each case runs with every connection starting in a zone far from UTC on each side, and values
// either side of midnight there and in UTC.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../config";
import { readRecordedEntities } from "../../../domains/i18n/migration/recorded-before";
import { warnIfCoreSchemaIsBehind } from "../../../init/first-run";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import { createLogger } from "../../utils/logger";
import {
  ensureLocalizedCompanions,
  syncCollections,
  syncComponents,
  syncSingles,
} from "../dev-build";
import {
  runConvertZonedDates,
  type ConvertZonedDatesDeps,
} from "../i18n-convert-zoned-dates";
import { zonedDatesToConvert } from "../upgrade-steps/zoned-dates";
import { openSyncTarget, type SyncTarget } from "./helpers/sync-target";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { CommandContext } from "../../program";
import type { LoadConfigResult } from "../../utils/config-loader";

const SLUG = "tdki";
const MAIN = `dc_${SLUG}`;
const COMPANION = `${MAIN}_locales`;
/** Two instants, as the UTC wall clocks Nextly writes into a `timestamp` column. */
const VALUES = { r1: "2026-01-15 23:30:00", r2: "2026-01-16 00:30:00" };

const FIELDS = [
  { name: "title", type: "text" },
  { name: "published", type: "date", localized: true },
];

function configOf(localized: boolean): LoadConfigResult["config"] {
  return defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({ slug: SLUG, localized, fields: FIELDS as never }),
    ],
  });
}

let dir: string;
let target: SyncTarget | undefined;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  clearCachedSnapshot();
  dir = mkdtempSync(join(tmpdir(), "nextly-date-instant-"));
  saved = {
    DB_DIALECT: process.env.DB_DIALECT,
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_POSTGRES_URL: process.env.TEST_POSTGRES_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
});

afterEach(async () => {
  await target?.close();
  target = undefined;
  vi.unstubAllEnvs();
  // Integration files share one fork, so what a case set here would be read by every file after it.
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** Opens a database of its own whose every connection starts in `zone`. */
async function openIn(zone: string): Promise<SyncTarget> {
  const url = new URL(saved.TEST_POSTGRES_URL ?? "");
  url.searchParams.set("options", `-c timezone=${zone}`);
  process.env.TEST_POSTGRES_URL = url.toString();
  process.env.DB_DIALECT = "postgresql";
  target = await openSyncTarget(dir, "postgresql");
  const [row] = await query<{ TimeZone: string }>("SHOW timezone");
  expect(row?.TimeZone).toBe(zone);
  return target;
}

async function query<T>(statement: string): Promise<T[]> {
  if (!target) throw new Error("no sync target");
  return target.adapter.executeQuery<T>(statement);
}

/** What one pass logged about the translations table. */
interface Logged {
  warnings: string[];
  notices: string[];
}

function contextLogging(logged: Logged): CommandContext {
  const logger = createLogger({ quiet: true });
  const about = (into: string[]) => (message: string) => {
    if (message.includes(COMPANION)) into.push(message);
  };
  return {
    logger: {
      ...logger,
      warn: about(logged.warnings),
      info: about(logged.notices),
      success: about(logged.notices),
    },
    cwd: dir,
  } as unknown as CommandContext;
}

/** The development sync's own sequence, as `db:sync` runs it. */
async function runSync(config: LoadConfigResult["config"]): Promise<Logged> {
  if (!target) throw new Error("no sync target");
  const { cli, options } = target;
  const logged: Logged = { warnings: [], notices: [] };
  const context = contextLogging(logged);
  const configResult = { config } as LoadConfigResult;
  const recordedBefore = await readRecordedEntities(
    target.adapter as unknown as DrizzleAdapter,
    config
  );
  await ensureLocalizedCompanions(config, cli, context, "beforeApply", {
    recordedBefore,
  });
  await syncCollections(configResult, cli, options, context);
  await syncSingles(configResult, cli, options, context);
  await syncComponents(configResult, cli, options, context);
  await ensureLocalizedCompanions(config, cli, context, "afterApply", {
    recordedBefore,
  });
  return logged;
}

/** The translations pass `nextly migrate` runs once its files are applied, in production. */
async function runMigratePass(
  config: LoadConfigResult["config"]
): Promise<Logged> {
  if (!target) throw new Error("no sync target");
  vi.stubEnv("NODE_ENV", "production");
  const logged: Logged = { warnings: [], notices: [] };
  await ensureLocalizedCompanions(
    config,
    target.cli,
    contextLogging(logged),
    "afterApply",
    {
      supervised: true,
      recordedBefore: await readRecordedEntities(
        target.adapter as unknown as DrizzleAdapter,
        config
      ),
    }
  );
  return logged;
}

/**
 * `nextly i18n:convert-zoned-dates` as the command runs it, the backup
 * confirmed (`runConvertZonedDates`): how many columns it found to convert
 * beforehand, how many it converted, and what it said.
 */
async function runUpgradeStep(): Promise<{
  pending: number;
  converted: number;
  logged: string[];
}> {
  if (!target) throw new Error("no sync target");
  const logged: string[] = [];
  const log = (message: string) => {
    logged.push(message);
  };
  const adapter = target.adapter as unknown as ConvertZonedDatesDeps["adapter"];
  const pending = await zonedDatesToConvert({
    adapter,
    db: target.adapter.getDrizzle(),
    dialect: "postgresql",
    log,
    warn: log,
  });
  const converted = await runConvertZonedDates({
    adapter,
    backupConfirmed: true,
    interactive: false,
    log,
    warn: log,
  });
  return { pending, converted, logged };
}

/** `published` in `table`: its type, and each row's value as the database spells it. */
async function published(
  table: string,
  key: "id" | "_parent"
): Promise<{ type: string | undefined; values: Record<string, string> }> {
  const [column] = await query<{ type: string }>(
    `SELECT data_type AS type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = 'published'`
  );
  const rows = await query<{ k: string; v: string }>(
    `SELECT "${key}" AS k, published::text AS v FROM "${table}"` +
      (key === "_parent" ? ` WHERE _locale = 'en'` : "")
  );
  return {
    type: column?.type,
    values: Object.fromEntries(rows.map(r => [r.k, r.v])),
  };
}

/** The main rows, holding the UTC wall clock as Nextly writes it. */
async function insertMainRows(): Promise<void> {
  for (const [id, value] of Object.entries(VALUES)) {
    await query(
      `INSERT INTO "${MAIN}" (id, slug, title, published) VALUES ('${id}', '${id}', 'T', '${value}')`
    );
  }
}

/**
 * A translations table as an earlier release left it: its date column `timestamp with time zone`,
 * each value Nextly wrote there read in the session's zone. Made independently of the code under
 * test, so it is the same before and after the change.
 */
async function madeTheOldWay(): Promise<void> {
  await query(`ALTER TABLE "${COMPANION}" DROP COLUMN published`);
  await query(
    `ALTER TABLE "${COMPANION}" ADD COLUMN published timestamp with time zone`
  );
  for (const [id, value] of Object.entries(VALUES)) {
    await query(
      `UPDATE "${COMPANION}" SET published = '${value}' WHERE _parent = '${id}' AND _locale = 'en'`
    );
  }
  const old = await published(COMPANION, "_parent");
  expect(old.type).toBe("timestamp with time zone");
}

const PG = Boolean(process.env.TEST_POSTGRES_URL);

describe.runIf(PG).each(["Asia/Karachi", "America/Los_Angeles"])(
  "a translated date keeps its instant on PostgreSQL in %s",
  zone => {
    it("through the development sync turning translation on and off", async () => {
      await openIn(zone);
      await runSync(configOf(false));
      await insertMainRows();

      await runSync(configOf(true));

      expect(await published(COMPANION, "_parent")).toEqual({
        type: "timestamp without time zone",
        values: VALUES,
      });

      await runSync(configOf(false));

      expect((await published(MAIN, "id")).values).toEqual(VALUES);
    });

    // `nextly migrate` runs while instances of the earlier release may still write: it converts
    // nothing, and names the column and `nextly i18n:convert-zoned-dates`.
    it("leaves it through nextly migrate, naming nextly i18n:convert-zoned-dates", async () => {
      await openIn(zone);
      await runSync(configOf(false));
      await insertMainRows();
      await runSync(configOf(true));
      await madeTheOldWay();

      const logged = await runMigratePass(configOf(true));

      expect((await published(COMPANION, "_parent")).type).toBe(
        "timestamp with time zone"
      );
      expect(logged.warnings.join("\n")).toMatch(
        new RegExp(`${COMPANION}\\.published.*nextly i18n:convert-zoned-dates`)
      );
    });

    it("converts it through nextly i18n:convert-zoned-dates, which then plans nothing", async () => {
      await openIn(zone);
      await runSync(configOf(false));
      await insertMainRows();
      await runSync(configOf(true));
      await madeTheOldWay();

      const first = await runUpgradeStep();

      expect(first).toMatchObject({ pending: 1, converted: 1 });
      expect(first.logged.join("\n")).toMatch(
        new RegExp(`${COMPANION}\\.published.*${zone}`)
      );
      expect(await published(COMPANION, "_parent")).toEqual({
        type: "timestamp without time zone",
        values: VALUES,
      });

      expect(await runUpgradeStep()).toEqual({
        pending: 0,
        converted: 0,
        logged: [
          "No translated date column is kept with a time zone. Nothing to do.",
        ],
      });
    });

    // Under per-language storage an entity keeps its translatable values in its translations table
    // whatever its own `localized` says, and `nextly i18n:convert-zoned-dates` reads no config to know it: the table
    // being there is what it goes by.
    it("converts it through nextly i18n:convert-zoned-dates for an entity not marked translated", async () => {
      await openIn(zone);
      await runSync(configOf(false));
      await insertMainRows();
      await runSync(configOf(true));
      await madeTheOldWay();
      await query(
        `UPDATE dynamic_collections SET localized = false WHERE slug = '${SLUG}'`
      );

      expect(await runUpgradeStep()).toMatchObject({
        pending: 1,
        converted: 1,
      });
      expect((await published(COMPANION, "_parent")).type).toBe(
        "timestamp without time zone"
      );
    });

    it("converts a date column made with a time zone through the development sync", async () => {
      await openIn(zone);
      await runSync(configOf(false));
      await insertMainRows();
      await runSync(configOf(true));
      await madeTheOldWay();

      const logged = await runSync(configOf(true));

      expect(await published(COMPANION, "_parent")).toEqual({
        type: "timestamp without time zone",
        values: VALUES,
      });
      expect(logged.notices.join("\n")).toMatch(
        new RegExp(`${COMPANION}\\.published.*${zone}`)
      );
    });

    // An earlier release left two kinds of value in such a column: one moved there by turning
    // translation on, stored read in the session's zone, and one written there while translated,
    // stored at the instant written. Nextly showed each as the column renders in the session's
    // zone, which for the second was shifted by the zone's offset. The conversion keeps, for both,
    // the date Nextly showed.
    it("keeps the date Nextly showed for a moved value and a written one", async () => {
      await openIn(zone);
      await runSync(configOf(false));
      await insertMainRows();
      await runSync(configOf(true));
      await madeTheOldWay();
      // r2's value as the earlier release wrote it while translated: an instant, bound with its zone.
      await query(
        `UPDATE "${COMPANION}" SET published = '2026-01-16T00:30:00.000Z' WHERE _parent = 'r2' AND _locale = 'en'`
      );
      const shown = Object.fromEntries(
        (
          await query<{ k: string; v: string }>(
            `SELECT _parent AS k, to_char(published, 'YYYY-MM-DD HH24:MI:SS') AS v FROM "${COMPANION}" WHERE _locale = 'en'`
          )
        ).map(r => [r.k, r.v])
      );
      // The moved value shows as written; the written one as its instant in the zone.
      expect(shown.r1).toBe(VALUES.r1);
      expect(shown.r2).not.toBe(VALUES.r2);

      await runUpgradeStep();

      expect(await published(COMPANION, "_parent")).toEqual({
        type: "timestamp without time zone",
        values: shown,
      });
    });

    // Through the start's own check, the one a production server runs as it boots.
    it("leaves it on an unattended production start, saying once that nextly i18n:convert-zoned-dates converts it", async () => {
      await openIn(zone);
      await runSync(configOf(false));
      await insertMainRows();
      await runSync(configOf(true));
      await madeTheOldWay();
      vi.stubEnv("NODE_ENV", "production");
      const warnings: string[] = [];
      const logger = {
        info: () => undefined,
        warn: (message: string) => warnings.push(message),
        error: (message: string) => warnings.push(message),
      };

      for (let start = 0; start < 2; start++) {
        await warnIfCoreSchemaIsBehind(
          target!.adapter as unknown as Parameters<
            typeof warnIfCoreSchemaIsBehind
          >[0],
          logger
        );
      }

      expect((await published(COMPANION, "_parent")).type).toBe(
        "timestamp with time zone"
      );
      expect(
        warnings.filter(
          w =>
            w.includes(`${COMPANION}.published`) &&
            w.includes("nextly i18n:convert-zoned-dates")
        )
      ).toHaveLength(1);
    });

    // A development sync that refuses a translations column converts no date: the conversion
    // follows only a translations pass that refused nothing.
    it("converts nothing when the development sync's translations pass refuses", async () => {
      await openIn(zone);
      await runSync(configOf(false));
      await insertMainRows();
      await runSync(configOf(true));
      await madeTheOldWay();
      // A column of another kind, left in the translations table, under a field the run newly
      // translates as text.
      await query(`ALTER TABLE "${COMPANION}" ADD COLUMN code integer`);
      const withCode = defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: SLUG,
            localized: true,
            fields: [
              ...FIELDS,
              { name: "code", type: "text", localized: true },
            ] as never,
          }),
        ],
      });

      const refused = await runSync(withCode).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(String(refused)).toMatch(/could not be brought into step/);
      expect((await published(COMPANION, "_parent")).type).toBe(
        "timestamp with time zone"
      );
    });
  }
);
