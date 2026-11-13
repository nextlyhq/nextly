/**
 * A plugin's field on a Schema Builder entity reaches the database through
 * `nextly migrate:create` and `nextly migrate`, on every configured dialect:
 * its column, and the field in the entity's registry row.
 *
 * A production start no longer adds it (it serves each Builder entity as the
 * database holds it), so this is the step that does, as for any field. The
 * migration `migrate:create` writes folds each plugin's extends into the
 * Builder entities of the manifest before it compares, so the field lands in
 * the table's change and in the registry metadata the migration records; a
 * deferred extend whose target the manifest lacks is refused by the command.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`)
 * against a project directory and a database of the test's own; only the
 * config file is not read from disk: the loader is handed what each step
 * declares, with the extends it defers, as the real loader leaves them.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { definePlugin } from "../../../plugins/plugin-context";
import { applyPluginSchemaContributionsDeferred } from "../../../plugins/schema/apply-contributions";
import { shutdownServices } from "../../../di/register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

// As the config loader leaves it: the plugins folded in, and each extend whose
// target is a Builder entity deferred beside the config.
vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = loaded.config as Parameters<
        typeof original.mergeSetupResultIntoConfig
      >[0];
      const plugins = config.plugins ?? [];
      return {
        config: original.mergeSetupResultIntoConfig(config, config, plugins),
        deferredExtends: applyPluginSchemaContributionsDeferred(
          config as never,
          plugins
        ).deferredExtends,
        dependencies: [],
      };
    },
  };
});

/** A plugin adding `mcpf_meta` to the Builder collection `mcpf_articles`. */
const extendingPlugin = definePlugin({
  name: "@test/mcpf-extend",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    extend: [
      { target: "mcpf_articles", fields: [text({ name: "mcpf_meta" })] },
    ],
  },
});

/** The site's config, with or without the plugin. */
function siteConfig(withPlugin: boolean): unknown {
  return defineConfig({
    collections: [],
    plugins: withPlugin ? [extendingPlugin] : [],
    db: { migrationsDir: "./migrations" },
  });
}

describe.each(getConfiguredTestDialects())(
  "a plugin's field on a Schema Builder entity reaches the database through nextly migrate (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-mcpf-"));
      mkdirSync(join(dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(dir, "site.db")}`;
        drop = async () => undefined;
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_mcpf");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
      // Each migration file is named by the clock.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, 0, 0)));
    }, 120_000);

    afterEach(async () => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(dir, { recursive: true, force: true });
    });

    /** A command's context, with everything it says captured. */
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
          cwd: dir,
        } as CommandContext,
        said,
      };
    }

    /** Run `fn`, turning `process.exit` into the code it was called with. */
    async function exiting(
      fn: () => Promise<void>
    ): Promise<number | undefined> {
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        await fn();
        return undefined;
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return Number(match[1]);
        throw error;
      } finally {
        exit.mockRestore();
      }
    }

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, clock, 0)));
    }

    /** `nextly migrate:create --name=<name>`, which must write one migration. */
    async function migrateCreate(config: unknown, name: string): Promise<void> {
      loaded.config = config;
      tick();
      const before = readdirSync(join(dir, "migrations")).length;
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
      expect(readdirSync(join(dir, "migrations")).length).toBeGreaterThan(
        before
      );
    }

    /** `nextly migrate`, which must succeed. */
    async function migrate(config: unknown): Promise<void> {
      loaded.config = config;
      tick();
      const { context, said } = command();
      await runMigrate({ cwd: dir, throwOnFailure: true }, context).catch(
        (error: unknown) => {
          throw new Error(`${(error as Error).message}\n${said.join("\n")}`, {
            cause: error,
          });
        }
      );
    }

    /** The Builder collection's columns, and the fields its registry row records. */
    async function articles(): Promise<{
      columns: string[];
      fields: string[];
    }> {
      const adapter = (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
      try {
        const columns =
          dialect === "sqlite"
            ? (
                await adapter.executeQuery<{ name: string }>(
                  "PRAGMA table_info(dc_mcpf_articles)"
                )
              ).map(row => row.name)
            : (
                await adapter.executeQuery<{ column_name: string }>(
                  dialect === "postgresql"
                    ? "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dc_mcpf_articles'"
                    : "SELECT COLUMN_NAME AS column_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dc_mcpf_articles'"
                )
              ).map(row => row.column_name);
        const [row] = await adapter.executeQuery<{ fields: unknown }>(
          "SELECT fields FROM dynamic_collections WHERE slug = 'mcpf_articles'"
        );
        const list =
          typeof row.fields === "string"
            ? (JSON.parse(row.fields) as { name: string }[])
            : (row.fields as { name: string }[]);
        return { columns, fields: list.map(field => field.name) };
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }

    it("adds the field's column and registry entry", async () => {
      // A site that has started once, so its core tables are there.
      const setup = (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
      await createTestNextly({ adapter: setup as never });
      await shutdownServices();
      await setup.disconnect().catch(() => undefined);

      // A collection made in the Schema Builder, migrated and deployed.
      await writeFile(
        join(dir, "ui-schema.json"),
        `${JSON.stringify(
          uiSchemaManifest.parse({
            collections: [
              {
                slug: "mcpf_articles",
                fields: [{ name: "body", type: "text" }],
              },
            ],
          }),
          null,
          2
        )}\n`
      );
      await migrateCreate(siteConfig(false), "create_articles");
      await migrate(siteConfig(false));
      const before = await articles();
      expect(before.columns).toContain("body");
      expect(before.columns).not.toContain("mcpf_meta");
      expect(before.fields).not.toContain("mcpf_meta");

      // The plugin is added: its migration is written, and the deploy runs it.
      await migrateCreate(siteConfig(true), "add_plugin");
      await migrate(siteConfig(true));

      const after = await articles();
      expect(after.columns).toContain("mcpf_meta");
      expect(after.fields).toEqual([...before.fields, "mcpf_meta"]);
    }, 240_000);
  }
);
