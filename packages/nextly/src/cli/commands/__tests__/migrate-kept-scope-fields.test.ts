/**
 * `migrate:create` and `migrate:check` keep the column of a plugin's field on
 * a type the site switched off after the column was made, and never make it
 * for a type switched off before.
 *
 * A plugin adds a field to every content type; the site's `except` switches
 * one off. The type stops declaring the field, so without the keep the next
 * migration would drop the column and its values, and the check would report
 * that drop as pending. Driven through the commands over a project directory,
 * with the configuration folded as `loadConfig` folds it, on each dialect's
 * statements. Neither command connects to a database here.
 */
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../../config";
import type { NextlyServiceConfig } from "../../../di/register";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { publishWithheldScopeFields } from "../../../domains/schema/pipeline/withheld-scope-fields";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { applyPluginSchemaContributionsDeferred } from "../../../plugins/schema/apply-contributions";
import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({ result: undefined as unknown }));
// `../program` imports every command, `migrate` with its whole graph among
// them; the commands under test need only its context factory.
vi.mock("../../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => loaded.result,
}));

const posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title" })],
});
const pages = defineCollection({
  slug: "pages",
  fields: [text({ name: "title" })],
});
const settings = defineSingle({
  slug: "site_info",
  fields: [text({ name: "name" })],
});

/** Adds `seo_title` to every collection and Single, except the slugs named. */
function seoPlugin(except?: string[], required = false): PluginDefinition {
  return {
    name: "@t/seo",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      extend: [
        {
          target: {
            every: ["collection", "single"],
            ...(except === undefined ? {} : { except }),
          },
          fields: [text({ name: "seo_title", required })],
        },
      ],
    },
  };
}

/** The project with the plugin, folded as `loadConfig` folds it. */
function project(except?: string[], required = false): unknown {
  const plugins = [seoPlugin(except, required)];
  const base = defineConfig({
    collections: [posts, pages],
    singles: [settings],
    plugins,
    db: { migrationsDir: "./migrations" },
  });
  const folded = applyPluginSchemaContributionsDeferred(
    base as unknown as NextlyServiceConfig,
    plugins
  );
  return {
    config: {
      ...base,
      collections: folded.config.collections,
      singles: folded.config.singles,
    },
    deferredExtends: folded.deferredExtends,
    dependencies: [],
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-kept-scope-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetEnvCache();
  publishWithheldScopeFields(new Map());
  rmSync(dir, { recursive: true, force: true });
});

/** Run a command over `config`; its exit code, if any, and what it said. */
async function run(
  config: unknown,
  command: (context: CommandContext) => Promise<void>
): Promise<{ code: number | undefined; said: string }> {
  loaded.result = config;
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...createLogger({ quiet: true }),
      error: capture,
      info: capture,
      success: capture,
      warn: capture,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await command(context);
    return { code: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), said: said.join("\n") };
    throw error;
  } finally {
    exit.mockRestore();
    printed.mockRestore();
  }
}

const create = (config: unknown) =>
  run(config, context => {
    // As `--non-interactive` does: nothing is asked about.
    setNonInteractive(true);
    return runMigrateCreate("create", { cwd: dir }, context).finally(() =>
      setNonInteractive(false)
    );
  });
const check = (config: unknown) =>
  run(config, context => runMigrateCheck({ cwd: dir }, context));

/** Every migration statement written so far, in one string. */
function written(): string {
  const migrations = join(dir, "migrations");
  return readdirSync(migrations)
    .filter(name => name.endsWith(".sql"))
    .map(name => readFileSync(join(migrations, name), "utf-8"))
    .join("\n");
}

/**
 * The statements a migration's UP section runs, without its comment lines:
 * DOWN puts back what the migration changes, the field's record included.
 */
function statements(sql: string): string {
  return sql
    .split("-- DOWN")[0]
    .split("\n")
    .filter(line => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "a type switched off for a plugin's field (%s)",
  dialect => {
    beforeEach(() => {
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv(
        "DATABASE_URL",
        dialect === "sqlite"
          ? `file:${join(dir, "unused.db")}`
          : `${dialect === "mysql" ? "mysql" : "postgres"}://u:p@localhost:1/unused`
      );
      _resetEnvCache();
    });

    it("keeps the column once it is made, with nothing pending, and when switched on again", async () => {
      expect((await create(project())).code).toBeUndefined();
      expect(written()).toMatch(/dc_pages[\s\S]*seo_title/);
      const before = written();

      // Switched off after the column was made: the migration records that
      // the types no longer declare the field, and touches no table.
      expect((await create(project(["pages", "site_info"]))).code).toBe(
        undefined
      );
      expect(written()).toContain("pages: fields.seo_title (removed)");
      expect(statements(written().slice(before.length))).not.toMatch(
        /seo_title/
      );
      expect((await check(project(["pages", "site_info"]))).code).toBe(
        undefined
      );

      // Switched on again: the column is there, so again no table changes.
      const off = written();
      expect((await create(project())).code).toBeUndefined();
      expect(statements(written().slice(off.length))).not.toMatch(/seo_title/);
      expect((await check(project())).code).toBeUndefined();
    });

    it("keeps a Builder type's column once it is made, with nothing pending", async () => {
      writeFileSync(
        join(dir, "ui-schema.json"),
        JSON.stringify(
          uiSchemaManifest.parse({
            collections: [
              { slug: "cases", fields: [{ name: "summary", type: "text" }] },
            ],
          })
        )
      );
      expect((await create(project())).code).toBeUndefined();
      expect(written()).toMatch(/dc_cases[\s\S]*seo_title/);
      const before = written();

      expect((await create(project(["cases"]))).code).toBeUndefined();
      expect(statements(written().slice(before.length))).not.toMatch(
        /seo_title/
      );
      expect((await check(project(["cases"]))).code).toBeUndefined();
    });

    it("lets a kept column of a required field take no value while its type is off, and drops nothing", async () => {
      expect((await create(project(undefined, true))).code).toBeUndefined();
      const before = written();

      expect((await create(project(["pages"], true))).code).toBeUndefined();
      const relaxed = statements(written().slice(before.length));
      expect(relaxed).toMatch(/dc_pages/);
      expect(relaxed).toMatch(/seo_title/);
      expect(relaxed).not.toMatch(/DROP COLUMN/i);
      expect((await check(project(["pages"], true))).code).toBeUndefined();
    });

    it("never makes the column for a type switched off before its first migration", async () => {
      expect((await create(project(["pages"]))).code).toBeUndefined();
      const sql = written();
      expect(sql).toMatch(/dc_posts[\s\S]*seo_title/);
      // The statement that makes `dc_pages` names no such column.
      const pagesTable = sql
        .split(";")
        .find(statement => /CREATE TABLE[^(]*dc_pages/.test(statement));
      expect(pagesTable).toBeDefined();
      expect(pagesTable).not.toContain("seo_title");
    });
  }
);
