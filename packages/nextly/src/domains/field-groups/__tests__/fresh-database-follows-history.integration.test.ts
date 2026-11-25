/**
 * A project's migration history decides which field-group names its empty databases start on, on
 * every configured dialect.
 *
 * A project whose history is on the legacy names keeps working on a fresh database: a new
 * teammate's, or one that was reset. A development start and `nextly db:sync` set it up on the
 * names the history keeps, so a Builder save is planned against the same names, and `nextly migrate`
 * goes on. Set up on the current names, such a database had storage its history was not on, and both
 * were refused until the whole history was moved. A project with no history starts on the current
 * names, and one already on them starts there.
 *
 * Each run owns its project folder and its database, which the commands reach through
 * `DATABASE_URL` as an app's would: a file on SQLite, a scratch database on the servers.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { writeLegacyFieldGroupMigration } from "../../../__tests__/helpers/legacy-field-group-history";
import {
  runDbSync,
  type ResolvedDevOptions,
} from "../../../cli/commands/db-sync";
import { runMigrate } from "../../../cli/commands/migrate";
import { runMigrateCreate } from "../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../cli/program";
import { createLogger } from "../../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { getDialectTables } from "../../../database/index";
import { SchemaRegistry } from "../../../database/schema-registry";
import { clearServices, shutdownServices } from "../../../di/register";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../i18n/per-language-storage";
import { setNonInteractive } from "../../schema/migrate/can-prompt";
import { runFieldGroupMigration } from "../migration/run";
import { getFieldGroupRegistryAliases } from "../storage/registry-schemas";
import { forgetFieldGroupStorageNames } from "../storage/resolve-storage-names";

import {
  hasTable,
  seedLegacyCoreTables,
} from "./helpers/storage-generation-site";

/** The layout this project's suites run on, put back after a case that chose another. */
const useEarlierLayout = () => setPerLanguageStorage(false);

/** The configuration the commands load. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SILENT = createLogger({ quiet: true });

const card = defineFieldGroup({
  slug: "fdh_card",
  fields: [text({ name: "heading" })],
});
const posts = defineCollection({
  slug: "fdh_posts",
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: "fdh_card" }),
  ],
});
/** A collection with no field group in it. */
const plain = defineCollection({
  slug: "fdh_plain",
  fields: [text({ name: "title" })],
});
const DECLARED = { collections: [posts], fieldGroups: [card] };
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const PROJECT = defineConfig({ ...DECLARED, db: DB });

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-fresh-db-history-"));
  mkdirSync(join(dir, "migrations"));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PHASE", "");
  loaded.config = PROJECT;
  setNonInteractive(true);
  clearCachedSnapshot();
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  clearServices();
  for (const close of closers.splice(0)) await close();
  forgetFieldGroupStorageNames();
  clearCachedSnapshot();
  vi.unstubAllEnvs();
  _resetEnvCache();
  setNonInteractive(false);
  useEarlierLayout();
  rmSync(dir, { recursive: true, force: true });
});

/** An empty database of this test's own, which the commands reach through `DATABASE_URL`. */
async function emptyDatabase(
  dialect: TestDialect,
  name = "app"
): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, `${name}.db`)}`;
  } else {
    const scratch = await createScratchDatabase(dialect, "nextly_fdh");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

async function connect(
  dialect: TestDialect,
  url: string
): Promise<DrizzleAdapter> {
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return adapter;
}

/** The table resolver a command installs, with both registry names. */
function registerResolver(adapter: DrizzleAdapter, dialect: TestDialect): void {
  const registry = new SchemaRegistry(dialect);
  registry.registerStaticSchemas({
    ...getDialectTables(dialect),
    ...getFieldGroupRegistryAliases(dialect),
  });
  adapter.setTableResolver(registry);
}

/** `nextly migrate:field-groups --apply --backup-confirmed` on the database at `url`. */
async function moveStorage(dialect: TestDialect, url: string): Promise<void> {
  const adapter = await connect(dialect, url);
  registerResolver(adapter, dialect);
  forgetFieldGroupStorageNames();
  const outcome = await runFieldGroupMigration({
    adapter,
    logger: SILENT as never,
    direction: "up",
    dryRun: false,
    backupConfirmed: true,
  });
  expect(outcome).toMatchObject({ ran: true });
  forgetFieldGroupStorageNames();
  await shutdownServices().catch(() => {});
}

/** A development start of the project over the database at `url`. */
async function developmentStart(
  dialect: TestDialect,
  url: string,
  declared: Partial<typeof DECLARED> = DECLARED
): Promise<void> {
  await shutdownServices().catch(() => {});
  clearServices();
  clearCachedSnapshot();
  forgetFieldGroupStorageNames();
  await createTestNextly({
    adapter: (await connect(dialect, url)) as never,
    ...declared,
    db: DB,
    basePath: dir,
  } as Parameters<typeof createTestNextly>[0]);
}

/** Run a command, turning `process.exit` into its code, and say what it printed. */
async function run(
  fn: (context: CommandContext) => Promise<void>
): Promise<{ exit: number | undefined; said: string }> {
  const said: string[] = [];
  const keep = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: { ...SILENT, info: keep, warn: keep, success: keep, error: keep },
    options: {},
    cwd: dir,
  } as CommandContext;
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const printed = vi.spyOn(process.stderr, "write").mockImplementation(c => {
    said.push(String(c));
    return true;
  });
  const logged = vi.spyOn(console, "error").mockImplementation((...parts) => {
    said.push(parts.map(String).join(" "));
  });
  try {
    await fn(context);
    return { exit: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { exit: Number(match[1]), said: said.join("\n") };
    return { exit: -1, said: [...said, String(error)].join("\n") };
  } finally {
    exit.mockRestore();
    printed.mockRestore();
    logged.mockRestore();
    forgetFieldGroupStorageNames();
  }
}

const migrate = () => run(context => runMigrate({ cwd: dir }, context));
const dbSync = () =>
  run(context =>
    runDbSync({ cwd: dir, autoSync: true } as ResolvedDevOptions, context)
  );

/** The project's first migration, its history on the legacy names. */
const legacyHistory = (dialect: TestDialect) =>
  writeLegacyFieldGroupMigration({
    config: PROJECT,
    projectRoot: dir,
    migrationsDir: join(dir, "migrations"),
    dialect,
    name: "init",
  });

/** A `DATABASE_URL` no database answers at. */
function unreachable(dialect: TestDialect): void {
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv(
    "DATABASE_URL",
    dialect === "sqlite"
      ? `file:${join(dir, "absent", "none.db")}`
      : `${dialect}://nobody:nothing@127.0.0.1:1/absent`
  );
  _resetEnvCache();
}

/** A field group made through the Schema Builder, as its screen saves one. */
const builderCreate = (slug: string) =>
  dispatchComponents(
    "createComponent",
    {},
    { slug, label: slug, fields: [{ name: "note", type: "text" }] }
  );

/** The newest snapshot's envelope. */
function newestSnapshot(): { version: number; fieldGroupStorage?: string } {
  const meta = join(dir, "migrations", "meta");
  const newest = readdirSync(meta)
    .filter(file => file.endsWith(".snapshot.json"))
    .sort()
    .at(-1);
  if (newest === undefined) throw new Error("no snapshot");
  return JSON.parse(readFileSync(join(meta, newest), "utf-8")) as {
    version: number;
  };
}

describe.each(getConfiguredTestDialects())(
  "an empty database of a project with a migration history (%s)",
  dialect => {
    for (const [road, setUp] of [
      ["a development start", (url: string) => developmentStart(dialect, url)],
      [
        "nextly db:sync",
        async () => {
          const synced = await dbSync();
          expect(synced.exit, synced.said).toBeUndefined();
        },
      ],
    ] as const) {
      // On MySQL `nextly migrate` refuses the first migration of any database db:sync set up with a
      // field group, as not baselined, whatever its names. What db:sync sets up is asserted there,
      // and what goes on from it is not.
      const goesOn = !(dialect === "mysql" && road === "nextly db:sync");

      it(`starts on the legacy names its history keeps, set up by ${road}, and a Builder save and nextly migrate go on`, async () => {
        const url = await emptyDatabase(dialect);
        await legacyHistory(dialect);

        await setUp(url);

        const adapter = await connect(dialect, url);
        expect(await hasTable(adapter, "dynamic_components")).toBe(true);
        expect(await hasTable(adapter, "comp_fdh_card")).toBe(true);
        expect(await hasTable(adapter, "dynamic_field_groups")).toBe(false);
        expect(await hasTable(adapter, "fg_fdh_card")).toBe(false);
        if (!goesOn) return;

        const recorded = await migrate();
        expect(recorded.exit, recorded.said).toBeUndefined();

        await developmentStart(dialect, url);
        await builderCreate("fdh_banner");
        expect(await hasTable(adapter, "comp_fdh_banner")).toBe(true);
        expect(newestSnapshot()).toMatchObject({ version: 1 });

        await shutdownServices().catch(() => {});
        const after = await migrate();
        expect(after.exit, after.said).toBeUndefined();
        expect(await hasTable(adapter, "fg_fdh_card")).toBe(false);
      }, 180_000);

      // A history that moved part-way is legacy up to its move. An empty database starts where its
      // replay does, on the names of its first file, and goes on through the move as every other
      // database of the project did: the storage migration, then nextly migrate.
      it(`starts on the names a moved history begins on, set up by ${road}, and goes on through its move`, async () => {
        const first = await emptyDatabase(dialect);
        await legacyHistory(dialect);
        const applied = await migrate();
        expect(applied.exit, applied.said).toBeUndefined();
        await developmentStart(dialect, first);
        await moveStorage(dialect, first);
        const moved = await run(context =>
          runMigrateCreate(
            undefined,
            { cwd: dir, fieldGroupNames: "current" } as Parameters<
              typeof runMigrateCreate
            >[1],
            context
          )
        );
        expect(moved.exit, moved.said).toBeUndefined();

        const url = await emptyDatabase(dialect, "fresh");
        await setUp(url);

        const adapter = await connect(dialect, url);
        expect(await hasTable(adapter, "dynamic_components")).toBe(true);
        expect(await hasTable(adapter, "comp_fdh_card")).toBe(true);
        expect(await hasTable(adapter, "dynamic_field_groups")).toBe(false);
        if (!goesOn) return;
        // The move is the next step, and is named.
        await shutdownServices().catch(() => {});
        const stopped = await migrate();
        expect(stopped.exit, stopped.said).not.toBeUndefined();
        expect(stopped.said).toContain("FIELD_GROUP_STORAGE_NOT_MIGRATED");

        await moveStorage(dialect, url);
        const recorded = await migrate();
        expect(recorded.exit, recorded.said).toBeUndefined();
        await developmentStart(dialect, url);
        await builderCreate("fdh_banner");
        expect(await hasTable(adapter, "fg_fdh_banner")).toBe(true);
        await shutdownServices().catch(() => {});
        const after = await migrate();
        expect(after.exit, after.said).toBeUndefined();
        expect(await hasTable(adapter, "comp_fdh_card")).toBe(false);
      }, 240_000);

      // The reverse: a project whose history is on the current names.
      it(`starts on the current names its history is on, set up by ${road}, and a Builder save and nextly migrate go on`, async () => {
        const url = await emptyDatabase(dialect);
        const created = await run(context =>
          runMigrateCreate("init", { cwd: dir }, context)
        );
        expect(created.exit, created.said).toBeUndefined();
        expect(newestSnapshot()).toMatchObject({
          fieldGroupStorage: "current",
        });

        await setUp(url);

        const adapter = await connect(dialect, url);
        expect(await hasTable(adapter, "dynamic_field_groups")).toBe(true);
        expect(await hasTable(adapter, "fg_fdh_card")).toBe(true);
        expect(await hasTable(adapter, "dynamic_components")).toBe(false);
        if (!goesOn) return;

        const recorded = await migrate();
        expect(recorded.exit, recorded.said).toBeUndefined();

        await developmentStart(dialect, url);
        await builderCreate("fdh_banner");
        expect(await hasTable(adapter, "fg_fdh_banner")).toBe(true);

        await shutdownServices().catch(() => {});
        const after = await migrate();
        expect(after.exit, after.said).toBeUndefined();
        expect(await hasTable(adapter, "comp_fdh_card")).toBe(false);
      }, 180_000);

      it(`starts on the current names where the project has no history, set up by ${road}`, async () => {
        const url = await emptyDatabase(dialect);

        await setUp(url);

        const adapter = await connect(dialect, url);
        expect(await hasTable(adapter, "dynamic_field_groups")).toBe(true);
        expect(await hasTable(adapter, "dynamic_components")).toBe(false);
      }, 180_000);
    }

    // The road a deploy takes: nextly migrate meets the empty database first. It stops at the file
    // that moves the history, and goes on to the files after it once the storage moved.
    it("stops at the move on a moved project's empty database nextly migrate sets up, and goes on once it moved", async () => {
      const first = await emptyDatabase(dialect);
      await legacyHistory(dialect);
      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
      await moveStorage(dialect, first);
      const moved = await run(context =>
        runMigrateCreate(
          undefined,
          { cwd: dir, fieldGroupNames: "current" },
          context
        )
      );
      expect(moved.exit, moved.said).toBeUndefined();
      loaded.config = defineConfig({
        ...DECLARED,
        fieldGroups: [
          defineFieldGroup({
            slug: "fdh_card",
            fields: [text({ name: "heading" }), text({ name: "subheading" })],
          }),
        ],
        db: DB,
      });
      const later = await run(context =>
        runMigrateCreate("later", { cwd: dir }, context)
      );
      expect(later.exit, later.said).toBeUndefined();

      const url = await emptyDatabase(dialect, "fresh");
      const stopped = await migrate();
      expect(stopped.exit, stopped.said).not.toBeUndefined();
      expect(stopped.said).toContain("FIELD_GROUP_STORAGE_NOT_MIGRATED");
      expect(stopped.said).toContain("migrate:field-groups --apply");

      await moveStorage(dialect, url);
      const recorded = await migrate();
      expect(recorded.exit, recorded.said).toBeUndefined();
      const adapter = await connect(dialect, url);
      expect(await hasTable(adapter, "fg_fdh_card")).toBe(true);
      expect(await hasTable(adapter, "comp_fdh_card")).toBe(false);
      expect(await hasTable(adapter, "dynamic_components")).toBe(false);
      const again = await migrate();
      expect(again.exit, again.said).toBeUndefined();
    }, 240_000);

    /**
     * The blog template's own migration in the project's folder, as a visual blog is scaffolded with
     * it: as it ships, or as it shipped before it could say which names it is on.
     */
    function templateHistory(ships: "now" | "before"): void {
      // Laid out as every installation is, which its SQL is written for.
      _resetPerLanguageStorage();
      const from = fileURLToPath(
        new URL("../../../../../../templates/blog/migrations/", import.meta.url)
      );
      const to = join(dir, "migrations");
      mkdirSync(join(to, "meta"));
      for (const file of readdirSync(from).filter(f => f.endsWith(".sql"))) {
        copyFileSync(join(from, file), join(to, file));
      }
      const [meta] = readdirSync(join(from, "meta"));
      const snapshot = JSON.parse(
        readFileSync(join(from, "meta", meta), "utf-8")
      ) as Record<string, unknown>;
      expect(snapshot.fieldGroupStorage).toBe("current");
      if (ships === "before") delete snapshot.fieldGroupStorage;
      writeFileSync(join(to, "meta", meta), JSON.stringify(snapshot, null, 2));
    }

    for (const [ships, prefix, registry] of [
      ["now", "fg_", "dynamic_field_groups"],
      ["before", "comp_", "dynamic_components"],
    ] as const) {
      it(`starts a blog template's project, as it ships ${ships}, on ${registry} by nextly migrate, and a start goes on there`, async () => {
        const url = await emptyDatabase(dialect);
        templateHistory(ships);
        // The template's project declares nothing in code: its schema is its migration's.
        loaded.config = defineConfig({ db: DB });
        const set = await migrate();
        expect(set.exit, set.said).toBeUndefined();
        const adapter = await connect(dialect, url);
        expect(await hasTable(adapter, registry)).toBe(true);

        await developmentStart(dialect, url, DECLARED);
        expect(await hasTable(adapter, `${prefix}fdh_card`)).toBe(true);
      }, 180_000);

      it(`starts a blog template's empty database, as it ships ${ships}, on ${registry} by a development start`, async () => {
        const url = await emptyDatabase(dialect);
        templateHistory(ships);

        await developmentStart(dialect, url);

        const adapter = await connect(dialect, url);
        expect(await hasTable(adapter, registry)).toBe(true);
        expect(await hasTable(adapter, `${prefix}fdh_card`)).toBe(true);
      }, 180_000);
    }

    /** A history whose newest snapshot holds field groups under both namings. */
    async function mixedHistory(): Promise<void> {
      await legacyHistory(dialect);
      const meta = join(dir, "migrations", "meta");
      const [file] = readdirSync(meta).filter(f =>
        f.endsWith(".snapshot.json")
      );
      const path = join(meta, file);
      const snapshot = JSON.parse(readFileSync(path, "utf-8")) as {
        snapshot: {
          tables: Array<{ name: string; columns: Array<{ name: string }> }>;
        };
      };
      const group = snapshot.snapshot.tables.find(
        table => table.name === "comp_fdh_card"
      );
      if (group === undefined) throw new Error("no comp_fdh_card");
      snapshot.snapshot.tables.push({
        ...group,
        name: "fg_fdh_other",
        columns: group.columns.map(column =>
          column.name === "_component_type"
            ? { ...column, name: "_field_group_type" }
            : column
        ),
      });
      writeFileSync(path, JSON.stringify(snapshot, null, 2));
    }

    // A site an earlier release set up by its development starts, whose project writes its first
    // migration now: the tables it stands on are the legacy ones, so the migration records those.
    for (const [what, project] of [
      ["a field group", DECLARED],
      ["no field group", { collections: [plain], fieldGroups: [] }],
    ] as const) {
      it(`writes the first migration of a site on the legacy names under them, with ${what}, and nextly migrate records it`, async () => {
        const url = await emptyDatabase(dialect);
        const adapter = await connect(dialect, url);
        await seedLegacyCoreTables(adapter, dialect);
        loaded.config = defineConfig({ ...project, db: DB } as Parameters<
          typeof defineConfig
        >[0]);
        await developmentStart(dialect, url, project as typeof DECLARED);
        await shutdownServices().catch(() => {});

        const created = await run(context =>
          runMigrateCreate("init", { cwd: dir }, context)
        );
        expect(created.exit, created.said).toBeUndefined();
        expect(newestSnapshot()).toMatchObject({ version: 1 });

        const recorded = await migrate();
        expect(recorded.exit, recorded.said).toBeUndefined();
        expect(await hasTable(adapter, "comp_fdh_card")).toBe(
          project.fieldGroups.length > 0
        );
        expect(await hasTable(adapter, "fg_fdh_card")).toBe(false);

        // Another developer's empty database runs that first file.
        const other = await emptyDatabase(dialect, "other");
        const applied = await migrate();
        expect(applied.exit, applied.said).toBeUndefined();
        const otherAdapter = await connect(dialect, other);
        expect(await hasTable(otherAdapter, "dynamic_components")).toBe(true);
        expect(await hasTable(otherAdapter, "dynamic_field_groups")).toBe(
          false
        );
      }, 240_000);
    }

    it("writes the same first migration in a dry run, and reading the database changes nothing in it", async () => {
      const url = await emptyDatabase(dialect);
      const adapter = await connect(dialect, url);
      await seedLegacyCoreTables(adapter, dialect);
      const before = (await adapter.listTables()).sort();

      const dry = await run(context =>
        runMigrateCreate("init", { cwd: dir, dryRun: true }, context)
      );
      expect(dry.exit, dry.said).toBeUndefined();
      expect(dry.said).toContain("comp_fdh_card");
      expect(dry.said).not.toContain("fg_fdh_card");
      expect(readdirSync(join(dir, "migrations"))).toEqual([]);
      expect((await adapter.listTables()).sort()).toEqual(before);
    }, 120_000);

    // As every reader that finds both registries takes the legacy one.
    it("writes the first migration under the legacy names where the database holds both registries", async () => {
      const url = await emptyDatabase(dialect);
      const adapter = await connect(dialect, url);
      await seedLegacyCoreTables(adapter, dialect);
      await adapter.executeQuery(
        dialect === "mysql"
          ? "CREATE TABLE `dynamic_field_groups` (`id` int)"
          : 'CREATE TABLE "dynamic_field_groups" ("id" integer)'
      );
      const created = await run(context =>
        runMigrateCreate("init", { cwd: dir }, context)
      );
      expect(created.exit, created.said).toBeUndefined();
      expect(newestSnapshot()).toMatchObject({ version: 1 });
    }, 120_000);

    // Written where the database could not be read: refused, with the way out that works.
    it("refuses a first migration on the current names on a legacy site, and the one it says to write again is recorded", async () => {
      const url = await emptyDatabase(dialect);
      const adapter = await connect(dialect, url);
      await seedLegacyCoreTables(adapter, dialect);
      await developmentStart(dialect, url);
      await shutdownServices().catch(() => {});
      unreachable(dialect);
      const offline = await run(context =>
        runMigrateCreate("init", { cwd: dir }, context)
      );
      expect(offline.exit, offline.said).toBeUndefined();

      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      const refused = await migrate();
      expect(refused.exit, refused.said).not.toBeUndefined();
      expect(refused.said).toContain("FIELD_GROUP_STORAGE_NOT_MIGRATED");
      expect(refused.said).toMatch(
        /delete it with its snapshot .* run `nextly migrate:create` again where this database can be reached/
      );

      rmSync(join(dir, "migrations"), { recursive: true, force: true });
      mkdirSync(join(dir, "migrations"));
      const again = await run(context =>
        runMigrateCreate("init", { cwd: dir }, context)
      );
      expect(again.exit, again.said).toBeUndefined();
      const recorded = await migrate();
      expect(recorded.exit, recorded.said).toBeUndefined();
      expect(await hasTable(adapter, "comp_fdh_card")).toBe(true);
    }, 240_000);

    it("writes the first migration on the current names where the database is empty", async () => {
      await emptyDatabase(dialect);
      const created = await run(context =>
        runMigrateCreate("init", { cwd: dir }, context)
      );
      expect(created.exit, created.said).toBeUndefined();
      expect(newestSnapshot()).toMatchObject({
        version: 2,
        fieldGroupStorage: "current",
      });
      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
    }, 180_000);

    it("writes the first migration on the current names where no database can be reached", async () => {
      unreachable(dialect);
      const created = await run(context =>
        runMigrateCreate("init", { cwd: dir }, context)
      );
      expect(created.exit, created.said).toBeUndefined();
      expect(newestSnapshot()).toMatchObject({
        version: 2,
        fieldGroupStorage: "current",
      });
      // Looked for, and not made.
      expect(readdirSync(dir)).not.toContain("absent");
    }, 60_000);

    it("refuses by name to set an empty database up where the history's names cannot be told", async () => {
      const url = await emptyDatabase(dialect);
      await mixedHistory();

      await expect(developmentStart(dialect, url)).rejects.toThrow(
        /does not record which names the history is on/
      );
      const synced = await dbSync();
      expect(synced.exit, synced.said).not.toBeUndefined();
      expect(synced.said).toContain("nextly migrate:baseline");

      const adapter = await connect(dialect, url);
      expect(await hasTable(adapter, "dynamic_components")).toBe(false);
      expect(await hasTable(adapter, "dynamic_field_groups")).toBe(false);
    }, 180_000);

    // A newest snapshot that cannot be read is not taken as no history: the file is named.
    it("refuses by name to set an empty database up where the newest snapshot cannot be read", async () => {
      const url = await emptyDatabase(dialect);
      await legacyHistory(dialect);
      const meta = join(dir, "migrations", "meta");
      const [file] = readdirSync(meta).filter(f =>
        f.endsWith(".snapshot.json")
      );
      writeFileSync(join(meta, file), "{");

      await expect(developmentStart(dialect, url)).rejects.toThrow(file);
      const synced = await dbSync();
      expect(synced.exit, synced.said).not.toBeUndefined();
      expect(synced.said).toContain(file);
      expect(synced.said).toContain("Restore the file from version control");

      const adapter = await connect(dialect, url);
      expect(await hasTable(adapter, "dynamic_components")).toBe(false);
      expect(await hasTable(adapter, "dynamic_field_groups")).toBe(false);
    }, 180_000);

    // A database with no ledger is set up as a new one is, and one with a registry is still not new:
    // a second registry made beside the live one would hide every group in it.
    for (const [road, setUp] of [
      ["a development start", (url: string) => developmentStart(dialect, url)],
      [
        "nextly db:sync",
        async () => {
          const synced = await dbSync();
          expect(synced.exit, synced.said).toBeUndefined();
        },
      ],
      [
        "nextly migrate",
        async () => {
          loaded.config = defineConfig({ db: DB });
          const migrated = await migrate();
          expect(migrated.exit, migrated.said).toBeUndefined();
          loaded.config = PROJECT;
        },
      ],
    ] as const) {
      it(`keeps the legacy registry a database without a ledger holds, at ${road}`, async () => {
        const url = await emptyDatabase(dialect);
        const adapter = await connect(dialect, url);
        await seedLegacyCoreTables(adapter, dialect);
        await adapter.executeQuery(
          dialect === "mysql"
            ? "DROP TABLE `nextly_schema_events`"
            : 'DROP TABLE "nextly_schema_events"'
        );

        await setUp(url);

        expect(await hasTable(adapter, "dynamic_components")).toBe(true);
        expect(await hasTable(adapter, "dynamic_field_groups")).toBe(false);
      }, 180_000);
    }

    // Read only where a database is empty: an existing one's start does not depend on the folder.
    it("still starts over a database already set up, whatever its history says", async () => {
      const url = await emptyDatabase(dialect);
      await developmentStart(dialect, url);
      await mixedHistory();

      await developmentStart(dialect, url);

      const adapter = await connect(dialect, url);
      expect(await hasTable(adapter, "dynamic_field_groups")).toBe(true);
    }, 180_000);
  }
);
