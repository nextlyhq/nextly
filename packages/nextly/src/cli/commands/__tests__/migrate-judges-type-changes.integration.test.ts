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
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CORE_TABLE_NAMES } from "../../../schemas/index";
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

    /**
     * A hand-written migration, with no snapshot and no declared purpose, placed right after the
     * create file: it runs between it and the type change's file.
     */
    function handWritten(name: string, up: string): void {
      const dir = join(project, "database", "history");
      const [first] = readdirSync(dir)
        .filter(file => file.endsWith(".sql"))
        .sort();
      const file = `${first.replace(/\.sql$/, "")}_z_${name}`;
      writeFileSync(
        join(dir, `${file}.sql`),
        `-- Migration: ${file}\n\n-- UP\n${up};\n\n-- DOWN\nSELECT 1;\n`
      );
    }

    // A hand-written file states no field types: it runs as written, and the change after it is
    // judged once it has, so a cleanup that makes every value readable lets the change through.
    it("judges the change after a hand-written cleanup, once the cleanup has run", async () => {
      const adapter = await deployedHolding({ r1: "12", r2: "abc" });
      handWritten(
        "cleanup",
        `UPDATE ${q(TABLE)} SET ${q("price")} = '0' WHERE ${q("price")} = 'abc'`
      );

      expect(await migrate()).toBe("applied");

      const after = await prices(adapter);
      expect(Object.values(after).map(Number)).toEqual([12, 0]);
    }, 180_000);

    // A step that stops before the change's own file never judges it.
    it("applies a hand-written file under --step 1 without judging the change after it", async () => {
      const adapter = await deployedHolding({ r1: "12", r2: "abc" });
      handWritten(
        "touch",
        `UPDATE ${q(TABLE)} SET ${q("title")} = ${q("title")}`
      );

      expect(await migrate({ step: 1 })).toBe("applied");

      expect(await prices(adapter)).toEqual({ r1: "12", r2: "abc" });
    }, 180_000);

    // Plugin modules run before the app's files and may change their tables, which a dry run does
    // not run: it says the type changes were not checked, rather than listing a clean run.
    it("says in a dry run that it did not check the type changes behind a pending plugin module", async () => {
      await deployedHolding({ r1: "12", r2: "abc" });
      const notes = defineTable("notes", {
        id: col.id(),
        label: col.shortText(),
        ...col.timestamps(),
      });
      const tablesByDialect = {} as Parameters<
        typeof buildPluginMigration
      >[0]["tablesByDialect"];
      for (const each of ["postgresql", "mysql", "sqlite"] as const) {
        tablesByDialect[each] = (
          await buildExtensionSchema({
            dialect: each,
            coreTableNames: CORE_TABLE_NAMES,
            entities: [],
            pluginPrefixes: new Map([["mtcplug", "mtcplug"]]),
            plugins: [
              { owner: { kind: "plugin", id: "mtcplug" }, tables: [notes] },
            ],
          })
        ).specs;
      }
      const built = buildPluginMigration({
        pluginName: "mtcplug",
        schemaVersion: 1,
        name: "v1",
        now: new Date(Date.UTC(2026, 9, 1, 10, 0, 0, 1)),
        tablesByDialect,
        existing: [],
      });
      if (!built) throw new Error("no plugin module generated");
      run.config = defineConfig({
        collections: [],
        plugins: [
          {
            name: "mtcplug",
            version: "1.0.0",
            nextly: "*",
            contributes: { schema: { migrations: [built.module] } },
          },
        ],
        db: {
          migrationsDir: join(project, "database", "history"),
          uiSchemaFile: join(project, "schema", "builder.json"),
        },
      } as never);
      const said = vi.spyOn(logger, "info");

      await migrate({ dryRun: true });

      const lines = said.mock.calls.flat().map(String).join("\n");
      expect(lines).toMatch(
        /field type changes in .+\.sql were not checked: plugin modules run first/
      );
      expect(lines).not.toMatch(
        /a real run would refuse it: Collection 'posts'/
      );
    }, 180_000);

    // A dry run meets the database as it is: a change after a file it does not run is named as
    // judged when the run reaches it, never listed as clean.
    it("names in a dry run a type change after a hand-written file as judged when reached", async () => {
      await deployedHolding({ r1: "12", r2: "abc" });
      handWritten(
        "touch",
        `UPDATE ${q(TABLE)} SET ${q("title")} = ${q("title")}`
      );
      const said = vi.spyOn(logger, "info");

      expect(await migrate({ dryRun: true })).toBe("applied");

      expect(said.mock.calls.flat().map(String).join("\n")).toMatch(
        /field type changes in .+\.sql are judged when the run reaches it/
      );
    }, 180_000);

    // A field leaving translation copies its default language onto the entity's own table after
    // that change's own file: the next change, which converts that column, is judged once the copy
    // has run, so a value the copy brings in is judged before the conversion meets it.
    it("judges a change after a field leaving translation has copied its values in", async () => {
      const site = await mkdtemp(join(tmpdir(), "migrate-type-change-leave-"));
      const localization = { locales: ["en", "es"], defaultLocale: "en" };
      const history = join(site, "database", "history");
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        adapter: (await open()) as never,
        basePath: site,
        collections: [],
        localization,
        db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION_FILE },
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "notes",
          label: "Notes",
          localized: true,
          fields: [{ name: "v", type: "text", localized: true }],
        }
      );
      for (const [schemaVersion, field] of [
        [1, { name: "v", type: "text", localized: false }],
        [2, { name: "v", type: "number", localized: false }],
      ] as const) {
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "notes" },
          { fields: [field], confirmed: true, schemaVersion, localized: true }
        );
      }
      await current.destroy();
      current = undefined;

      // The deploy: every file before the field leaves translation, then a value the development
      // database never held, in its default language.
      const adapter = await open();
      run.adapter = adapter;
      run.config = defineConfig({
        collections: [],
        localization,
        db: {
          migrationsDir: history,
          uiSchemaFile: join(site, "schema", "builder.json"),
        },
      } as never);
      setNonInteractive(true);
      const files = readdirSync(history)
        .filter(file => file.endsWith(".sql"))
        .sort();
      const leaving = files.findIndex(file =>
        /"kind":"archive"/.test(readFileSync(join(history, file), "utf-8"))
      );
      expect(leaving).toBeGreaterThan(0);
      const deployed = await runMigrate(
        {
          cwd: site,
          quiet: true,
          throwOnFailure: true,
          step: leaving,
        } as never,
        context
      ).then(
        () => "applied",
        (error: unknown) => error
      );
      expect(deployed).toBe("applied");
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_notes")} (${q("id")}, ${q("slug")}, ${q("title")}) VALUES ('n1', 'n1', 'T')`
      );
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_notes_locales")} (${q("_parent")}, ${q("_locale")}, ${q("v")}) VALUES ('n1', 'en', 'abc')`
      );
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_notes.v,dc_notes_locales.v");

      const refused = await runMigrate(
        { cwd: site, quiet: true, throwOnFailure: true } as never,
        context
      ).then(
        () => "applied",
        (error: unknown) => error
      );

      expect(NextlyError.is(refused)).toBe(true);
      expect(
        (
          refused as {
            publicData?: { errors?: { path: string; code: string }[] };
          }
        ).publicData?.errors
      ).toEqual([
        expect.objectContaining({
          path: "fields.v",
          code: "TYPE_CHANGE_LOSES_VALUES",
        }),
      ]);
      await rm(site, { recursive: true, force: true });
    }, 240_000);
  }
);
