/**
 * A development push refuses removing a field that a removed plugin's index stands on, and says how
 * to free it: put the plugin back in the configuration, uninstall it with `nextly plugins
 * uninstall`, take it out of the configuration again, and apply the change. This follows those
 * steps as the sentence gives them, on every configured dialect, and the change then applies.
 *
 * The plugin's index is on a collection the app declares in code, which the app's migrations carry
 * whoever adds to it: no module of the plugin drops it. So the uninstall leaves it in place and
 * forgets that it was the plugin's, and the change takes it with the field's column, asking for the
 * data-loss consent as for any column it removes.
 *
 * The same steps on a database `nextly migrate` set up, the change written by `nextly
 * migrate:create` and applied by `nextly migrate`: the index was recorded by the migration that made
 * it, and the change is refused until the plugin is uninstalled.
 *
 * The push, the commands and the restarts are the real ones, on one database: SQLite's file, or a
 * scratch database of the server's. Only the configuration the commands read is the test's.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { runMigrate } from "../../../cli/commands/migrate";
import { runMigrateCreate } from "../../../cli/commands/migrate-create";
import { runPluginUninstall } from "../../../cli/commands/plugin-lifecycle-runner";
import type { CommandContext } from "../../../cli/program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../../cli/utils/config-loader";
import { createLogger } from "../../../cli/utils/logger";
import { defineCollection, defineConfig, number, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices } from "../../../di/register";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { setNonInteractive } from "../migrate/can-prompt";
import { resolveDataLossConsent } from "../migrate/data-loss-consent";
import { SchemaOwnersRepository } from "../ownership/schema-owners-repository";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import { applyDesiredSchema } from "../pipeline/index";

/**
 * What the commands read: the configuration and the folder they run in. They open the database by
 * DATABASE_URL, as the CLI does (`databaseFor`).
 */
const run = vi.hoisted(() => ({
  config: undefined as unknown,
  dir: "",
}));

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

vi.mock("../../../cli/utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../../cli/utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = run.config as LoadedConfig;
      return {
        config: original.mergeSetupResultIntoConfig(
          config,
          config,
          config.plugins ?? []
        ),
        appConfig: config,
        pluginConsent: undefined,
        projectRoot: run.dir,
        dependencies: [],
      };
    },
  };
});

const SLUG = "rpf_posts";
const TABLE = `dc_${SLUG}`;
const PLUGIN = "@test/rpf-indexer";
const INDEX = "idx_rpf_code";

/** The plugin: an index on the collection's own `code` column. */
const indexer = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          schema.extendTable(TABLE, {
            indexes: [{ columns: ["code"], name: INDEX }],
          });
        },
      ],
    },
  },
});

const fields = (withCode: boolean) => [
  text({ name: "title" }),
  ...(withCode ? [number({ name: "code" })] : []),
];
const posts = () => defineCollection({ slug: SLUG, fields: fields(true) });

const context = {
  logger: createLogger({ quiet: true }),
} as unknown as CommandContext;

let dir: string;
let handle: TestNextly | undefined;
let drop: (() => Promise<void>) | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-rpf-"));
  mkdirSync(join(dir, "migrations"));
  run.dir = dir;
});

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  await drop?.();
  drop = undefined;
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** The database every boot of a case reaches: a SQLite file, or a scratch database. */
async function databaseFor(dialect: TestDialect) {
  let url = `file:${join(dir, "app.db")}`;
  if (dialect !== "sqlite") {
    const scratch = await createScratchDatabase(dialect, "rpf");
    drop = scratch.drop;
    url = scratch.url;
  }
  // The address a command opens a database of its own by, as `migrate:create` does to judge what
  // its change removes.
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return createAdapter({ type: dialect, url });
}

describeEachDialect(
  "a removed plugin's index, freed as the push says",
  dialect => {
    /** A start on the case's database with `plugins` configured; the earlier start's services go. */
    async function boot(adapter: unknown, plugins: unknown[]) {
      clearServices();
      handle = await createTestNextly({
        adapter: adapter as never,
        plugins: plugins as never,
        collections: [posts()],
      });
    }

    /** The push of the collection with `code` or without it. */
    const push = (withCode: boolean) =>
      applyDesiredSchema(
        {
          collections: {
            [SLUG]: { slug: SLUG, tableName: TABLE, fields: fields(withCode) },
          },
          singles: {},
          components: {},
        },
        "code",
        { promptChannel: "terminal" }
      );

    async function shapeOf(adapter: TestNextly["adapter"]) {
      const table = (
        await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [TABLE])
      ).tables.find(each => each.name === TABLE);
      return {
        columns: (table?.columns ?? []).map(column => column.name),
        indexes: (table?.indexes ?? []).map(index => index.name),
        rows: (
          await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).read([
            TABLE,
          ])
        ).map(row => `${row.ownerId}:${row.elementKind}:${row.elementName}`),
      };
    }

    it("applies the change once the plugin is put back, uninstalled and taken out again", async () => {
      const adapter = (await databaseFor(dialect)) as TestNextly["adapter"];
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.code`);

      // Started with the plugin: the push makes the index and records it as the plugin's.
      await boot(adapter, [indexer]);
      const made = await shapeOf(adapter);
      expect(made.indexes).toContain(INDEX);
      expect(made.rows).toEqual([`${PLUGIN}:index:${INDEX}`]);

      // Started without it, the change is refused, and the refusal says how to free the index.
      await boot(adapter, []);
      const refused = await push(false);
      expect(refused.success).toBe(false);
      const said = refused.success ? "" : refused.error.message;
      expect(said).toContain(
        `Add "${PLUGIN}" back to the configuration, uninstall it with \`nextly plugins uninstall ${PLUGIN}\`, then remove it from the configuration and apply the change again.`
      );
      expect(await shapeOf(adapter)).toEqual(made);

      // 1. Back in the configuration. 2. Uninstalled.
      await boot(adapter, [indexer]);
      run.config = {
        db: { migrationsDir: "./migrations" },
        plugins: [indexer],
        collections: [posts()],
      };
      await runPluginUninstall(
        PLUGIN,
        {
          keepData: false,
          yes: false,
          consent: resolveDataLossConsent({ flag: true, env: {} }),
        },
        context
      );
      // The app's migrations carry the index, so no module of the plugin drops it.
      const uninstalled = await shapeOf(adapter);
      expect(uninstalled.indexes).toContain(INDEX);
      expect(uninstalled.rows).toEqual([]);

      // 3. Out of the configuration. 4. The change again.
      await boot(adapter, []);
      const applied = await push(false);

      expect(applied.success, JSON.stringify(applied)).toBe(true);
      const after = await shapeOf(adapter);
      expect(after.columns).toContain("title");
      expect(after.columns).not.toContain("code");
      expect(after.indexes).not.toContain(INDEX);
    }, 120_000);

    /** The app's configuration, with the plugin or not, and with `code` or not. */
    const configured = (withPlugin: boolean, withCode: boolean) =>
      defineConfig({
        ...(withPlugin ? { plugins: [indexer] } : {}),
        collections: [
          defineCollection({ slug: SLUG, fields: fields(withCode) }),
        ],
        db: { migrationsDir: "./migrations" },
      });

    /** A command run as the CLI runs it: its exit code, where it ended with one, and what it said. */
    async function command(
      config: unknown,
      work: (c: CommandContext) => Promise<void>
    ) {
      run.config = config;
      const said: string[] = [];
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(message);
      };
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      const stderr = vi
        .spyOn(console, "error")
        .mockImplementation((...parts: unknown[]) => {
          said.push(parts.map(String).join(" "));
        });
      setNonInteractive(true);
      try {
        await work({
          logger: {
            ...base,
            info: capture,
            warn: capture,
            success: capture,
            error: capture,
          },
          options: {},
          cwd: dir,
        } as unknown as CommandContext);
        return { code: undefined as number | undefined, said: said.join("\n") };
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return { code: Number(match[1]), said: said.join("\n") };
        throw error;
      } finally {
        setNonInteractive(false);
        exit.mockRestore();
        stderr.mockRestore();
      }
    }
    const migrateCreate = (name: string, config: unknown) =>
      command(config, c =>
        runMigrateCreate(name, { cwd: dir, acceptDataLoss: true }, c)
      );
    const migrate = (config: unknown) =>
      command(config, c => runMigrate({ cwd: dir, acceptDataLoss: true }, c));
    const files = () =>
      readdirSync(join(dir, "migrations")).filter(name =>
        name.endsWith(".sql")
      );

    it("applies the change through migrate:create and nextly migrate once the plugin is put back, uninstalled and taken out again", async () => {
      const adapter = (await databaseFor(dialect)) as TestNextly["adapter"];
      try {
        // Set up by migrations: the index is made by the app's migration, and recorded as the plugin's.
        expect(
          (await migrateCreate("add_posts", configured(true, true))).code
        ).toBe(undefined);
        expect((await migrate(configured(true, true))).code).toBe(undefined);
        const made = await shapeOf(adapter);
        expect(made.indexes).toContain(INDEX);
        expect(made.rows).toEqual([`${PLUGIN}:index:${INDEX}`]);

        // Without the plugin, the change is refused before anything is written, naming it.
        const written = files();
        const refused = await migrateCreate(
          "remove_code",
          configured(false, false)
        );
        expect(refused.code, refused.said).not.toBe(undefined);
        expect(refused.said).toContain(PLUGIN);
        expect(refused.said).toContain(INDEX);
        expect(files()).toEqual(written);

        // 1. Back in the configuration. 2. Uninstalled, naming what it leaves.
        const uninstalled = await command(configured(true, true), c =>
          runPluginUninstall(
            PLUGIN,
            {
              keepData: false,
              yes: false,
              consent: resolveDataLossConsent({ flag: true, env: {} }),
            },
            c
          )
        );
        expect(uninstalled.code, uninstalled.said).toBe(undefined);
        const left = await shapeOf(adapter);
        expect(left.indexes).toContain(INDEX);
        expect(left.rows).toEqual([]);

        // 3. Out of the configuration. 4. The change, written and run.
        const created = await migrateCreate(
          "remove_code",
          configured(false, false)
        );
        expect(created.code, created.said).toBe(undefined);
        const migrated = await migrate(configured(false, false));
        expect(migrated.code, migrated.said).toBe(undefined);

        const after = await shapeOf(adapter);
        expect(after.columns).toContain("title");
        expect(after.columns).not.toContain("code");
        expect(after.indexes).not.toContain(INDEX);
      } finally {
        await adapter.disconnect();
      }
    }, 120_000);
  }
);
