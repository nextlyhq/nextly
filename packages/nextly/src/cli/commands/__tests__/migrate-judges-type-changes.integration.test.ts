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
 *
 * The development save marks its file as converting the values itself (`-- Converts values:`).
 * Most cases here deploy the file without that mark, as one written before a save converted
 * values, which `nextly migrate` judges by the database's cast (`withoutConversionMarks`). The
 * translated cases deploy it marked: each language's value converted, and one that cannot convert
 * cleared under the consent naming its column.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { date, defineCollection, defineConfig, number } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { toMinimalEntities } from "../../../domains/schema/migrate-create/config-entities";
import { generateMigration } from "../../../domains/schema/migrate-create/generate";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { splitSqlStatements } from "../../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import type { RenameCandidate } from "../../../domains/schema/pipeline/pushschema-pipeline-interfaces";
import { resolveCollectionTableName } from "../../../domains/schema/utils/resolve-table-name";
import { rewritesValuesOn } from "../../../domains/schema/value-conversion/type-change/field-type-changes";
import {
  judgementIn,
  refusalText,
} from "../../../domains/schema/value-conversion/type-change/__tests__/helpers/judgement-in";
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

/**
 * The migration files in `dir` without the mark of the values they convert, as files written
 * before a save converted values: `nextly migrate` judges such a file by the database's cast. A
 * folder with no marked file would test nothing, so at least one must be found, but where no road
 * rewrites values (MySQL): a save there marks none, and its files are such files already.
 */
function withoutConversionMarks(dir: string, dialect: TestDialect): void {
  let marked = 0;
  for (const file of readdirSync(dir).filter(name => name.endsWith(".sql"))) {
    const text = readFileSync(join(dir, file), "utf-8");
    const unmarked = text.replace(/^-- Converts values:.*\n/m, "");
    if (unmarked === text) continue;
    writeFileSync(join(dir, file), unmarked);
    marked += 1;
  }
  expect(marked > 0).toBe(rewritesValuesOn(dialect));
}
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
      withoutConversionMarks(join(project, "database", "history"), dialect);
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
     * The Builder dialog's judgement of `price` changing from text to number over `values`, on a
     * site and a database of its own; the rows are masked as `judgementIn` names them.
     */
    async function dialogJudgement(
      values: readonly string[],
      lostValue: string
    ): Promise<string> {
      const site = await mkdtemp(join(tmpdir(), "migrate-type-change-dialog-"));
      try {
        const t = await createTestNextly({
          adapter: (await open()) as never,
          basePath: site,
          collections: [],
          db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION_FILE },
        });
        current = t;
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
        let lost = "";
        for (const price of values) {
          const created = (await t.nextly.create({
            collection: "posts",
            data: { price },
          } as never)) as unknown as { item: { id: unknown } };
          if (price === lostValue) lost = String(created.item.id);
        }
        const answer = await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: [{ name: "price", type: "number" }],
            confirmed: true,
            schemaVersion: 1,
          }
        ).then(
          async a =>
            a instanceof Response ? ((await a.json()) as unknown) : a,
          (error: unknown) => error
        );
        return judgementIn(refusalText(answer), lost);
      } finally {
        await current?.destroy();
        current = undefined;
        clearServices();
        await rm(site, { recursive: true, force: true });
      }
    }

    // The file is judged by the values the deployed database holds, in the words the Builder's
    // dialog used for the same values: the same class, reasons and counts, rows by their own ids.
    it("names the judgement the Builder's dialog gave the same values", async () => {
      const ids = {
        whole: "00000000-0000-4000-8000-000000000001",
        fraction: "00000000-0000-4000-8000-000000000002",
        word: "00000000-0000-4000-8000-000000000003",
      };
      const dialog = await dialogJudgement(["1", "1.5", "abc"], "abc");
      expect(dialog).toMatch(/^blocked: /);
      const adapter = await deployedHolding({
        [ids.whole]: "1",
        [ids.fraction]: "1.5",
        [ids.word]: "abc",
      });

      const refused = await migrate();

      expect(judgementIn(refusalText(refused), ids.word)).toBe(dialog);
      expect(Object.values(await prices(adapter))).toEqual(["1", "1.5", "abc"]);
    }, 240_000);

    // A field kept inside a named group's JSON changes no column when its type changes: the file is
    // judged by the values the group holds, as the Builder's save is, naming the field by its path.
    it("refuses a file changing a group's field type over a value the new type cannot read", async () => {
      const sqlFiles = () =>
        readdirSync(join(project, "database", "history")).filter(file =>
          file.endsWith(".sql")
        );
      const group = (price: string) => [
        {
          name: "details",
          type: "group",
          fields: [{ name: "price", type: price }],
        },
      ];
      // In development, on a site of its own: a collection whose group's `price` is made a text,
      // then a number over no values.
      await rm(project, { recursive: true, force: true });
      project = await mkdtemp(join(tmpdir(), "migrate-type-change-int-"));
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
        { name: "kits", label: "Kits", fields: group("text") }
      );
      const madeBefore = sqlFiles().length;
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "kits" },
        { fields: group("number"), confirmed: true, schemaVersion: 1 }
      );
      await current.destroy();
      current = undefined;
      expect(sqlFiles().length).toBe(madeBefore + 1);
      // Deployed: the create file, then entries development never held.
      const adapter = await deployedHolding({});
      for (const [id, price] of [
        ["k1", "12"],
        ["k2", "abc"],
      ]) {
        await adapter.executeQuery(
          `INSERT INTO ${q("dc_kits")} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("details")}) VALUES ('${id}', '${id}', 'T', '${JSON.stringify({ price })}')`
        );
      }

      const refused = await migrate();

      // "12" stays a text inside the JSON, which the number reads only once rewritten; "abc" no
      // number reads.
      expect(NextlyError.is(refused)).toBe(true);
      const errors = (
        refused as { publicData?: { errors?: { message: string }[] } }
      ).publicData?.errors;
      expect(errors).toEqual([
        expect.objectContaining({
          code: "TYPE_CHANGE_BLOCKED",
          message: expect.stringMatching(
            /^Collection 'kits' \(migration .+\.sql\): field 'details\.price' cannot change from text to number /
          ),
        }),
      ]);
      expect(errors?.[0]?.message).toContain(
        "rewritten into its form, which a save does not do yet (1 row: id k1)"
      );
      expect(errors?.[0]?.message).toContain(
        "values that are not a number would be cleared (1 row: id k2)"
      );
      const rows = (await adapter.executeQuery(
        `SELECT ${q("id")} AS id, ${q("details")} AS details FROM ${q("dc_kits")} ORDER BY ${q("id")}`
      )) as Array<{ details: unknown }>;
      expect(
        rows.map(row =>
          typeof row.details === "string"
            ? (JSON.parse(row.details) as unknown)
            : row.details
        )
      ).toEqual([{ price: "12" }, { price: "abc" }]);
    }, 240_000);

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
    // not run: it says the type changes were not checked, rather than listing a clean run, and
    // names the file that changes the type, not a hand-written one the run meets first.
    it("says in a dry run that it did not check the type changes behind a pending plugin module", async () => {
      await deployedHolding({ r1: "12", r2: "abc" });
      handWritten(
        "touch",
        `UPDATE ${q(TABLE)} SET ${q("title")} = ${q("title")}`
      );
      const typeChanging = readdirSync(join(project, "database", "history"))
        .filter(file => file.endsWith(".sql"))
        .sort()
        .at(-1);
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
      expect(lines).toContain(
        `field type changes in ${typeChanging} were not checked: plugin modules run first`
      );
      expect(lines).not.toMatch(/_z_touch\.sql were not checked/);
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
      withoutConversionMarks(history, dialect);

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
    // A change that drops a translated field's per-language unique index has that drop written in
    // a file ahead of the change's own (`generate.ts`' `beforeMain`). The change is judged before
    // that file runs, so a refused type change leaves the index in place, not dropped under a
    // migration that stays blocked.
    it("judges a change before the file that drops its per-language unique index runs", async () => {
      const site = await mkdtemp(join(tmpdir(), "migrate-type-change-unique-"));
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
          name: "codes",
          label: "Codes",
          localized: true,
          fields: [
            { name: "code", type: "text", localized: true, unique: true },
            { name: "v", type: "text", localized: false },
          ],
        }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "codes" },
        {
          fields: [
            { name: "code", type: "text", localized: true },
            { name: "v", type: "number", localized: false },
          ],
          confirmed: true,
          schemaVersion: 1,
          localized: true,
        }
      );
      await current.destroy();
      current = undefined;
      withoutConversionMarks(history, dialect);

      const files = readdirSync(history)
        .filter(file => file.endsWith(".sql"))
        .sort();
      // The create writes a `unique` file adding the index after its own; the change's dropping
      // file, which names no field it indexes, is the last.
      const drop = files.findLastIndex(file =>
        /"kind":"unique"/.test(readFileSync(join(history, file), "utf-8"))
      );
      expect(readFileSync(join(history, files[drop]), "utf-8")).not.toMatch(
        /"unique":\[/
      );
      expect(drop).toBeGreaterThan(0);
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
      const migrateSite = (options: { step?: number } = {}) =>
        runMigrate(
          { cwd: site, quiet: true, throwOnFailure: true, ...options } as never,
          context
        ).then(
          () => "applied",
          (error: unknown) => error
        );
      // Every file before the change's first, then a value no number reads.
      expect(await migrateSite({ step: drop })).toBe("applied");
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_codes")} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("v")}) VALUES ('c1', 'c1', 'T', 'abc')`
      );
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_codes.v");

      const refused = await migrateSite();

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
      // The file dropping the index did not run: nothing of the change did.
      const recorded = (await adapter.executeQuery(
        `SELECT ${q("filename")} AS filename FROM ${q("nextly_schema_events")} WHERE ${q("event_type")} = 'file_apply' AND ${q("status")} = 'applied'`
      )) as Array<{ filename: string }>;
      expect(recorded.map(row => row.filename)).not.toContain(files[drop]);
      await rm(site, { recursive: true, force: true });
    }, 240_000);

    // A file whose statements committed while its ledger row was never written (MySQL commits each
    // statement, so a run that stops after them leaves the file unrecorded; so does a release
    // before this judgement): the database already stands at the file's end, and the run records
    // the file without running a statement. Nothing converts, so nothing is judged. A date becoming
    // a number is refused whatever its rows hold, so judged here it would keep the file pending
    // forever on a database it has nothing left to do to. `migrate:create` writes such a file for
    // a project declared in code; the Schema Builder refuses the change before writing one. On
    // MySQL only: PostgreSQL has no cast from a timestamp to a number, so the file never commits
    // there, and SQLite keeps both as an integer, so the database reads as before the file, which
    // the run then runs and judges.
    it.runIf(dialect === "mysql")(
      "records a type change's file the database already stands at the end of, refusing nothing",
      async () => {
        const site = await mkdtemp(join(tmpdir(), "migrate-type-change-done-"));
        const history = join(site, "database", "history");
        mkdirSync(history, { recursive: true });
        const blobs = (field: unknown) =>
          defineCollection({ slug: "blobs", fields: [field] as never });
        for (const [at, field] of [
          [1, date({ name: "data" })],
          [2, number({ name: "data" })],
        ] as const) {
          const written = await generateMigration({
            name: `step_${at}`,
            dialect: dialect as SupportedDialect,
            migrationsDir: history,
            collections: toMinimalEntities([blobs(field)], e =>
              resolveCollectionTableName(e.slug, e.dbName)
            ),
            singles: [],
            components: [],
            nonInteractive: true,
            decideRenames: async (candidates: readonly RenameCandidate[]) =>
              candidates.map(candidate => ({ candidate, accepted: false })),
            now: new Date(Date.UTC(2026, 10, 20, 12, at)),
          });
          expect(written).not.toBeNull();
        }
        const adapter = await open();
        run.adapter = adapter;
        run.config = defineConfig({
          collections: [blobs(number({ name: "data" }))],
          db: { migrationsDir: history },
        } as never);
        setNonInteractive(true);
        const step = (options: { step?: number } = {}) =>
          runMigrate(
            {
              cwd: site,
              quiet: true,
              throwOnFailure: true,
              ...options,
            } as never,
            context
          ).then(
            () => "applied",
            (error: unknown) => error
          );
        expect(await step({ step: 1 })).toBe("applied");
        // The type change's file, its statements run and its ledger row never written.
        const files = readdirSync(history)
          .filter(file => file.endsWith(".sql"))
          .sort();
        expect(files).toHaveLength(2);
        const change = files[1];
        for (const statement of splitSqlStatements(
          parseSqlSections(readFileSync(join(history, change), "utf-8")).upSql,
          dialect as SupportedDialect
        )) {
          await adapter.executeQuery(statement);
        }
        vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_blobs.data");

        expect(await step()).toBe("applied");

        const recorded = (await adapter.executeQuery(
          `SELECT ${q("filename")} AS filename FROM ${q("nextly_schema_events")} WHERE ${q("event_type")} = 'file_apply' AND ${q("status")} = 'applied'`
        )) as Array<{ filename: string }>;
        expect(recorded.map(row => row.filename)).toContain(change);
        await rm(site, { recursive: true, force: true });
      },
      240_000
    );

    /**
     * A site whose translated `notes` keeps `v` per language, made a text and then a number in the
     * Schema Builder, deployed onto a database of its own up to the change: every file before the
     * change's first, then `en` and `es` values the development database never held.
     */
    async function deployedTranslated(values: {
      en: string;
      es: string;
    }): Promise<{ site: string; adapter: DrizzleAdapter; files: string[] }> {
      const site = await mkdtemp(join(tmpdir(), "migrate-type-change-retype-"));
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
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "notes" },
        {
          fields: [{ name: "v", type: "number", localized: true }],
          confirmed: true,
          schemaVersion: 1,
          localized: true,
        }
      );
      await current.destroy();
      current = undefined;

      const files = readdirSync(history)
        .filter(file => file.endsWith(".sql"))
        .sort();
      // The change's first file: its translations column's, written ahead of its own.
      const retypes = files.findIndex(file =>
        /"kind":"retypes"/.test(readFileSync(join(history, file), "utf-8"))
      );
      expect(retypes).toBeGreaterThan(0);
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
      expect(
        await runMigrate(
          {
            cwd: site,
            quiet: true,
            throwOnFailure: true,
            step: retypes,
          } as never,
          context
        ).then(
          () => "applied",
          (error: unknown) => error
        )
      ).toBe("applied");
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_notes")} (${q("id")}, ${q("slug")}, ${q("title")}) VALUES ('n1', 'n1', 'T')`
      );
      for (const [locale, value] of Object.entries(values)) {
        await adapter.executeQuery(
          `INSERT INTO ${q("dc_notes_locales")} (${q("_parent")}, ${q("_locale")}, ${q("v")}) VALUES ('n1', '${locale}', '${value}')`
        );
      }
      return { site, adapter, files };
    }

    /** The type the database gives `column` of `table`, lower-cased. */
    async function columnType(
      adapter: DrizzleAdapter,
      table: string,
      column: string
    ): Promise<string> {
      const rows = (await adapter.executeQuery(
        dialect === "sqlite"
          ? `SELECT type AS t FROM pragma_table_info('${table}') WHERE name = '${column}'`
          : `SELECT data_type AS t FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'${dialect === "mysql" ? " AND table_schema = DATABASE()" : ""}`
      )) as Array<{ t?: string; T?: string }>;
      return String(rows[0]?.t ?? rows[0]?.T ?? "").toLowerCase();
    }

    // A translated field's type change takes its translations column to the new type in a file of
    // its own, written ahead of the change's: deployed, each language's value reads as a number.
    it("converts a translated field's translations column on deploy, every language read as a number", async () => {
      const { site, adapter } = await deployedTranslated({
        en: "12",
        es: "34",
      });
      // The type change's files are marked as deleting data, as any type change's is: the deploy
      // gives the consent naming both columns.
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_notes.v,dc_notes_locales.v");

      expect(
        await runMigrate(
          { cwd: site, quiet: true, throwOnFailure: true } as never,
          context
        ).then(
          () => "applied",
          (error: unknown) => error
        )
      ).toBe("applied");

      expect(await columnType(adapter, "dc_notes_locales", "v")).not.toMatch(
        /char|text/
      );
      const rows = (await adapter.executeQuery(
        `SELECT ${q("_locale")} AS locale, ${q("v")} AS v FROM ${q("dc_notes_locales")} ORDER BY ${q("_locale")}`
      )) as Array<{ locale: string; v: unknown }>;
      expect(rows.map(row => [row.locale, Number(row.v)])).toEqual([
        ["en", 12],
        ["es", 34],
      ]);
      await rm(site, { recursive: true, force: true });
    }, 240_000);

    // The development save's file is marked as converting each value itself: a value only `es`
    // holds that no number reads is cleared under the consent naming the translations column,
    // while `en` converts, and the column takes the new type.
    it.skipIf(!rewritesValuesOn(dialect))(
      "clears under consent a value one language holds that no number reads, and converts the rest",
      async () => {
        const { site, adapter } = await deployedTranslated({
          en: "12",
          es: "abc",
        });
        vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_notes.v,dc_notes_locales.v");

        expect(
          await runMigrate(
            { cwd: site, quiet: true, throwOnFailure: true } as never,
            context
          ).then(
            () => "applied",
            (error: unknown) => error
          )
        ).toBe("applied");

        expect(await columnType(adapter, "dc_notes_locales", "v")).not.toMatch(
          /char|text/
        );
        const rows = (await adapter.executeQuery(
          `SELECT ${q("_locale")} AS locale, ${q("v")} AS v FROM ${q("dc_notes_locales")} ORDER BY ${q("_locale")}`
        )) as Array<{ locale: string; v: unknown }>;
        expect(
          rows.map(row => [row.locale, row.v === null ? null : Number(row.v)])
        ).toEqual([
          ["en", 12],
          ["es", null],
        ]);
        await rm(site, { recursive: true, force: true });
      },
      240_000
    );

    // Where no road rewrites values (MySQL), consent clears nothing, as the database's cast clears
    // none: each language's value is judged before the change's first file: a value only `es` holds
    // that no number reads refuses the run, naming that row, and the column keeps its type.
    it.runIf(!rewritesValuesOn(dialect))(
      "refuses a deploy over a value one language holds that no number reads, before any statement",
      async () => {
        const { site, adapter } = await deployedTranslated({
          en: "12",
          es: "abc",
        });
        vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_notes.v,dc_notes_locales.v");

        const refused = await runMigrate(
          { cwd: site, quiet: true, throwOnFailure: true } as never,
          context
        ).then(
          () => "applied",
          (error: unknown) => error
        );

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
            path: "fields.v",
            code: "TYPE_CHANGE_LOSES_VALUES",
            message: expect.stringMatching(/\bes\b/),
          }),
        ]);
        expect(await columnType(adapter, "dc_notes_locales", "v")).toMatch(
          /char|text/
        );
        await rm(site, { recursive: true, force: true });
      },
      240_000
    );
  }
);
