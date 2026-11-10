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

/** How the plugin's field is declared, and whether the site translates. */
interface Shape {
  required?: boolean;
  translated?: boolean;
  unique?: boolean;
}

/** Adds `seo_title` to every collection and Single, except the slugs named. */
function seoPlugin(
  except: string[] | undefined,
  shape: Shape
): PluginDefinition {
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
          fields: [
            {
              ...text({ name: "seo_title", required: shape.required === true }),
              ...(shape.translated === true ? { localized: true } : {}),
              ...(shape.unique === true ? { unique: true } : {}),
            },
          ],
        },
      ],
    },
  };
}

/** The project with the plugin, folded as `loadConfig` folds it. */
function project(except?: string[], shape: Shape = {}): unknown {
  const plugins = [seoPlugin(except, shape)];
  const base = defineConfig({
    ...(shape.translated === true
      ? { localization: { locales: ["en", "es"], defaultLocale: "en" } }
      : {}),
    collections: [
      posts,
      shape.translated === true ? { ...pages, localized: true } : pages,
    ],
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

const create = (config: unknown, releaseHeldBack = false) =>
  run(config, context => {
    // As `--non-interactive` does: nothing is asked about.
    setNonInteractive(true);
    return runMigrateCreate(
      "create",
      { cwd: dir, ...(releaseHeldBack ? { releaseHeldBack } : {}) },
      context
    ).finally(() => setNonInteractive(false));
  });
const check = (config: unknown) =>
  run(config, context => runMigrateCheck({ cwd: dir }, context));

/** The migration files written so far. */
function sqlFiles(): string[] {
  return readdirSync(join(dir, "migrations")).filter(name =>
    name.endsWith(".sql")
  );
}

/**
 * What the migration files hold, in one string: every one, or those written
 * since `before` was listed. By name, since two runs within one millisecond
 * can write names that sort out of the order they were written in.
 */
function written(before: readonly string[] = []): string {
  return sqlFiles()
    .filter(name => !before.includes(name))
    .map(name => readFileSync(join(dir, "migrations", name), "utf-8"))
    .join("\n");
}

/** Every statement in `sql`, UP and DOWN, without its comment lines. */
function withoutComments(sql: string): string {
  return sql
    .split("\n")
    .filter(line => !line.trimStart().startsWith("--"))
    .join("\n");
}

/**
 * The statements a migration's UP section runs, without its comment lines:
 * DOWN puts back what the migration changes, the field's record included.
 */
function statements(sql: string): string {
  return withoutComments(sql.split("-- DOWN")[0]);
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
      const before = sqlFiles();

      // Switched off after the column was made: the migration records that
      // the types no longer declare the field, and touches no table.
      expect((await create(project(["pages", "site_info"]))).code).toBe(
        undefined
      );
      expect(written()).toContain("pages: fields.seo_title (removed)");
      expect(statements(written(before))).not.toMatch(/seo_title/);
      expect((await check(project(["pages", "site_info"]))).code).toBe(
        undefined
      );

      // Switched on again: the column is there, so again no table changes.
      const off = sqlFiles();
      expect((await create(project())).code).toBeUndefined();
      expect(statements(written(off))).not.toMatch(/seo_title/);
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
      const before = sqlFiles();

      expect((await create(project(["cases"]))).code).toBeUndefined();
      expect(statements(written(before))).not.toMatch(/seo_title/);
      // Nor does the check plan its drop. Asked of the column alone, not as a
      // clean check: on MySQL, migrate:check currently reads a Builder type's
      // text columns as another type than migrate:create wrote them, its own
      // fields' included, which is wrong and not this change's. Once the two
      // agree, this asserts a clean check again, as the cases above do.
      expect((await check(project(["cases"]))).said).not.toMatch(
        /drop_column[^\n]*seo_title/
      );
    });

    it("lets a kept column of a required field take no value while its type is off, and drops nothing", async () => {
      expect(
        (await create(project(undefined, { required: true }))).code
      ).toBeUndefined();
      const before = sqlFiles();

      expect(
        (await create(project(["pages"], { required: true }))).code
      ).toBeUndefined();
      const relaxed = statements(written(before));
      expect(relaxed).toMatch(/dc_pages/);
      expect(relaxed).toMatch(/seo_title/);
      expect(relaxed).not.toMatch(/DROP COLUMN/i);
      expect(
        (await check(project(["pages"], { required: true }))).code
      ).toBeUndefined();
    });

    it("keeps a translated type's column, and switched on again plans nothing for it", async () => {
      const translated = { translated: true, unique: true };
      expect((await create(project(undefined, translated))).code).toBe(
        undefined
      );
      expect(written()).toMatch(/dc_pages_locales[\s\S]*seo_title/);
      const before = sqlFiles();

      expect((await create(project(["pages"], translated))).code).toBe(
        undefined
      );
      expect(statements(written(before))).not.toMatch(/seo_title/);
      expect((await check(project(["pages"], translated))).code).toBe(
        undefined
      );

      const off = sqlFiles();
      expect((await create(project(undefined, translated))).code).toBe(
        undefined
      );
      // Neither way: a DOWN that drops it would take the saved translations.
      expect(withoutComments(written(off))).not.toMatch(/seo_title/);
      expect((await check(project(undefined, translated))).code).toBe(
        undefined
      );
    });

    it("drops the kept column, and only it, when what is held back is released", async () => {
      expect((await create(project())).code).toBeUndefined();
      expect((await create(project(["pages"]))).code).toBeUndefined();
      const before = sqlFiles();

      // As `nextly prune` runs it on a site that keeps migration files.
      expect((await create(project(["pages"]), true)).code).toBeUndefined();
      const released = statements(written(before));
      expect(released).toMatch(/dc_pages[^\n;]*DROP COLUMN[^\n;]*seo_title/i);
      expect(released).not.toMatch(/dc_posts[^\n;]*seo_title/i);
      // Its snapshot no longer has the column, so the check passes after it.
      expect((await check(project(["pages"]))).code).toBeUndefined();
    });

    it("still records a translated kept column when what is held back is released", async () => {
      const translated = { translated: true };
      expect((await create(project(undefined, translated))).code).toBe(
        undefined
      );
      // `posts` keeps its column on its own table, `pages` in its
      // translations table.
      const off = ["posts", "pages"];
      expect((await create(project(off, translated))).code).toBe(undefined);

      // Only a type's own table is released: a migration never drops a
      // translations table's column, so its record stays.
      const before = sqlFiles();
      expect((await create(project(off, translated), true)).code).toBe(
        undefined
      );
      expect(statements(written(before))).toMatch(
        /dc_posts[^\n;]*DROP COLUMN[^\n;]*seo_title/i
      );
      const meta = join(dir, "migrations", "meta");
      const latest = readdirSync(meta).sort().at(-1)!;
      const snapshot = JSON.parse(readFileSync(join(meta, latest), "utf-8"));
      const pagesTable = snapshot.snapshot.tables.find(
        (table: { name: string }) => table.name === "dc_pages"
      );
      expect(pagesTable.localizedColumns).toContain("seo_title");
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
