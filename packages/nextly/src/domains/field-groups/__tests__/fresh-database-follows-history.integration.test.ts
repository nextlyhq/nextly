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
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { clearServices, shutdownServices } from "../../../di/register";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { setNonInteractive } from "../../schema/migrate/can-prompt";
import { forgetFieldGroupStorageNames } from "../storage/resolve-storage-names";

import { hasTable } from "./helpers/storage-generation-site";

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
  rmSync(dir, { recursive: true, force: true });
});

/** An empty database of this test's own, which the commands reach through `DATABASE_URL`. */
async function emptyDatabase(dialect: TestDialect): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, "app.db")}`;
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

/** A development start of the project over the database at `url`. */
async function developmentStart(
  dialect: TestDialect,
  url: string
): Promise<void> {
  await shutdownServices().catch(() => {});
  clearServices();
  clearCachedSnapshot();
  forgetFieldGroupStorageNames();
  await createTestNextly({
    adapter: (await connect(dialect, url)) as never,
    ...DECLARED,
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
      it(`starts on the legacy names its history keeps, set up by ${road}, and a Builder save and nextly migrate go on`, async () => {
        const url = await emptyDatabase(dialect);
        await legacyHistory(dialect);

        await setUp(url);

        const adapter = await connect(dialect, url);
        expect(await hasTable(adapter, "dynamic_components")).toBe(true);
        expect(await hasTable(adapter, "comp_fdh_card")).toBe(true);
        expect(await hasTable(adapter, "dynamic_field_groups")).toBe(false);
        expect(await hasTable(adapter, "fg_fdh_card")).toBe(false);

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
      expect(synced.said).toContain("INVALID_SNAPSHOT");

      const adapter = await connect(dialect, url);
      expect(await hasTable(adapter, "dynamic_components")).toBe(false);
      expect(await hasTable(adapter, "dynamic_field_groups")).toBe(false);
    }, 180_000);

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
