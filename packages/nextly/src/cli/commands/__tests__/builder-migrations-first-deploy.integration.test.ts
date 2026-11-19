/**
 * The first deploy of a project whose migrations the Schema Builder wrote, onto a database that
 * holds nothing, applies them with no data-loss consent, on every dialect.
 *
 * A Builder save writes its migration with the registry rows beside the table: an INSERT or
 * UPDATE of Nextly's own `dynamic_collections` and `nextly_meta`. On a new database those tables
 * are not there until the run makes them, so a write to them can run no code a table carried,
 * and nothing of it needs consent.
 *
 * A site is run in development and its collection made, and changed, in the Builder, which
 * leaves the definition file and the migrations in the project folder. The folder is then
 * deployed onto an empty database twice: by `nextly migrate`, driven through the command's own
 * entry point with nobody to ask and no consent, and by a production start that applies its
 * migrations itself. Only the config loader and the command's connection are stood in for.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";

const run = vi.hoisted(() => ({
  dialect: "sqlite" as string,
  adapter: undefined as unknown,
  config: undefined as unknown,
}));

// The project's configuration, as the commands load it.
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: run.config,
    appConfig: run.config,
    pluginConsent: undefined,
    dependencies: [],
  }),
}));

vi.mock("../../utils/adapter", async importOriginal => {
  const original = await importOriginal<typeof import("../../utils/adapter")>();
  // The case's own connection, kept open after the command so the case can read the database.
  const open = async () =>
    Object.assign(Object.create(run.adapter as object) as object, {
      disconnect: async () => {},
    });
  return {
    ...original,
    validateDatabaseEnv: () => ({
      valid: true,
      dialect: run.dialect,
      databaseUrl: "unused",
    }),
    createCliAdapter: open,
    openCommandAdapter: open,
  };
});

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

const MIGRATIONS = "./database/history";
const DEFINITION_FILE = "./schema/builder.json";
/** Where the run started, put back after a case that runs a start from its project folder. */
const WORKING_DIRECTORY = process.cwd();

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/** A database of the case's own that holds nothing: a throwaway one, or in-memory SQLite. */
async function emptyDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_fd_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  /** Drops the database and lets the server connection go, whatever came of the case. */
  const drop = async (): Promise<void> => {
    try {
      await server.executeQuery(dropDatabaseStatement(dialect, name));
    } finally {
      await server.disconnect();
    }
  };
  try {
    await server.executeQuery(createDatabaseStatement(dialect, name));
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    vi.stubEnv("DATABASE_URL", url.toString());
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: dialect,
      url: url.toString(),
    })) as unknown as DrizzleAdapter;
    return {
      adapter,
      async close() {
        await adapter.disconnect().catch(() => {});
        await drop();
      },
    };
  } catch (error) {
    // The database may have been made before the failure: nothing would drop it otherwise.
    await drop().catch(() => {});
    throw error;
  }
}

const context = {
  logger: createLogger({ quiet: true }),
} as unknown as CommandContext;

describe.each(getConfiguredTestDialects())(
  "the first deploy of Builder-written migrations onto an empty database (%s)",
  dialect => {
    let opened: CaseDatabase[] = [];
    let project = "";
    let current: TestNextly | undefined;

    async function open(): Promise<DrizzleAdapter> {
      const database = await emptyDatabase(dialect);
      opened.push(database);
      return database.adapter;
    }

    beforeEach(async () => {
      run.dialect = dialect;
      project = await mkdtemp(join(tmpdir(), "first-deploy-int-"));
      // The site, in development: its collection is made in the Builder, and given a second
      // field, so the folder holds a create file and an update file, each with its registry rows.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        adapter: (await open()) as never,
        basePath: project,
        collections: [],
        db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION_FILE },
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "posts",
          label: "Posts",
          fields: [{ name: "body", type: "text" }],
        }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [
            { name: "body", type: "text" },
            { name: "teaser", type: "text" },
          ],
          confirmed: true,
          schemaVersion: 1,
        }
      );
      const files = readdirSync(join(project, "database", "history"))
        .filter(file => file.endsWith(".sql"))
        .map(file =>
          readFileSync(join(project, "database", "history", file), "utf-8")
        );
      // The files the case is about are there: a create and an update, each writing the
      // collection's registry row.
      expect(files).toHaveLength(2);
      for (const file of files) expect(file).toMatch(/dynamic_collections/);
      await current.destroy();
      current = undefined;
    }, 180_000);

    afterEach(async () => {
      process.chdir(WORKING_DIRECTORY);
      setNonInteractive(false);
      await current?.destroy().catch(() => {});
      current = undefined;
      clearServices();
      for (const each of opened) await each.close().catch(() => {});
      opened = [];
      await rm(project, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    }, 120_000);

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** What the deployed database holds of `posts`: its registry row's field names, and its table's columns. */
    async function deployed(adapter: DrizzleAdapter): Promise<{
      registered: string[] | undefined;
      columns: string[];
    }> {
      const rows = await adapter
        .executeQuery<{
          fields: unknown;
        }>(
          `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'posts'`
        )
        .catch(() => []);
      const fields = rows[0]?.fields;
      const live = await introspectLiveSnapshot(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect,
        ["dc_posts"]
      );
      const columnsOf = (table: string): string[] =>
        (live.tables.find(t => t.name === table)?.columns ?? []).map(
          column => column.name
        );
      return {
        registered:
          fields === undefined
            ? undefined
            : (
                (typeof fields === "string" ? JSON.parse(fields) : fields) as {
                  name: string;
                }[]
              ).map(field => field.name),
        columns: columnsOf("dc_posts"),
      };
    }

    it("is applied by nextly migrate, with nobody to ask and no consent", async () => {
      const adapter = await open();
      run.adapter = adapter;
      run.config = defineConfig({
        collections: [],
        db: {
          migrationsDir: join(project, "database", "history"),
          uiSchemaFile: join(project, "schema", "builder.json"),
        },
      } as never);
      setNonInteractive(true);
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", undefined);

      const outcome = await runMigrate(
        { cwd: project, quiet: true, throwOnFailure: true } as never,
        context
      ).then(
        () => "applied",
        (error: unknown) =>
          NextlyError.is(error) ? error.publicMessage : String(error)
      );

      expect(outcome).toBe("applied");
      const after = await deployed(adapter);
      expect(after.registered).toEqual(["body", "teaser"]);
      expect(after.columns).toEqual(expect.arrayContaining(["body", "teaser"]));
    }, 180_000);

    it("is applied by a production start that runs its own migrations, with no consent", async () => {
      const adapter = await open();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", undefined);
      _resetEnvCache();
      // A start's own migrations are read from the folder the process runs in, as a deployed
      // app's are: the project.
      process.chdir(project);
      const logged: string[] = [];
      const quiet = createLogger({ quiet: true });

      current = await createTestNextly({
        adapter: adapter as never,
        basePath: project,
        collections: [],
        logger: {
          ...quiet,
          error: (line: string) => {
            logged.push(line);
          },
        } as never,
        db: {
          migrationsDir: MIGRATIONS,
          uiSchemaFile: DEFINITION_FILE,
          runMigrationsOnBoot: true,
        },
      });

      expect(
        logged.filter(line => line.includes("Boot migrations failed"))
      ).toEqual([]);
      const after = await deployed(adapter);
      expect(after.registered).toEqual(["body", "teaser"]);
      expect(after.columns).toEqual(expect.arrayContaining(["body", "teaser"]));
      // The deployed site serves the collection.
      const written = await current.nextly.create({
        collection: "posts",
        data: { body: "b", teaser: "t" },
      });
      expect(written.item).toMatchObject({ body: "b", teaser: "t" });
    }, 180_000);
  }
);
