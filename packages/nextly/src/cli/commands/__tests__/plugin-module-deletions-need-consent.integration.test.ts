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
 * - a module removing rows a cascading key carries into a second table;
 * - a module that deletes nothing, pending before one that drops a column.
 *
 * Without consent each road refuses before anything changes, naming the
 * plugin, the module, the deletion and the consent that would cover it: no
 * module runs, not even a harmless one pending before the refused one, and
 * the values and rows are kept. With consent naming the deletion, the module
 * runs.
 *
 * `nextly migrate` and `migrate:down` are driven through the commands' own
 * entry points, so the flag and the environment are read as a person's run
 * reads them. Only the config loader and the command's connection are faked;
 * the adapter is a real one over a throwaway database, and every statement
 * sent through it is recorded, so a refusal is shown to come before the
 * deleting statement and not after it was run and rolled back.
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
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
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
import { appliedPluginShas } from "../../../domains/schema/migrate/plugin/run-plugin-migrations";
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
import { runMigrate } from "../migrate";
import { runMigrateDown } from "../migrate-down";
import {
  runPluginInstall,
  runPluginInstallAll,
} from "../plugin-lifecycle-runner";

const ALL = ["postgresql", "mysql", "sqlite"] as const;
type Dialect = (typeof ALL)[number];

const run = vi.hoisted(() => ({
  dialect: "sqlite" as string,
  adapter: undefined as unknown,
  plugin: undefined as unknown,
  /** Plugins the config lists before it. */
  before: [] as unknown[],
  /** The app's migrations folder: empty, since the app ships no files. */
  migrationsDir: "",
}));

// The app's config the commands read. `run.plugin` is replaced as a case
// ships its next release.
vi.mock("../../utils/config-loader", async () => {
  const { sanitizeConfig } = await import("../../../shared/types/config");
  return {
    loadConfig: async () => {
      const config = {
        ...sanitizeConfig({
          db: {
            runMigrationsOnBoot: true,
            migrationsDir: run.migrationsDir,
            uiSchemaFile: `${run.migrationsDir}/ui-schema.json`,
          },
        }),
        plugins: [...run.before, run.plugin],
      };
      return { config, appConfig: config, pluginConsent: undefined };
    },
  };
});

vi.mock("../../utils/adapter", async importOriginal => {
  const original = await importOriginal<typeof import("../../utils/adapter")>();
  // The test's adapter, kept connected after the command so the test can
  // read the database.
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

/** The variable a run reads its data-loss consent from when no flag gives it. */
const CONSENT_ENV = "NEXTLY_ACCEPT_DATA_LOSS";

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
/** The same table once `extra` is added and `summary` dropped. */
const notesWithExtraWithoutSummary = defineTable("notes", {
  ...noteColumns,
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

/** A second plugin, not yet installed, whose one module creates a table and deletes nothing. */
const OTHER = { name: "@acme/ha", prefix: "ha" };
const OTHER_TABLE = "ha__things";
const things = defineTable("things", { id: col.id() });

/** The plugin's tables compiled for every dialect by the real builder. */
async function tablesByDialect(
  tables: Tables,
  owner: { name: string; prefix: string } = { name: PLUGIN, prefix: PREFIX }
) {
  const out = {} as Parameters<
    typeof buildPluginMigration
  >[0]["tablesByDialect"];
  for (const dialect of ALL) {
    const built = await buildExtensionSchema({
      dialect,
      coreTableNames: CORE_TABLE_NAMES,
      entities: [],
      pluginPrefixes: new Map([[owner.name, owner.prefix]]),
      plugins: [{ owner: { kind: "plugin", id: owner.name }, tables }],
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
  /** The module before it, whose tables it starts from. */
  base: PluginMigration;
  /** The plugin's tables once the module has run. */
  after: Tables;
  /** The plugin it belongs to, where that is not the one under test. */
  owner?: { name: string; prefix: string };
  statements: (q: (name: string) => string) => {
    up: string[];
    down: string[];
  };
}): Promise<PluginMigration> {
  const after = await tablesByDialect(args.after, args.owner);
  const perDialect = <T>(of: (dialect: Dialect) => T) =>
    Object.fromEntries(ALL.map(dialect => [dialect, of(dialect)])) as Record<
      Dialect,
      T
    >;
  const content = {
    name: `20261117_120000_${args.name}`,
    schemaVersion: args.base.schemaVersion + 1,
    dialects: perDialect(dialect => args.statements(quoteFor(dialect))),
    snapshot: perDialect(dialect => ({ tables: after[dialect] })),
    before: args.base.snapshot,
  };
  return { ...content, checksum: migrationChecksum(content) };
}

/** What a case ships after the plugin's first module, and the tables it declares then. */
interface Shipped {
  /** The module the case is about: the last one shipped. */
  module: PluginMigration;
  /** Modules shipped between the first and `module`, which delete nothing. */
  earlier?: PluginMigration[];
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
  /** `addsColumn`'s module, then one dropping `mc__notes.summary`. */
  addsThenDrops: Shipped;
  /** The other plugin's first module, which creates `ha__things`. */
  other: PluginMigration;
  /** The other plugin's second module, which removes rows from `ha__things`. */
  otherRemovesRows: PluginMigration;
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
  const other = buildPluginMigration({
    pluginName: OTHER.name,
    schemaVersion: 1,
    name: "things",
    now: new Date(Date.UTC(2026, 10, 17, 10, 0, 0)),
    tablesByDialect: await tablesByDialect([things], OTHER),
    existing: [],
  });
  if (!other) throw new Error("no module generated for the other plugin");
  return {
    other: other.module,
    otherRemovesRows: await handWritten({
      name: "remove_old_things",
      base: other.module,
      after: [things],
      owner: OTHER,
      statements: q => ({
        up: [`DELETE FROM ${q(OTHER_TABLE)} WHERE ${q("id")} = 't-old'`],
        down: [],
      }),
    }),
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
    addsThenDrops: {
      tables: [notesWithExtraWithoutSummary, replies],
      earlier: [added.module],
      module: await handWritten({
        name: "drop_summary_after_extra",
        base: added.module,
        after: [notesWithExtraWithoutSummary, replies],
        statements: q => ({
          up: [`ALTER TABLE ${q(NOTES)} DROP COLUMN ${q("summary")}`],
          down: [
            `ALTER TABLE ${q(NOTES)} ADD COLUMN ${q("summary")} varchar(255)`,
          ],
        }),
      }),
    },
  };
}

let modules: Modules | undefined;

/** The consent `--accept-data-loss=<targets>` gives, as `plugins install` resolves it. */
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
      run.plugin = pluginWith(
        [shipped.base, ...(next.earlier ?? []), next.module],
        next.tables
      );
    }

    /** Every statement sent through the adapter since `issued` was last emptied. */
    const issued: string[] = [];

    /**
     * Records each statement the adapter is handed, on its own connection
     * and inside its transactions, before it runs. The record is outside any
     * transaction, so a statement run and then rolled back still shows.
     */
    function recordStatements(target: TestNextly["adapter"]): void {
      type Run = (...args: unknown[]) => Promise<unknown>;
      const patched = target as unknown as {
        executeQuery: Run;
        transaction: Run;
      };
      const record = (statement: unknown) => {
        if (typeof statement === "string") issued.push(statement);
      };
      const executeQuery = patched.executeQuery.bind(target);
      patched.executeQuery = (...args) => {
        record(args[0]);
        return executeQuery(...args);
      };
      const transaction = patched.transaction.bind(target);
      patched.transaction = (work, ...rest) =>
        transaction(
          (ctx: object) =>
            (work as (ctx: object) => Promise<unknown>)(
              new Proxy(ctx, {
                get(inner, property) {
                  const value: unknown = Reflect.get(inner, property, inner);
                  if (typeof value !== "function") return value;
                  const method = (value as Run).bind(inner);
                  if (property !== "execute") return method;
                  return (...args: unknown[]) => {
                    record(args[0]);
                    return method(...args);
                  };
                },
              })
            ),
          ...rest
        );
    }

    /** The recorded statements that change or empty one of the plugin's tables. */
    const changesIssued = () =>
      issued.filter(statement =>
        /^\s*(ALTER\s+TABLE|DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b[^;]*\bmc__/i.test(
          statement
        )
      );

    beforeEach(async () => {
      modules ??= await buildModules();
      shipped = modules;
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-module-consent-"));
      run.migrationsDir = migrationsDir;
      rebootProcessState();
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await reconcileCore({
        db: db(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      run.dialect = dialect;
      run.adapter = handle.adapter;
      run.before = [];
      // Installed at its first module, with rows every case's deletion would take.
      run.plugin = pluginWith([shipped.base], [notes, replies]);
      await runPluginInstall(PLUGIN, {}, context);
      await adapter().executeQuery(
        `INSERT INTO ${q(NOTES)} (${q("id")}, ${q("body")}, ${q("summary")}) VALUES ('n-old', 'a', 'kept'), ('n-new', 'b', 'kept')`
      );
      await adapter().executeQuery(
        `INSERT INTO ${q(REPLIES)} (${q("id")}, ${q("note_id")}) VALUES ('r-old', 'n-old'), ('r-new', 'n-new')`
      );
      recordStatements(handle.adapter);
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

    /** The values `column` of `mc__notes` holds, or undefined where it has no such column. */
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

    /**
     * The environment's consent for the run that follows: `targets`, or none.
     * None is set, not left as found, so a consent the shell running the
     * suite carries never stands for a run meant to have none.
     */
    function consentInEnvironment(targets: string | undefined): void {
      vi.stubEnv(CONSENT_ENV, targets);
    }

    /** The `nextly migrate` command, with `--accept-data-loss=<targets>` or without it. */
    function migrate(targets: string | undefined): Promise<Outcome> {
      consentInEnvironment(undefined);
      issued.length = 0;
      return refusalOf(
        runMigrate(
          {
            acceptDataLoss: targets,
            cwd: migrationsDir,
            quiet: true,
            // The command's failure, thrown where the command line would exit.
            throwOnFailure: true,
          },
          context
        )
      );
    }

    /** `plugins install`, run again over the installed plugin's new modules. */
    function install(targets: string | undefined): Promise<Outcome> {
      consentInEnvironment(undefined);
      issued.length = 0;
      return refusalOf(
        runPluginInstall(
          PLUGIN,
          { consent: targets === undefined ? NO_CONSENT : consentFor(targets) },
          context
        )
      );
    }

    /** `plugins install` with no name: every configured plugin, in the config's order. */
    function installAll(targets: string | undefined): Promise<Outcome> {
      consentInEnvironment(undefined);
      issued.length = 0;
      return refusalOf(
        runPluginInstallAll(
          { consent: targets === undefined ? NO_CONSENT : consentFor(targets) },
          context
        )
      );
    }

    /** What the last start logged of migrations it failed to apply. */
    let startLog = "";

    /**
     * A production start that runs its migrations, with the consent the
     * environment gives. A migration the step refuses is logged rather than
     * thrown, and the start then refuses to serve a plugin whose
     * schema the database is behind. That final error is what this answers,
     * so a refused module can never be mistaken for a served one, and the
     * last thing an operator reads names the module and the consent.
     */
    async function start(targets: string | undefined): Promise<Outcome> {
      startLog = "";
      await destroyRegisteredPlugins();
      clearServices();
      rebootProcessState();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      consentInEnvironment(targets);
      _resetEnvCache();
      issued.length = 0;
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
      const logged = errors.filter(line =>
        line.includes("Boot migrations failed")
      );
      startLog = logged.join("\n");
      if (logged.length === 0) {
        if (stopped !== undefined) throw stopped;
        return undefined;
      }
      // The start's FINAL error is the refusal an operator reads: the plugin
      // is behind, and it says the consent refused its migrations.
      expect(stopped).toMatchObject({
        code: "PLUGIN_SCHEMA_BEHIND",
        logContext: { plugin: PLUGIN, reason: "data-loss-consent" },
      });
      return (stopped as NextlyError).publicMessage;
    }

    /** The `migrate:down --plugin` command, over the plugin's newest applied module. */
    function migrateDown(targets: string | undefined): Promise<Outcome> {
      consentInEnvironment(undefined);
      issued.length = 0;
      return refusalOf(
        runMigrateDown(
          {
            step: 1,
            yes: true,
            plugin: PLUGIN,
            acceptDataLoss: targets,
            cwd: migrationsDir,
            quiet: true,
          },
          context
        )
      );
    }

    /**
     * Each road that applies a module, run with consent naming `targets` or
     * with none.
     */
    const ROADS = [
      { road: "nextly migrate", run: migrate },
      {
        road: "the migrations a production start runs",
        run: start,
      },
      { road: "plugins install", run: install },
    ] as const;

    /**
     * The refusal names the plugin, the module, the deletion and the consent
     * that would cover it, and came before any statement changing the
     * plugin's tables was sent.
     */
    function expectRefusal(
      refusal: Outcome,
      expected: {
        module: PluginMigration;
        deletion: string;
        /** The consent the refusal tells the operator to give. */
        consent: string;
      }
    ): void {
      expect(refusal).toBeDefined();
      expect(changesIssued()).toEqual([]);
      expect(refusal).toContain(key(expected.module));
      expect(refusal).toContain(PLUGIN);
      expect(refusal).toContain(expected.module.name);
      expect(refusal).toContain(expected.deletion);
      expect(refusal).toContain(`${CONSENT_ENV}=${expected.consent}`);
      expect(refusal).toContain(`--accept-data-loss=${expected.consent}`);
    }

    describe.each(ROADS)("through $road", ({ run: road }) => {
      it("refuses a module dropping its own column, keeping its values, and applies it with consent naming the column", async () => {
        const { module } = shipped.dropsColumn;
        const consent = `${NOTES}.summary`;
        ship(shipped.dropsColumn);

        expectRefusal(await road(undefined), {
          module,
          deletion: consent,
          consent,
        });
        expect(await noteValues("summary")).toEqual(["kept", "kept"]);
        expect(await appliedKeys()).toEqual([key(shipped.base)]);

        expect(await road(consent)).toBeUndefined();
        expect(await noteValues("summary")).toBeUndefined();
        expect(await noteValues("body")).toEqual(["b", "a"]);
        expect(await appliedKeys()).toEqual(
          [key(shipped.base), key(module)].sort()
        );
      }, 180_000);

      it("refuses a module removing rows from its own table, keeping every row, and applies it with consent naming the table", async () => {
        const { module } = shipped.removesRows;
        ship(shipped.removesRows);

        expectRefusal(await road(undefined), {
          module,
          deletion: REPLIES,
          consent: REPLIES,
        });
        expect(await ids(REPLIES)).toEqual(["r-new", "r-old"]);
        expect(await appliedKeys()).toEqual([key(shipped.base)]);

        expect(await road(REPLIES)).toBeUndefined();
        expect(await ids(REPLIES)).toEqual(["r-new"]);
        expect(await appliedKeys()).toEqual(
          [key(shipped.base), key(module)].sort()
        );
      }, 180_000);

      it("runs no module pending before the one it refuses, and runs both with consent", async () => {
        const { module, earlier = [] } = shipped.addsThenDrops;
        const consent = `${NOTES}.summary`;
        ship(shipped.addsThenDrops);

        expectRefusal(await road(undefined), {
          module,
          deletion: consent,
          consent,
        });
        // The module before it adds `extra` and deletes nothing: it did not
        // run either, and the ledger records neither.
        expect(await noteValues("extra")).toBeUndefined();
        expect(await noteValues("summary")).toEqual(["kept", "kept"]);
        expect(await appliedKeys()).toEqual([key(shipped.base)]);

        expect(await road(consent)).toBeUndefined();
        expect(await noteValues("extra")).toEqual([null, null]);
        expect(await noteValues("summary")).toBeUndefined();
        expect(await appliedKeys()).toEqual(
          [key(shipped.base), ...earlier.map(key), key(module)].sort()
        );
      }, 180_000);
    });

    it("ends a production start its migrations' consent refused with a final error naming the module, the deletion and the consent, as a start gives it", async () => {
      const { module } = shipped.dropsColumn;
      const consent = `${NOTES}.summary`;
      ship(shipped.dropsColumn);

      const final = await start(undefined);

      expect(final).toContain(
        `The plugin "${PLUGIN}" expects schema version 2, and the database has 1, because this start did not apply its pending migrations.`
      );
      // The consent check's own listing: the module by its ledger key, above
      // what it deletes.
      expect(final).toContain(`  ${key(module)}:\n    - `);
      expect(final).toContain(consent);
      // The step's own log line tells of the refusal before the start ends,
      // and ends on the same consent.
      expect(startLog).toContain(key(module));
      expect(startLog).toContain(
        `start with ${CONSENT_ENV}=${consent}, or run "nextly migrate --accept-data-loss=${consent}".`
      );
      expect(startLog).not.toContain("to resolve");
      expect(final).toContain(
        `start with ${CONSENT_ENV}=${consent}, or run "nextly migrate --accept-data-loss=${consent}".`
      );
      // The command that would be refused again is no longer what it ends on.
      expect(final).not.toContain(`nextly plugins install ${PLUGIN}`);
      expect(changesIssued()).toEqual([]);
      expect(await noteValues("summary")).toEqual(["kept", "kept"]);
      expect(await appliedKeys()).toEqual([key(shipped.base)]);
    }, 180_000);

    /** The other plugin as a release ships it, listed before the one under test. */
    const otherWith = (migrations: PluginMigration[]) =>
      definePlugin({
        name: OTHER.name,
        version: "1.0.0",
        nextly: ">=0.0.0",
        schemaVersion: migrations.length,
        contributes: {
          schema: { prefix: OTHER.prefix, tables: [things], migrations },
        },
      });

    it("installs no plugin listed before the one whose module an install of every plugin refuses", async () => {
      const { module } = shipped.dropsColumn;
      const consent = `${NOTES}.summary`;
      ship(shipped.dropsColumn);
      // Listed first, so its install comes before the refused plugin's.
      run.before = [otherWith([shipped.other])];

      expectRefusal(await installAll(undefined), {
        module,
        deletion: consent,
        consent,
      });
      expect(await adapter().tableExists(OTHER_TABLE)).toBe(false);
      expect(await noteValues("summary")).toEqual(["kept", "kept"]);
      expect(await appliedKeys()).toEqual([key(shipped.base)]);

      expect(await installAll(consent)).toBeUndefined();
      expect(await adapter().tableExists(OTHER_TABLE)).toBe(true);
      expect(await noteValues("summary")).toBeUndefined();
      expect(await appliedKeys()).toEqual(
        [
          qualifiedFilename(OTHER.name, shipped.other.name),
          key(shipped.base),
          key(module),
        ].sort()
      );
    }, 180_000);

    it("names every plugin's deleting module in the one refusal of an install of every plugin, with the one consent", async () => {
      const { module } = shipped.dropsColumn;
      const otherKey = qualifiedFilename(
        OTHER.name,
        shipped.otherRemovesRows.name
      );
      // The other plugin installed at its first module, with a row its next
      // module removes.
      run.before = [otherWith([shipped.other])];
      await runPluginInstall(OTHER.name, {}, context);
      await adapter().executeQuery(
        `INSERT INTO ${q(OTHER_TABLE)} (${q("id")}) VALUES ('t-old'), ('t-new')`
      );
      run.before = [otherWith([shipped.other, shipped.otherRemovesRows])];
      ship(shipped.dropsColumn);
      const both = `${OTHER_TABLE},${NOTES}.summary`;
      const unchanged = async () => {
        expect(await ids(OTHER_TABLE)).toEqual(["t-new", "t-old"]);
        expect(await noteValues("summary")).toEqual(["kept", "kept"]);
        expect(await appliedKeys()).toEqual(
          [
            qualifiedFilename(OTHER.name, shipped.other.name),
            key(shipped.base),
          ].sort()
        );
      };

      const refusal = await installAll(undefined);
      expectRefusal(refusal, {
        module,
        deletion: `${NOTES}.summary`,
        consent: both,
      });
      expect(refusal).toContain(otherKey);
      expect(refusal).toContain(OTHER_TABLE);
      expect(
        issued.filter(statement => /DELETE\s+FROM/i.test(statement))
      ).toEqual([]);
      await unchanged();

      // Consent for the first plugin's deletion alone: its module does not
      // run while the second plugin's deletion is left out.
      const partial = await installAll(OTHER_TABLE);
      expectRefusal(partial, {
        module,
        deletion: `${NOTES}.summary`,
        consent: both,
      });
      expect(
        issued.filter(statement => /DELETE\s+FROM/i.test(statement))
      ).toEqual([]);
      await unchanged();

      expect(await installAll(both)).toBeUndefined();
      expect(await ids(OTHER_TABLE)).toEqual(["t-new"]);
      expect(await noteValues("summary")).toBeUndefined();
    }, 180_000);

    it("refuses migrate:down over a module whose DOWN drops a column, keeping its values, and rolls it back with consent naming the column", async () => {
      const { module } = shipped.addsColumn;
      const consent = `${NOTES}.extra`;
      ship(shipped.addsColumn);
      // Adding a column deletes nothing, so the module applies with no consent.
      expect(await migrate(undefined)).toBeUndefined();
      await adapter().executeQuery(
        `UPDATE ${q(NOTES)} SET ${q("extra")} = 'kept'`
      );

      expectRefusal(await migrateDown(undefined), {
        module,
        deletion: consent,
        consent,
      });
      expect(await noteValues("extra")).toEqual(["kept", "kept"]);
      expect(await appliedKeys()).toEqual(
        [key(shipped.base), key(module)].sort()
      );

      expect(await migrateDown(consent)).toBeUndefined();
      expect(await noteValues("extra")).toBeUndefined();
      expect(await appliedKeys()).toEqual([key(shipped.base)]);
    }, 180_000);

    it("names the table a module's removal of rows cascades into, and refuses consent naming only the parent", async () => {
      const { module } = shipped.cascades;
      ship(shipped.cascades);

      const refusal = await migrate(NOTES);
      expect(await ids(NOTES)).toEqual(["n-new", "n-old"]);
      expect(await ids(REPLIES)).toEqual(["r-new", "r-old"]);
      expect(await appliedKeys()).toEqual([key(shipped.base)]);
      if (dialect === "sqlite") {
        // The runner applies a SQLite module with foreign keys off, so no
        // cascade fires and consent names the parent alone: the module runs,
        // the reply left pointing at a note that is gone refuses it, and it
        // is rolled back whole.
        expect(refusal).toContain(key(module));
        expect(refusal).toContain("referencing rows that do not exist");
        return;
      }
      expectRefusal(refusal, {
        module,
        deletion: REPLIES,
        consent: `${NOTES},${REPLIES}`,
      });

      expect(await migrate(`${NOTES},${REPLIES}`)).toBeUndefined();
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
