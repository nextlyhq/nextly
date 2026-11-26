/**
 * A required repeater an earlier release translated whole, its flag removed.
 *
 * An earlier release let a repeater be `localized: true`: no column on the main table, and each
 * language's whole value on its per-language row. Removed, the repeater keeps one structure on the
 * main table, filled by `nextly migrate`'s data step after the migrations. A required one must not
 * hold that up: the main column a container keeping one structure has is nullable (`required` is
 * judged on save, as for a translated field), so `migrate:create` and `nextly migrate` complete,
 * the data step runs, and every language reads its rows. Held up, `nextly migrate` refused the
 * column's nullability as a change not written, or, after a second `migrate:create`, refused
 * making it required while the rows held no structure yet: the data step never ran, and the site
 * showed no content.
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
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../../domains/schema/migrate-create/generate";
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
import { runMigrateCreate } from "../migrate-create";

perLanguageStorageSuite();

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];
type Row = Record<string, unknown>;

/** The config the commands load, and the project they run in, set before each run. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

// Loaded as given: the earlier release's config, whose `localized: true` on a repeater the
// loader of this one refuses, is what the site ran before.
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

const SLUG = "rqc-shows";
const TABLE = "dc_rqc_shows";
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const SLIDE_FIELDS = [
  { name: "caption", type: "text" },
  { name: "rank", type: "number" },
];

/** This release's site: the flag removed, the repeater still required. */
const config = defineConfig({
  localization: LOCALIZATION,
  collections: [
    defineCollection({
      slug: SLUG,
      localized: true,
      fields: [
        text({ name: "title" }),
        repeater({
          name: "slides",
          required: true,
          fields: [text({ name: "caption" }), number({ name: "rank" })],
        }),
      ],
    }),
  ],
  db: { migrationsDir: "./migrations" },
});

/**
 * The earlier release's site: the repeater required, and translated whole. This release's own
 * settings, with the earlier collection in place of this one's, since its loader refuses the flag.
 */
const EARLIER_COLLECTION = {
  slug: SLUG,
  localized: true,
  fields: [
    { name: "title", type: "text" },
    {
      name: "slides",
      type: "repeater",
      required: true,
      localized: true,
      fields: SLIDE_FIELDS,
    },
  ],
};
const earlierConfig = { ...config, collections: [EARLIER_COLLECTION] };

describe.each(getConfiguredTestDialects())(
  "a required repeater an earlier release translated whole (%s)",
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
      state.dir = mkdtempSync(join(tmpdir(), "nextly-required-container-"));
      mkdirSync(join(state.dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "site.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_rqc");
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

    it("completes migrate:create and nextly migrate, and each language reads its rows", async () => {
      // The earlier release: its migration, written as it wrote it (this release refuses the
      // repeater's flag), applied, and one entry stored as it stored it.
      state.config = earlierConfig;
      tick();
      await generateMigration({
        name: "shows",
        dialect,
        migrationsDir: join(state.dir, "migrations"),
        defaultLocale: "en",
        collections: [
          { ...EARLIER_COLLECTION, tableName: TABLE },
        ] as unknown as MinimalConfigEntity[],
        singles: [],
        components: [],
        nonInteractive: true,
      });
      await migrate("on the earlier release");
      const now =
        dialect === "sqlite" ? String(Date.now()) : "CURRENT_TIMESTAMP";
      await sql(
        `INSERT INTO ${id(TABLE)} (${id("id")}, ${id("slug")}, ${id("created_at")}, ${id("updated_at")}) VALUES ('e1', 'first', ${now}, ${now})`
      );
      const whole = (caption: string) =>
        JSON.stringify([{ id: "r1", caption, rank: 1 }]);
      for (const [locale, caption] of [
        ["en", "First"],
        ["es", "Primero"],
      ] as const) {
        await sql(
          `INSERT INTO ${id(`${TABLE}_locales`)} (${id("_parent")}, ${id("_locale")}, ${id("title")}, ${id("slides")}) VALUES ('e1', '${locale}', 'Show', '${whole(caption)}')`
        );
      }

      // This release: the flag removed. Each command completes, a second run included.
      state.config = config;
      expect(await capture("one_structure")).toBe(true);
      await migrate("after the flag is removed");
      // Nothing is left to write: no later file makes the column required before its rows hold
      // their structure.
      expect(await capture("settled")).toBe(false);
      await migrate("after a second migrate:create");

      const [main] = await sql(
        `SELECT ${id("slides")} AS slides FROM ${id(TABLE)} WHERE ${id("id")} = 'e1'`
      );
      expect(parsed(main?.slides)).toEqual([{ id: "r1", rank: 1 }]);
      const overlays = Object.fromEntries(
        (
          await sql(
            `SELECT ${id("_locale")} AS locale, ${id("slides")} AS slides FROM ${id(`${TABLE}_locales`)} WHERE ${id("_parent")} = 'e1'`
          )
        ).map(row => [row.locale, parsed(row.slides)])
      );
      expect(overlays).toEqual({
        en: { r1: { caption: "First" } },
        es: { r1: { caption: "Primero" } },
      });
    }, 240_000);
  }
);
