/**
 * `migrate:create` writes no drop of a code-first collection that something
 * still depends on, and refuses with the message a delete gets.
 *
 * Removing a collection from the config makes the next migration drop its
 * table. While a remaining field points at the collection, a plugin's
 * declared foreign key points at its table, or a plugin's hidden column is on
 * it, that drop would leave the field pointing at nothing, strip the key, or
 * take the column and its values: the refusal names each, and the migrations
 * folder is left as it was.
 *
 * The command reads no database, so the dialect only decides the SQL it
 * would write; each is still asked, since the drop it refuses differs.
 * The config bundler is stubbed, as in the other `migrate:create` suites:
 * it compiles files to disk and imports them, which needs a project tree.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  LINKS_PLUGIN,
  LINKS_TABLE,
  MARKER_COLUMN,
  MARKER_PLUGIN,
  SETTINGS,
  TAGS,
  TAGS_TABLE,
  linksPlugin,
  markerPlugin,
  plainTags,
  settings,
} from "../../../domains/collections/__tests__/helpers/collection-dependents-fixtures";
import {
  defineCollection,
  defineSingle,
  relationship,
  text,
} from "../../../config";
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
  dir = await mkdtemp(join(tmpdir(), "nextly-removed-dependents-"));
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
  config: Record<string, unknown>
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
  let exited: string | undefined;
  try {
    await runMigrateCreate(
      name,
      { name, config: configPath, cwd: dir, nonInteractive: true },
      context
    );
  } catch (error) {
    exited = error instanceof Error ? error.message : String(error);
  }
  return { exited, errors };
}

/** The migration files written so far. */
async function migrationFiles(): Promise<string[]> {
  return (await readdir(join(dir, "src", "db", "migrations"))).filter(file =>
    file.endsWith(".sql")
  );
}

describeEachDialect(
  "migrate:create removing a collection something depends on",
  dialect => {
    it("refuses to drop a collection a remaining Single still points at", async () => {
      await generate(dialect, "initial", {
        collections: [plainTags],
        singles: [settings],
      });
      const before = await migrationFiles();
      expect(before).toHaveLength(1);

      const run = await generate(dialect, "drop_tags", {
        collections: [],
        singles: [settings],
      });

      expect(run.exited).toBe("process.exit(1)");
      expect(run.errors.join("\n")).toContain(
        `"${TAGS}" cannot be deleted while other schema depends on it. Fields that point at it: the Single ${SETTINGS}.featured. Remove those fields, or point them at another collection, then delete "${TAGS}".`
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("refuses to drop a collection stored under its own table name that a remaining Single points at", async () => {
      // The snapshot knows the removed table by its name alone, which a
      // `dbName` makes unrelated to the slug the Single's field names.
      const labelled = defineCollection({
        slug: TAGS,
        dbName: "dep_labels",
        fields: [text({ name: "label" })],
      });
      await generate(dialect, "initial", {
        collections: [labelled],
        singles: [settings],
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_tags", {
        collections: [],
        singles: [settings],
      });

      expect(run.exited).toBe("process.exit(1)");
      expect(run.errors.join("\n")).toContain(
        `Fields that point at it: the Single ${SETTINGS}.featured.`
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("still counts a surviving collection whose slug a removed table's name reads as", async () => {
      // The removed table `dc_labels` reads as the slug `labels`, which a
      // surviving collection holds: its field must not be taken for one that
      // goes with the removed collection.
      const labelled = defineCollection({
        slug: TAGS,
        dbName: "labels",
        fields: [text({ name: "label" })],
      });
      const survivor = defineCollection({
        slug: "labels",
        dbName: "other_labels",
        fields: [relationship({ name: "tag", relationTo: TAGS })],
      });
      await generate(dialect, "initial", { collections: [labelled, survivor] });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_tags", {
        collections: [survivor],
      });

      expect(run.exited).toBe("process.exit(1)");
      expect(run.errors.join("\n")).toContain(
        "Fields that point at it: labels.tag."
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("drops a collection whose table's name reads as a surviving collection's slug, while a Single points at the survivor", async () => {
      // `dc_labels` reads as `labels`, but nothing remaining names the
      // removed collection: the Single's field points at the surviving
      // `labels`, which stays, so the drop is no reason to refuse.
      const labelled = defineCollection({
        slug: TAGS,
        dbName: "labels",
        fields: [text({ name: "label" })],
      });
      const survivor = defineCollection({
        slug: "labels",
        dbName: "other_labels",
        fields: [text({ name: "name" })],
      });
      const pointsAtSurvivor = defineSingle({
        slug: SETTINGS,
        fields: [relationship({ name: "featured", relationTo: "labels" })],
      });
      await generate(dialect, "initial", {
        collections: [labelled, survivor],
        singles: [pointsAtSurvivor],
      });

      const run = await generate(dialect, "drop_tags", {
        collections: [survivor],
        singles: [pointsAtSurvivor],
      });

      expect(run).toEqual({ exited: undefined, errors: [] });
      expect(await migrationFiles()).toHaveLength(2);
    });

    it("refuses to drop a collection a plugin's declared foreign key points at", async () => {
      await generate(dialect, "initial", {
        collections: [plainTags],
        plugins: [linksPlugin],
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_tags", {
        collections: [],
        plugins: [linksPlugin],
      });

      expect(run.exited).toBe("process.exit(1)");
      const logged = run.errors.join("\n");
      expect(logged).toContain(
        `"${TAGS}" cannot be deleted while other schema depends on it.`
      );
      expect(logged).toContain(
        `Foreign keys that point at its tables: "fk_${LINKS_TABLE}_tag_id" on "${LINKS_TABLE}" (plugin "${LINKS_PLUGIN}").`
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("refuses to drop a collection holding a plugin's hidden column", async () => {
      await generate(dialect, "initial", {
        collections: [plainTags],
        plugins: [markerPlugin],
      });
      const before = await migrationFiles();

      const run = await generate(dialect, "drop_tags", {
        collections: [],
        plugins: [markerPlugin],
      });

      expect(run.exited).toBe("process.exit(1)");
      expect(run.errors.join("\n")).toContain(
        `the column "${MARKER_COLUMN}" on "${TAGS_TABLE}" (plugin "${MARKER_PLUGIN}")`
      );
      expect(await migrationFiles()).toEqual(before);
    });

    it("still drops a collection nothing depends on", async () => {
      // The control: the refusals above are about what depends on the
      // collection, not about removing one.
      await generate(dialect, "initial", { collections: [plainTags] });

      const run = await generate(dialect, "drop_tags", { collections: [] });

      expect(run).toEqual({ exited: undefined, errors: [] });
      expect(await migrationFiles()).toHaveLength(2);
    });
  }
);
