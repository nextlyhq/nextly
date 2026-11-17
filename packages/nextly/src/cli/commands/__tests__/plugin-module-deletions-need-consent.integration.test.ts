/**
 * A plugin's migration module that deletes data runs only with the data-loss
 * consent covering each deletion, on every configured dialect and through
 * every road that runs one: `nextly migrate`, the migrations a production
 * start runs, `plugins install`, and `migrate:down --plugin` for a module's
 * DOWN.
 *
 * The plugin is installed at its first module, which the real generator
 * writes. Each case then ships a second module, hand-written as a plugin
 * author writes a deliberate deletion (the generator writes none), and runs
 * it through a road:
 *
 * - a module dropping one of the plugin's own columns;
 * - a module removing rows from one of the plugin's own tables;
 * - a module whose DOWN drops a column, rolled back;
 * - a module removing rows a cascading key carries into a second table.
 *
 * Without consent each road refuses before anything changes, naming the
 * plugin, the module and the deletion: no module runs, and the values and
 * rows are kept. With consent naming the deletion, the module runs.
 *
 * Only the config loader and the command's connection are faked; the adapter
 * is a real one over a throwaway database.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearServices,
  destroyRegisteredPlugins,
  registerServices,
} from "../../../di/register";
import { newestEventsByFilename } from "../../../domains/schema/events/newest-event";
import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { compileExtensionSchema } from "../../../domains/schema/extension/publish";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import {
  NO_CONSENT,
  resolveDataLossConsent,
  type DataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import {
  migrationChecksum,
  qualifiedFilename,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import {
  appliedPluginShas,
  pluginMigrationArgs,
} from "../../../domains/schema/migrate/plugin/run-plugin-migrations";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { NextlyError } from "../../../errors/nextly-error";
import {
  getHookRegistry,
  resetHookRegistry,
} from "../../../hooks/hook-registry";
import {
  _resetBootMigrationsGateForTest,
  assertBootMigrationsSettled,
} from "../../../init/boot-migrations-gate";
import { definePlugin } from "../../../plugins/plugin-context";
import { resetPluginRouteRegistry } from "../../../plugins/routes/route-registry";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CORE_TABLE_NAMES } from "../../../schemas/index";
import { _resetEnvCache } from "../../../shared/lib/env";
import { getImageProcessor } from "../../../storage/image-processor";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";
import { downDatabaseDeps, migrateDownCore } from "../migrate-down";
import { runPluginInstall } from "../plugin-lifecycle-runner";
import { pluginModuleDown } from "../plugin-module-rollback";

const ALL = ["postgresql", "mysql", "sqlite"] as const;
type Dialect = (typeof ALL)[number];

const run = vi.hoisted(() => ({
  dialect: "sqlite" as string,
  adapter: undefined as unknown,
  plugin: undefined as unknown,
}));

// The app's config the install command reads. `run.plugin` is replaced as a
// case ships its second module.
vi.mock("../../utils/config-loader", async () => {
  const { sanitizeConfig } = await import("../../../shared/types/config");
  return {
    loadConfig: async () => {
      const config = {
        db: sanitizeConfig({ db: { runMigrationsOnBoot: true } }).db,
        plugins: [run.plugin],
      };
      return { config, appConfig: config, pluginConsent: undefined };
    },
  };
});

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: run.dialect,
    databaseUrl: "unused",
  }),
  // The test's adapter, kept connected after the command so the test can
  // read the database.
  createCliAdapter: async () =>
    Object.assign(Object.create(run.adapter as object) as object, {
      disconnect: async () => {},
    }),
}));

const PLUGIN = "@acme/mc";
const PREFIX = "mc";
const NOTES = "mc__notes";
const REPLIES = "mc__replies";

const noteColumns = {
  id: col.id(),
  body: col.shortText({ nullable: true }),
};
/** The plugin's first table, as its first module creates it. */
const notes = defineTable("notes", {
  ...noteColumns,
  summary: col.shortText({ nullable: true }),
});
/** The same table once a module has dropped `summary`. */
const notesWithoutSummary = defineTable("notes", noteColumns);
/** The same table once a module has added `extra`. */
const notesWithExtra = defineTable("notes", {
  ...noteColumns,
  summary: col.shortText({ nullable: true }),
  extra: col.shortText({ nullable: true }),
});
/** A second table whose rows go when the note they point at goes. */
const replies = defineTable(
  "replies",
  { id: col.id(), noteId: col.shortText({ nullable: true }) },
  {
    foreignKeys: [
      {
        columns: ["noteId"],
        references: { table: NOTES, columns: ["id"] },
        onDelete: "cascade",
      },
    ],
  }
);

type Tables = ReturnType<typeof defineTable>[];

/** The plugin's tables compiled for every dialect by the real builder. */
async function tablesByDialect(tables: Tables) {
  const out = {} as Parameters<
    typeof buildPluginMigration
  >[0]["tablesByDialect"];
  for (const dialect of ALL) {
    const built = await buildExtensionSchema({
      dialect,
      coreTableNames: CORE_TABLE_NAMES,
      entities: [],
      pluginPrefixes: new Map([[PLUGIN, PREFIX]]),
      plugins: [{ owner: { kind: "plugin", id: PLUGIN }, tables }],
    });
    out[dialect] = built.specs;
  }
  return out;
}

/** An identifier as `dialect` quotes it. */
const quoteFor = (dialect: Dialect) => (name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/**
 * A second module written by hand, as a plugin author writes a deliberate
 * deletion: its statements for each dialect, the plugin's tables as it leaves
 * them, and the checksum sealed over both.
 */
async function handWritten(args: {
  name: string;
  base: PluginMigration;
  /** The plugin's tables once the module has run. */
  after: Tables;
  statements: (q: (name: string) => string) => {
    up: string[];
    down: string[];
  };
}): Promise<PluginMigration> {
  const after = await tablesByDialect(args.after);
  const perDialect = <T>(of: (dialect: Dialect) => T) =>
    Object.fromEntries(ALL.map(dialect => [dialect, of(dialect)])) as Record<
      Dialect,
      T
    >;
  const content = {
    name: `20261117_120000_${args.name}`,
    schemaVersion: 2,
    dialects: perDialect(dialect => args.statements(quoteFor(dialect))),
    snapshot: perDialect(dialect => ({ tables: after[dialect] })),
    before: args.base.snapshot,
  };
  return { ...content, checksum: migrationChecksum(content) };
}

/** What a case ships after the plugin's first module, and the tables it declares then. */
interface Shipped {
  module: PluginMigration;
  tables: Tables;
}

interface Modules {
  /** Creates `mc__notes` and `mc__replies`. */
  base: PluginMigration;
  /** Drops `mc__notes.summary`. */
  dropsColumn: Shipped;
  /** Removes rows from `mc__replies`. */
  removesRows: Shipped;
  /** Removes a row of `mc__notes`, which the key carries into `mc__replies`. */
  cascades: Shipped;
  /** Adds `mc__notes.extra`; its DOWN drops it. */
  addsColumn: Shipped;
}

async function buildModules(): Promise<Modules> {
  const first = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: 1,
    name: "notes",
    now: new Date(Date.UTC(2026, 10, 17, 10, 0, 0)),
    tablesByDialect: await tablesByDialect([notes, replies]),
    existing: [],
  });
  if (!first) throw new Error("no first module generated");
  const base = first.module;
  const added = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: 2,
    name: "extra",
    now: new Date(Date.UTC(2026, 10, 17, 11, 0, 0)),
    tablesByDialect: await tablesByDialect([notesWithExtra, replies]),
    existing: [base],
  });
  if (!added) throw new Error("no module adding a column generated");
  return {
    base,
    dropsColumn: {
      tables: [notesWithoutSummary, replies],
      module: await handWritten({
        name: "drop_summary",
        base,
        after: [notesWithoutSummary, replies],
        statements: q => ({
          up: [`ALTER TABLE ${q(NOTES)} DROP COLUMN ${q("summary")}`],
          down: [
            `ALTER TABLE ${q(NOTES)} ADD COLUMN ${q("summary")} varchar(255)`,
          ],
        }),
      }),
    },
    removesRows: {
      tables: [notes, replies],
      module: await handWritten({
        name: "remove_old_replies",
        base,
        after: [notes, replies],
        statements: q => ({
          up: [`DELETE FROM ${q(REPLIES)} WHERE ${q("id")} = 'r-old'`],
          down: [],
        }),
      }),
    },
    cascades: {
      tables: [notes, replies],
      module: await handWritten({
        name: "remove_old_notes",
        base,
        after: [notes, replies],
        statements: q => ({
          up: [`DELETE FROM ${q(NOTES)} WHERE ${q("id")} = 'n-old'`],
          down: [],
        }),
      }),
    },
    addsColumn: { tables: [notesWithExtra, replies], module: added.module },
  };
}

let modules: Modules | undefined;

/** The consent `--accept-data-loss=<targets>` gives. */
const consentFor = (targets: string): DataLossConsent =>
  resolveDataLossConsent({ flag: targets, env: {} });

/** What the environment said before any test changed it. */
const NODE_ENV_AT_START = process.env.NODE_ENV;

/**
 * Puts the process back between production starts: production mode, the
 * start's gate, and the registries a start fills. A gate a start left
 * pending, or a refusal it recorded, is surfaced rather than wiped.
 */
function rebootProcessState(): void {
  vi.unstubAllEnvs();
  _resetEnvCache();
  resetPluginRouteRegistry();
  resetHookRegistry();
  try {
    assertBootMigrationsSettled();
  } finally {
    _resetBootMigrationsGateForTest();
  }
}

describe.each(getConfiguredTestDialects())(
  "a plugin migration module that deletes data (%s)",
  dialect => {
    let handle: TestNextly | undefined;
    let migrationsDir = "";
    let shipped: Modules;
    const adapter = () => handle!.adapter;
    const db = () => adapter().getDrizzle();
    const q = quoteFor(dialect);
    const quiet = createLogger({ quiet: true });
    const context = { logger: quiet } as unknown as CommandContext;

    /** The plugin as a release ships it: its modules, and the tables they leave. */
    function pluginWith(migrations: PluginMigration[], tables: Tables) {
      return definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.0",
        schemaVersion: migrations.length,
        contributes: { schema: { prefix: PREFIX, tables, migrations } },
      }) as unknown;
    }

    /** Ships `next` after the first module, as the plugin's next release. */
    function ship(next: Shipped): void {
      run.plugin = pluginWith([shipped.base, next.module], next.tables);
    }

    beforeEach(async () => {
      modules ??= await buildModules();
      shipped = modules;
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-module-consent-"));
      rebootProcessState();
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await reconcileCore({
        db: db(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      run.dialect = dialect;
      run.adapter = handle.adapter;
      // Installed at its first module, with rows every case's deletion would take.
      run.plugin = pluginWith([shipped.base], [notes, replies]);
      await runPluginInstall(PLUGIN, {}, context);
      await adapter().executeQuery(
        `INSERT INTO ${q(NOTES)} (${q("id")}, ${q("body")}, ${q("summary")}) VALUES ('n-old', 'a', 'kept'), ('n-new', 'b', 'kept')`
      );
      await adapter().executeQuery(
        `INSERT INTO ${q(REPLIES)} (${q("id")}, ${q("note_id")}) VALUES ('r-old', 'n-old'), ('r-new', 'n-new')`
      );
    }, 120_000);

    afterEach(async () => {
      try {
        await destroyRegisteredPlugins();
        clearServices();
        rebootProcessState();
      } finally {
        await handle?.destroy();
        handle = undefined;
        rmSync(migrationsDir, { recursive: true, force: true });
      }
    }, 60_000);

    /** The plugin's modules the ledger records applied, by ledger key. */
    async function appliedKeys(): Promise<string[]> {
      const rows = await new SchemaEventsRepository(
        db(),
        dialect
      ).listFileApplies();
      return [...appliedPluginShas(rows).keys()].sort();
    }

    const key = (module: PluginMigration) =>
      qualifiedFilename(PLUGIN, module.name);

    /** The values `column` of `mc__notes` holds, or undefined once it is gone. */
    async function noteValues(column: string): Promise<string[] | undefined> {
      const listed = (await adapter().executeQuery(
        dialect === "sqlite"
          ? `SELECT name AS c FROM pragma_table_info('${NOTES}')`
          : dialect === "mysql"
            ? `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${NOTES}'`
            : `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${NOTES}'`
      )) as Array<{ c?: unknown; C?: unknown }>;
      const names = listed.map(row => String(row.c ?? row.C).toLowerCase());
      if (!names.includes(column)) return undefined;
      const rows = (await adapter().executeQuery(
        `SELECT ${q(column)} AS v FROM ${q(NOTES)} ORDER BY ${q("id")}`
      )) as Array<{ v: string }>;
      return rows.map(row => row.v);
    }

    async function ids(table: string): Promise<string[]> {
      const rows = (await adapter().executeQuery(
        `SELECT ${q("id")} AS id FROM ${q(table)} ORDER BY ${q("id")}`
      )) as Array<{ id: string }>;
      return rows.map(row => row.id);
    }

    /** What a road answers: the refusal's words, or undefined once it ran. */
    type Outcome = string | undefined;

    const refusalOf = (work: Promise<unknown>): Promise<Outcome> =>
      work.then(
        () => undefined,
        (error: unknown) => {
          if (!NextlyError.is(error)) throw error;
          return error.publicMessage;
        }
      );

    /** `nextly migrate`'s run over the shipped plugin. */
    async function migrate(consent: DataLossConsent): Promise<Outcome> {
      const plugins = [run.plugin] as Parameters<typeof pluginMigrationArgs>[0];
      const extensionSchema = await compileExtensionSchema({
        dialect,
        plugins,
        config: { db: { migrationsDir }, plugins },
        server: adapter().getCapabilities(),
        logger: { warn: () => {} },
      } as Parameters<typeof compileExtensionSchema>[0]);
      return refusalOf(
        migrateCore({
          extensionSchema,
          dialect,
          db: db(),
          adapter: adapter() as never,
          migrationsDir,
          logger: quiet,
          lockMode: "wait",
          lockWaitMs: 30_000,
          consent,
          interactive: false,
          ...(await pluginMigrationArgs(plugins)),
          ensureLedger: () => ensureSchemaEventsTable(adapter()),
        })
      );
    }

    /** `plugins install`, run again over the installed plugin's new module. */
    const install = (consent: DataLossConsent): Promise<Outcome> =>
      refusalOf(runPluginInstall(PLUGIN, { consent }, context));

    /**
     * A production start that runs its migrations, with the consent the
     * environment gives. A migration the step refuses is logged rather than
     * thrown, so the refusal is read from the log; the start then refuses to
     * serve a plugin whose schema the database is behind, which is asserted
     * here so a refused module can never be mistaken for a served one.
     */
    async function start(targets: string | undefined): Promise<Outcome> {
      await destroyRegisteredPlugins();
      clearServices();
      rebootProcessState();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      if (targets !== undefined) {
        vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", targets);
      }
      _resetEnvCache();
      const errors: string[] = [];
      const stopped: unknown = await registerServices({
        adapter: run.adapter,
        basePath: handle!.basePath,
        imageProcessor: getImageProcessor(),
        hookRegistry: getHookRegistry(),
        logger: {
          ...quiet,
          error: (line: string) => {
            errors.push(line);
          },
        },
        plugins: [run.plugin],
        db: {
          runMigrationsOnBoot: true,
          migrationsDir,
          uiSchemaFile: join(migrationsDir, "ui-schema.json"),
        },
      } as never).then(
        () => undefined,
        (error: unknown) => error
      );
      const refusal = errors.filter(line =>
        line.includes("Boot migrations failed")
      );
      if (refusal.length === 0) {
        if (stopped !== undefined) throw stopped;
        return undefined;
      }
      expect(stopped).toMatchObject({ code: "PLUGIN_SCHEMA_BEHIND" });
      return refusal.join("\n");
    }

    /** `migrate:down --plugin`, over the plugin's newest applied module. */
    async function migrateDown(
      migrations: PluginMigration[],
      consent: DataLossConsent
    ): Promise<Outcome> {
      const repo = new SchemaEventsRepository(db(), dialect);
      return refusalOf(
        migrateDownCore({
          ...(await downDatabaseDeps({
            adapter: adapter(),
            dialect,
            plugin: { name: PLUGIN, migrations },
          })),
          nodeEnv: "test",
          logger: quiet,
          options: { step: 1, yes: true, consent, plugin: PLUGIN },
          fileExists: () => Promise.resolve(true),
          readDownSql: async filename =>
            pluginModuleDown({
              pluginName: PLUGIN,
              migrations,
              filename,
              recordedSha: newestEventsByFilename(
                await repo.listFileApplies()
              ).get(filename)?.sha256,
              dialect,
            }),
          withLock: withMigrateLock,
        })
      );
    }

    /** Each road that applies a module, with no consent and with consent naming `targets`. */
    const ROADS = [
      {
        road: "nextly migrate",
        refused: () => migrate(NO_CONSENT),
        consented: (targets: string) => migrate(consentFor(targets)),
      },
      {
        road: "the migrations a production start runs",
        refused: () => start(undefined),
        consented: (targets: string) => start(targets),
      },
      {
        road: "plugins install",
        refused: () => install(NO_CONSENT),
        consented: (targets: string) => install(consentFor(targets)),
      },
    ] as const;

    /** The refusal names the plugin, the module and the deletion. */
    function expectNames(
      refusal: Outcome,
      module: PluginMigration,
      deletion: string
    ): void {
      expect(refusal).toBeDefined();
      expect(refusal).toContain(key(module));
      expect(refusal).toContain(PLUGIN);
      expect(refusal).toContain(module.name);
      expect(refusal).toContain(deletion);
    }

    describe.each(ROADS)("through $road", ({ refused, consented }) => {
      it("refuses a module dropping its own column, keeping its values, and applies it with consent naming the column", async () => {
        const { module } = shipped.dropsColumn;
        ship(shipped.dropsColumn);

        expectNames(await refused(), module, `${NOTES}.summary`);
        expect(await noteValues("summary")).toEqual(["kept", "kept"]);
        expect(await appliedKeys()).toEqual([key(shipped.base)]);

        expect(await consented(`${NOTES}.summary`)).toBeUndefined();
        expect(await noteValues("summary")).toBeUndefined();
        expect(await noteValues("body")).toEqual(["b", "a"]);
        expect(await appliedKeys()).toEqual(
          [key(shipped.base), key(module)].sort()
        );
      }, 180_000);

      it("refuses a module removing rows from its own table, keeping every row, and applies it with consent naming the table", async () => {
        const { module } = shipped.removesRows;
        ship(shipped.removesRows);

        expectNames(await refused(), module, REPLIES);
        expect(await ids(REPLIES)).toEqual(["r-new", "r-old"]);
        expect(await appliedKeys()).toEqual([key(shipped.base)]);

        expect(await consented(REPLIES)).toBeUndefined();
        expect(await ids(REPLIES)).toEqual(["r-new"]);
        expect(await appliedKeys()).toEqual(
          [key(shipped.base), key(module)].sort()
        );
      }, 180_000);
    });

    it("refuses migrate:down over a module whose DOWN drops a column, keeping its values, and rolls it back with consent naming the column", async () => {
      const { module } = shipped.addsColumn;
      const migrations = [shipped.base, module];
      ship(shipped.addsColumn);
      // Adding a column deletes nothing, so the module applies with no consent.
      expect(await migrate(NO_CONSENT)).toBeUndefined();
      await adapter().executeQuery(
        `UPDATE ${q(NOTES)} SET ${q("extra")} = 'kept'`
      );

      expectNames(
        await migrateDown(migrations, NO_CONSENT),
        module,
        `${NOTES}.extra`
      );
      expect(await noteValues("extra")).toEqual(["kept", "kept"]);
      expect(await appliedKeys()).toEqual(
        [key(shipped.base), key(module)].sort()
      );

      expect(
        await migrateDown(migrations, consentFor(`${NOTES}.extra`))
      ).toBeUndefined();
      expect(await noteValues("extra")).toBeUndefined();
      expect(await appliedKeys()).toEqual([key(shipped.base)]);
    }, 180_000);

    it("names the table a module's removal of rows cascades into, and refuses consent naming only the parent", async () => {
      const { module } = shipped.cascades;
      ship(shipped.cascades);

      const refusal = await migrate(consentFor(NOTES));
      expectNames(refusal, module, REPLIES);
      expect(await ids(NOTES)).toEqual(["n-new", "n-old"]);
      expect(await ids(REPLIES)).toEqual(["r-new", "r-old"]);
      expect(await appliedKeys()).toEqual([key(shipped.base)]);
      if (dialect === "sqlite") {
        // The runner applies a SQLite module with foreign keys off, so no
        // cascade fires and consent names the parent alone: the reply left
        // pointing at a note that is gone then refuses the module, which is
        // rolled back whole.
        expect(refusal).toContain("referencing rows that do not exist");
        return;
      }

      expect(await migrate(consentFor(`${NOTES},${REPLIES}`))).toBeUndefined();
      expect(await ids(NOTES)).toEqual(["n-new"]);
      expect(await ids(REPLIES)).toEqual(["r-new"]);
      expect(await appliedKeys()).toEqual(
        [key(shipped.base), key(module)].sort()
      );
    }, 180_000);
  }
);

describe("the process state a test leaves", () => {
  it("does not reach the next test", () => {
    expect(process.env.NODE_ENV).toBe(NODE_ENV_AT_START);
    expect(() => assertBootMigrationsSettled()).not.toThrow();
  });
});
