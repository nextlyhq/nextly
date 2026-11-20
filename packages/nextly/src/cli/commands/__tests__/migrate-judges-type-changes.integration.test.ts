/**
 * `nextly migrate` judges a migration file's field type change by the values the database it runs
 * on holds, as the Schema Builder save that wrote the file judged it on its own: before the file's
 * first statement, naming the field, its rows and the file.
 *
 * A site is run in development, where its collection is made in the Builder with a text `price`
 * and then changed to a number over no values, which writes a create file and an update file. The
 * folder is then deployed onto a database of its own: the create file first, then entries the
 * development database never held, then the rest of the run, with the data-loss consent the type
 * change's file asks for. Driven through the command's own entry point with nobody to ask; only
 * the config loader and the command's connection are stood in for.
 */
import { randomBytes } from "node:crypto";
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
const TABLE = "dc_posts";

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
  const name = `nextly_mtc_${randomBytes(8).toString("hex")}`;
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

describe.each(getConfiguredTestDialects())(
  "nextly migrate judges a file's field type change by the values it finds (%s)",
  dialect => {
    let opened: CaseDatabase[] = [];
    let project = "";
    let current: TestNextly | undefined;
    const logger = createLogger({ quiet: true });
    const context = { logger } as unknown as CommandContext;

    async function open(): Promise<DrizzleAdapter> {
      const database = await emptyDatabase(dialect);
      opened.push(database);
      return database.adapter;
    }

    beforeEach(async () => {
      run.dialect = dialect;
      project = await mkdtemp(join(tmpdir(), "migrate-type-change-int-"));
      // The site, in development: `price` made a text, then a number over no values.
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
          fields: [{ name: "price", type: "text" }],
        }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [{ name: "price", type: "number" }],
          confirmed: true,
          schemaVersion: 1,
        }
      );
      await current.destroy();
      current = undefined;
    }, 180_000);

    afterEach(async () => {
      setNonInteractive(false);
      await current?.destroy().catch(() => {});
      current = undefined;
      clearServices();
      for (const each of opened) await each.close().catch(() => {});
      opened = [];
      await rm(project, { recursive: true, force: true });
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      _resetEnvCache();
    }, 120_000);

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** `nextly migrate` as the deploy runs it, with nobody to ask: its outcome, or what it threw. */
    async function migrate(
      options: { step?: number; dryRun?: boolean } = {}
    ): Promise<unknown> {
      return runMigrate(
        {
          cwd: project,
          quiet: true,
          throwOnFailure: true,
          ...options,
        } as never,
        context
      ).then(
        () => "applied",
        (error: unknown) => error
      );
    }

    /** The deployed database: the create file applied, then `values` written by entry id. */
    async function deployedHolding(
      values: Record<string, string>
    ): Promise<DrizzleAdapter> {
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
      expect(await migrate({ step: 1 })).toBe("applied");
      for (const [id, price] of Object.entries(values)) {
        await adapter.executeQuery(
          `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("price")}) VALUES ('${id}', '${id}', 'T', '${price}')`
        );
      }
      // The type change's file deletes data by its mark, so the deploy gives the consent naming
      // the column; the values it then finds are what decide.
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.price`);
      return adapter;
    }

    async function prices(
      adapter: DrizzleAdapter
    ): Promise<Record<string, unknown>> {
      const rows = (await adapter.executeQuery(
        `SELECT ${q("id")} AS id, ${q("price")} AS price FROM ${q(TABLE)} ORDER BY ${q("id")}`
      )) as Array<{ id: string; price: unknown }>;
      return Object.fromEntries(rows.map(r => [r.id, r.price]));
    }

    it("refuses the file before its first statement over a value the new type cannot read, naming the row and the file", async () => {
      const adapter = await deployedHolding({ r1: "12", r2: "abc" });

      const refused = await migrate();

      expect(NextlyError.is(refused)).toBe(true);
      const errors = (
        refused as {
          publicData?: {
            errors?: { path: string; code: string; message: string }[];
          };
        }
      ).publicData?.errors;
      expect(errors).toEqual([
        expect.objectContaining({
          path: "fields.price",
          code: "TYPE_CHANGE_LOSES_VALUES",
          message: expect.stringMatching(
            /Collection 'posts' \(migration .+\.sql\): field 'price' cannot change from text to number .*id r2.*Clearing the values that cannot convert can't be deployed yet/
          ),
        }),
      ]);
      // Nothing of the file ran: the column still holds every value as it was.
      expect(await prices(adapter)).toEqual({ r1: "12", r2: "abc" });
    }, 180_000);

    it("lists the same refusal in a dry run, changing nothing", async () => {
      const adapter = await deployedHolding({ r1: "12", r2: "abc" });
      const said = vi.spyOn(logger, "info");

      expect(await migrate({ dryRun: true })).toBe("applied");

      expect(said.mock.calls.flat().map(String).join("\n")).toMatch(
        /a real run would refuse it: Collection 'posts' \(migration .+\.sql\): field 'price' cannot change from text to number .*id r2/
      );
      expect(await prices(adapter)).toEqual({ r1: "12", r2: "abc" });
    }, 180_000);

    it("applies the file where every value reads as the new type", async () => {
      const adapter = await deployedHolding({ r1: "12", r2: "34" });

      expect(await migrate()).toBe("applied");

      const after = await prices(adapter);
      expect(Object.values(after).map(Number)).toEqual([12, 34]);
    }, 180_000);
  }
);
