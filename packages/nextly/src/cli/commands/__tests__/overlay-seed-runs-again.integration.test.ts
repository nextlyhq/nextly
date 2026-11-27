/**
 * An overlay seed planned again over a language's saved text.
 *
 * A repeater's overlay column can stand in the database before any migration file names it: made
 * and seeded by `db:sync` (or by a start, or by `nextly migrate` on an upgraded site), while the
 * newest snapshot records no overlay column. The next `migrate:create` then plans the column, and
 * its seed, again. By then an editor has saved the default language's text in its overlay, and the
 * main row holds the structure alone: a seed copying main over the overlay would leave that
 * language no text. The seed fills only an overlay not yet written, so after `nextly migrate`
 * applies the file, the saved text is still there.
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
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runDbSync } from "../db-sync";
import { runMigrateCreate } from "../migrate-create";

perLanguageStorageSuite();

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];
type Row = Record<string, unknown>;

/** The config the commands load, and the project they run in, set before each run. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

// Loaded as given, so each step reads the configuration the test sets.
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

const SLUG = "sag-shows";
const TABLE = "dc_sag_shows";
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

/** The site's collection, its repeater holding a translated caption or no text at all. */
const configWith = (caption: boolean) =>
  defineConfig({
    localization: LOCALIZATION,
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          text({ name: "title" }),
          repeater({
            name: "slides",
            fields: [
              ...(caption ? [text({ name: "caption" })] : []),
              number({ name: "rank" }),
            ],
          }),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

describe.each(getConfiguredTestDialects())(
  "an overlay seed planned again over saved text (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';
    const id = (name: string) => `${q}${name}${q}`;

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 25, 9, 0, clock, 0)));
    }

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      clock = 0;
      tick();
      state.dir = mkdtempSync(join(tmpdir(), "nextly-seed-again-"));
      mkdirSync(join(state.dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "site.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_sag");
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
      setNonInteractive(true);
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

    function command(): { context: CommandContext; said: string[] } {
      const said: string[] = [];
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(message);
      };
      return {
        context: {
          logger: {
            ...base,
            info: capture,
            warn: capture,
            success: capture,
            error: capture,
          },
          options: {},
          cwd: state.dir,
        } as CommandContext,
        said,
      };
    }

    const messageOf = (error: unknown) =>
      NextlyError.is(error)
        ? error.publicMessage
        : String((error as Error).message);

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

    async function migrate(when: string): Promise<void> {
      const { context, said } = command();
      try {
        await runMigrate(
          { cwd: state.dir, throwOnFailure: true, backupConfirmed: true },
          context
        );
      } catch (error) {
        throw new Error(
          `nextly migrate ${when} failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      }
    }

    /** `migrate:create` for the configuration as it stands: whether it wrote a migration. */
    async function capture(name: string): Promise<boolean> {
      tick();
      const { context, said } = command();
      try {
        await runMigrateCreate(name, { cwd: state.dir }, context);
        return true;
      } catch (error) {
        // With nothing to write, the command ends the process with success.
        if (
          /process\.exit unexpectedly called with "0"/.test(messageOf(error))
        ) {
          return false;
        }
        throw new Error(
          `migrate:create failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      }
    }

    const parsed = (value: unknown) =>
      typeof value === "string" ? (JSON.parse(value) as unknown) : value;

    it("keeps the default language's saved text when the seed runs again", async () => {
      // The history: a repeater holding no text yet, so its translations table has no overlay.
      state.config = configWith(false);
      expect(await capture("shows")).toBe(true);
      await migrate("on the first migration");

      // The caption added, and its overlay column made by db:sync, outside any migration file.
      state.config = configWith(true);
      {
        const { context } = command();
        await runDbSync(
          { cwd: state.dir } as Parameters<typeof runDbSync>[0],
          context
        );
      }
      // An editor's save since: the structure on main, English's text in its overlay.
      const now =
        dialect === "sqlite" ? String(Date.now()) : "CURRENT_TIMESTAMP";
      await sql(
        `INSERT INTO ${id(TABLE)} (${id("id")}, ${id("slug")}, ${id("slides")}, ${id("created_at")}, ${id("updated_at")}) VALUES ('e1', 'first', '${JSON.stringify([{ id: "r1", rank: 1 }])}', ${now}, ${now})`
      );
      const saved = { r1: { caption: "Saved" } };
      await sql(
        `INSERT INTO ${id(`${TABLE}_locales`)} (${id("_parent")}, ${id("_locale")}, ${id("title")}, ${id("slides")}) VALUES ('e1', 'en', 'Show', '${JSON.stringify(saved)}')`
      );

      // The next migrate:create plans the overlay column and its seed again, and migrate applies it.
      expect(await capture("captions")).toBe(true);
      await migrate("after the column is planned again");

      const [english] = await sql(
        `SELECT ${id("slides")} AS slides FROM ${id(`${TABLE}_locales`)} WHERE ${id("_parent")} = 'e1' AND ${id("_locale")} = 'en'`
      );
      expect(parsed(english?.slides)).toEqual(saved);
    }, 240_000);
  }
);
