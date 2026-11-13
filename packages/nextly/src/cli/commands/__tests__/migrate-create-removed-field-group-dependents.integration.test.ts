/**
 * `migrate:create` writes no drop of a field group or Single something still depends on, with the
 * message a delete of it gets, and writes the drop once nothing does.
 *
 * A field group removed from the configuration is still placed by a remaining collection or field
 * group, or a plugin declares a foreign key into its table, or adds a column and an index to it; a
 * Single removed from the configuration has a plugin's foreign key into its table, or a plugin's
 * column on it. Each is refused before a file is written. A field group removed together with the
 * only collection that places it, and a field group or Single nothing depends on, are dropped.
 *
 * The command connects to no database, so the dialect is read from a URL nothing connects to.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  text,
} from "../../../config";
import {
  CARD,
  HOME,
  HOME_TABLE,
  LANGUAGES,
  LINKS_PLUGIN,
  LINKS_TABLE,
  MARKER_COLUMN,
  MARKER_PLUGIN,
  SEO,
  SEO_TABLE,
  linksPluginTo,
  markerPluginOn,
  plainHome,
  plainSeoGroup,
  seoGroup,
} from "../../../domains/field-groups/__tests__/helpers/used-field-group-fixtures";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestDialect } from "../../../plugins/test-nextly";
import { createContext } from "../../program";
import { clearConfigCache } from "../../utils/config-loader";
import { runMigrateCreate } from "../migrate-create";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("../../utils/config-bundler", () => ({ bundleAndRequire }));

/** A URL of each dialect. Nothing connects to it: only its dialect is read. */
const URLS: Record<TestDialect, string> = {
  sqlite: "file:./unused.db",
  postgresql: "postgresql://unused:unused@127.0.0.1:1/unused",
  mysql: "mysql://unused:unused@127.0.0.1:1/unused",
};

let dir: string;
let configPath: string;
const env = { ...process.env };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-removed-field-group-"));
  configPath = join(dir, "nextly.config.ts");
  // The loader stats the config path before bundling it.
  await writeFile(configPath, "");
  clearConfigCache();
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  bundleAndRequire.mockReset();
  clearConfigCache();
  for (const name of ["DATABASE_URL", "DB_DIALECT"] as const) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  await rm(dir, { recursive: true, force: true });
});

/** Run `migrate:create` over `config`, returning what it logged as errors. */
async function generate(
  dialect: TestDialect,
  name: string,
  config: Record<string, unknown>,
  // Where nobody can be asked, a file that drops a table is written only
  // under consent naming it, as `--accept-data-loss` gives it.
  consent: { acceptDataLoss?: string } = {}
): Promise<{ exited: string | undefined; errors: string[] }> {
  process.env.DATABASE_URL = URLS[dialect];
  process.env.DB_DIALECT = dialect;
  clearConfigCache();
  bundleAndRequire.mockResolvedValue({
    mod: { default: config },
    dependencies: [],
  });
  const context = createContext({ quiet: true });
  const errors: string[] = [];
  vi.spyOn(context.logger, "error").mockImplementation((message: string) => {
    errors.push(message);
  });
  // The error a command ends with is printed on standard error, in the error shape.
  vi.spyOn(console, "error").mockImplementation(message => {
    errors.push(String(message));
  });
  let exited: string | undefined;
  // As `--non-interactive` does: no rename is asked about.
  setNonInteractive(true);
  try {
    await runMigrateCreate(
      name,
      { name, config: configPath, cwd: dir, ...consent },
      context
    );
  } catch (error) {
    exited = error instanceof Error ? error.message : String(error);
  } finally {
    setNonInteractive(false);
  }
  return { exited, errors };
}

/** The migration files written so far. */
async function migrationFiles(): Promise<string[]> {
  return (await readdir(join(dir, "src", "db", "migrations"))).filter(file =>
    file.endsWith(".sql")
  );
}

/** A collection that places SEO at its top level and inside a group. */
const ARTICLES = "dep_articles";
const articles = defineCollection({
  slug: ARTICLES,
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "seo", component: SEO }),
    group({
      name: "extra",
      fields: [fieldGroup({ name: "more", component: SEO })],
    }),
  ],
});

/** A field group that places SEO inside a group. */
const card = defineFieldGroup({
  slug: CARD,
  fields: [
    group({
      name: "meta",
      fields: [fieldGroup({ name: "seo", component: SEO })],
    }),
  ],
});

/** HOME, translated: its translatable values are in its `_locales` table. */
const translatedHome = defineSingle({
  slug: HOME,
  localized: true,
  fields: [text({ name: "title", localized: true })],
});

describeEachDialect(
  "migrate:create removing a field group or Single something depends on",
  dialect => {
    it("refuses to drop a field group a remaining collection places, naming each field", async () => {
      await generate(dialect, "initial", {
        collections: [articles],
        fieldGroups: [plainSeoGroup],
      });
      const before = await migrationFiles();
      expect(before).toHaveLength(1);

      const run = await generate(dialect, "drop_seo", {
        collections: [articles],
        fieldGroups: [],
      });

      expect(run.exited).toBe("process.exit(1)");
      expect(run.errors.join("\n")).toContain(
        `"${SEO}" cannot be deleted while other schema depends on it. Fields that place it: ${ARTICLES}.seo, ${ARTICLES}.extra.more. Remove those fields, or have them place another field group, then delete "${SEO}".`
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("refuses to drop a field group another field group places", async () => {
      await generate(dialect, "initial", {
        fieldGroups: [plainSeoGroup, card],
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_seo", { fieldGroups: [card] });

      expect(run.exited).toBe("process.exit(1)");
      expect(run.errors.join("\n")).toContain(
        `Fields that place it: the field group ${CARD}.meta.seo.`
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("drops a field group together with the only collection that places it", async () => {
      await generate(dialect, "initial", {
        collections: [articles],
        fieldGroups: [plainSeoGroup],
      });

      const run = await generate(
        dialect,
        "drop_both",
        { collections: [], fieldGroups: [] },
        { acceptDataLoss: "dc_dep_articles,comp_dep_seo" }
      );

      expect(run).toEqual({ exited: undefined, errors: [] });
      expect(await migrationFiles()).toHaveLength(2);
    });

    it("refuses to drop a field group a plugin's declared key points at, naming the plugin and its table", async () => {
      const links = linksPluginTo(SEO_TABLE);
      await generate(dialect, "initial", {
        fieldGroups: [plainSeoGroup],
        plugins: [links],
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_seo", {
        fieldGroups: [],
        plugins: [links],
      });

      expect(run.exited).toBe("process.exit(1)");
      const said = run.errors.join("\n");
      expect(said).toContain(
        `"${SEO}" cannot be deleted while other schema depends on it. Foreign keys that point at its tables: `
      );
      expect(said).toContain(`on "${LINKS_TABLE}" (plugin "${LINKS_PLUGIN}")`);
      expect(await migrationFiles()).toEqual(before);
    });

    it("refuses to drop a field group a plugin adds a column and an index to", async () => {
      const marker = markerPluginOn(SEO_TABLE);
      await generate(dialect, "initial", {
        fieldGroups: [plainSeoGroup],
        plugins: [marker],
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_seo", {
        fieldGroups: [],
        plugins: [marker],
      });

      expect(run.exited).toBe("process.exit(1)");
      expect(run.errors.join("\n")).toContain(
        `the column "${MARKER_COLUMN}" on "${SEO_TABLE}" (plugin "${MARKER_PLUGIN}")`
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("refuses to drop a Single a plugin's declared key points at", async () => {
      const links = linksPluginTo(HOME_TABLE);
      await generate(dialect, "initial", {
        singles: [plainHome],
        plugins: [links],
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_home", {
        singles: [],
        plugins: [links],
      });

      expect(run.exited).toBe("process.exit(1)");
      const said = run.errors.join("\n");
      expect(said).toContain(
        `"${HOME}" cannot be deleted while other schema depends on it. Foreign keys that point at its tables: `
      );
      expect(said).toContain(`on "${LINKS_TABLE}" (plugin "${LINKS_PLUGIN}")`);
      expect(await migrationFiles()).toEqual(before);
    });

    it("refuses to drop a translated field group a plugin's declared key into its translation table points at", async () => {
      const links = linksPluginTo(`${SEO_TABLE}_locales`);
      await generate(dialect, "initial", {
        fieldGroups: [seoGroup],
        plugins: [links],
        localization: LANGUAGES,
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_seo", {
        fieldGroups: [],
        plugins: [links],
        localization: LANGUAGES,
      });

      expect(run.exited).toBe("process.exit(1)");
      const said = run.errors.join("\n");
      expect(said).toContain(
        `"${SEO}" cannot be deleted while other schema depends on it. Foreign keys that point at its tables: `
      );
      expect(said).toContain(`on "${LINKS_TABLE}" (plugin "${LINKS_PLUGIN}")`);
      expect(await migrationFiles()).toEqual(before);
    });

    it("refuses to drop a translated Single a plugin's declared key into its translation table points at", async () => {
      const links = linksPluginTo(`${HOME_TABLE}_locales`);
      await generate(dialect, "initial", {
        singles: [translatedHome],
        plugins: [links],
        localization: LANGUAGES,
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_home", {
        singles: [],
        plugins: [links],
        localization: LANGUAGES,
      });

      expect(run.exited).toBe("process.exit(1)");
      const said = run.errors.join("\n");
      expect(said).toContain(
        `"${HOME}" cannot be deleted while other schema depends on it. Foreign keys that point at its tables: `
      );
      expect(said).toContain(`on "${LINKS_TABLE}" (plugin "${LINKS_PLUGIN}")`);
      expect(await migrationFiles()).toEqual(before);
    });

    it("refuses to drop a Single a plugin adds a column to", async () => {
      const marker = markerPluginOn(HOME_TABLE);
      await generate(dialect, "initial", {
        singles: [plainHome],
        plugins: [marker],
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_home", {
        singles: [],
        plugins: [marker],
      });

      expect(run.exited).toBe("process.exit(1)");
      expect(run.errors.join("\n")).toContain(
        `the column "${MARKER_COLUMN}" on "${HOME_TABLE}" (plugin "${MARKER_PLUGIN}")`
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("drops a field group and a Single nothing depends on", async () => {
      await generate(dialect, "initial", {
        singles: [plainHome],
        fieldGroups: [plainSeoGroup],
      });

      const run = await generate(
        dialect,
        "drop_both",
        { singles: [], fieldGroups: [] },
        { acceptDataLoss: "single_dep_home,comp_dep_seo" }
      );

      expect(run).toEqual({ exited: undefined, errors: [] });
      expect(await migrationFiles()).toHaveLength(2);
    });
  }
);
