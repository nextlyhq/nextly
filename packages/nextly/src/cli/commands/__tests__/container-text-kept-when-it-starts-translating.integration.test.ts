/**
 * A repeater that held its text on the main table, shared by every language, starts keeping its
 * text per language (its `localized: false` taken off): `migrate:create` adds its overlay column
 * on the translations table, and copies the text the main table holds into the default
 * language's overlay, so that language keeps it.
 *
 * Broken, the column is added empty: reads still find the text on the structure, until the first
 * save in any language splits the structure and keeps only that language's text, and the default
 * language's text is gone.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineConfig,
  number,
  repeater,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { NextlyError } from "../../../errors";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { parsedValue } from "../../../shared/lib/json-column-value";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

// `nextly migrate` as every installation runs it: per-language storage (`storage-layout`).
perLanguageStorageSuite();

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];
type Row = Record<string, unknown>;

/** The config the commands load, and the project they run in, set before each run. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = state.config as LoadedConfig;
      return {
        config: original.mergeSetupResultIntoConfig(
          config,
          config,
          config.plugins ?? []
        ),
        appConfig: config,
        pluginConsent: undefined,
        projectRoot: state.dir,
        dependencies: [],
      };
    },
  };
});

const TABLE = "dc_kept_cards";

/** The site's collection, its repeater's text shared by every language, or each language's. */
function configWith(textShared: boolean) {
  return defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "kept-cards",
        fields: [
          text({ name: "title" }),
          repeater({
            name: "slides",
            ...(textShared ? { localized: false } : {}),
            fields: [text({ name: "caption" }), number({ name: "rank" })],
          }),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });
}

describe.each(getConfiguredTestDialects())(
  "a repeater's text kept for the default language when it starts being translated (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';
    const id = (name: string) => `${q}${name}${q}`;

    /** Each migration file is named by the clock, so each gets a second of its own. */
    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 24, 9, 0, clock, 0)));
    }

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      clock = 0;
      tick();
      state.dir = mkdtempSync(join(tmpdir(), "nextly-kept-text-"));
      mkdirSync(join(state.dir, "migrations"));
      state.config = configWith(true);
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "site.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_kept");
        url = scratch.url;
        drop = () => scratch.drop();
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
    }, 60_000);

    afterEach(async () => {
      setNonInteractive(false);
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(state.dir, { recursive: true, force: true });
    });

    function command(): CommandContext {
      const base = createLogger({ quiet: true });
      const ignore = () => {};
      return {
        logger: {
          ...base,
          info: ignore,
          warn: ignore,
          success: ignore,
          error: ignore,
        },
        options: {},
        cwd: state.dir,
      } as CommandContext;
    }

    function messageOf(error: unknown): string {
      return NextlyError.is(error)
        ? error.publicMessage
        : String((error as Error).message);
    }

    async function sql(statement: string): Promise<Row[]> {
      const adapter = (await createAdapter({
        type: dialect,
        url,
      } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
      try {
        return await adapter.executeQuery<Row>(statement);
      } finally {
        await adapter.disconnect();
      }
    }

    async function capture(name: string): Promise<void> {
      tick();
      try {
        await runMigrateCreate(name, { cwd: state.dir }, command());
      } catch (error) {
        throw new Error(`migrate:create failed: ${messageOf(error)}`);
      }
    }

    const migrate = () =>
      runMigrate(
        { cwd: state.dir, throwOnFailure: true, backupConfirmed: true },
        command()
      );

    it("copies the text a repeater held on the main table into the default language's overlay", async () => {
      setNonInteractive(true);
      await capture("cards");
      await migrate();
      const now =
        dialect === "sqlite" ? String(Date.now()) : "CURRENT_TIMESTAMP";
      const slides = JSON.stringify([
        { id: "r1", caption: "first", rank: 1 },
        { id: "r2", caption: "second", rank: 2 },
      ]);
      // An entry stored while the repeater's text was shared: all of it on the main table, and
      // no row of its own on the translations table.
      await sql(
        `INSERT INTO ${id(TABLE)} (${id("id")}, ${id("slug")}, ${id("slides")}, ${id("created_at")}, ${id("updated_at")}) VALUES ('card-1', 'first', '${slides}', ${now}, ${now})`
      );

      state.config = configWith(false);
      await capture("slides_translated");
      await migrate();

      const [row] = await sql(
        `SELECT ${id("slides")} AS ${id("slides")} FROM ${id(`${TABLE}_locales`)} WHERE ${id("_parent")} = 'card-1' AND ${id("_locale")} = 'en'`
      );
      // The default language has its row, and its overlay holds the text the main table held.
      expect(row).toBeDefined();
      const overlay = parsedValue(row?.slides);
      expect(JSON.stringify(overlay)).toContain('"first"');
      expect(JSON.stringify(overlay)).toContain('"second"');
      // Spanish has no row of its own: nothing was invented for it.
      const es = await sql(
        `SELECT ${id("_locale")} FROM ${id(`${TABLE}_locales`)} WHERE ${id("_parent")} = 'card-1' AND ${id("_locale")} = 'es'`
      );
      expect(es).toHaveLength(0);
    }, 240_000);
  }
);
