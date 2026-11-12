/**
 * Connecting `plugins install` / `plugins uninstall` to a config and a
 * database.
 *
 * Split from `plugin-lifecycle.ts` so the decisions there stay testable
 * without a connection, and from `plugins.ts` so that file keeps its
 * read-only introspection character — `list` and `info` never open a
 * database, and these two always do.
 *
 * @module cli/commands/plugin-lifecycle-runner
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { SupportedDialect } from "../../database/schema-registry";
import { container } from "../../di/container";
import {
  presetGrantsStanding,
  readPresetGrantsRelease,
} from "../../domains/meta/preset-grants-release";
import { pluginOfLedgerRow } from "../../domains/schema/events/ledger-scope";
import {
  appliedFilenames,
  newestEventsByFilename,
} from "../../domains/schema/events/newest-event";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  orderedMigrations,
  pluginModuleStatements,
  qualifiedFilename,
  type PluginMigration,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import type { PluginMigrationSet } from "../../domains/schema/migrate/plugin/run-plugin-migrations";
import type { OwnerRecord } from "../../domains/schema/ownership/owner-registry";
import {
  asLifecycleCommandBoot,
  readPluginLifecycle,
  recordPluginLifecycle,
  type PluginLifecycleRecord,
} from "../../domains/schema/ownership/plugin-lifecycle-state";
import { SchemaOwnersRepository } from "../../domains/schema/ownership/schema-owners-repository";
import { writeRegistryRows } from "../../domains/schema/schema-version";
import { NextlyError } from "../../errors/nextly-error";
import { getCoreVersion } from "../../plugins/core-version";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { SCHEMA_OWNERS_TABLE } from "../../schemas/schema-owners";
import { reportDryRun, type DryRunPlan } from "../dry-run";
import { plannedOrRefused } from "../dry-run-refusal";
import type { CommandContext } from "../program";
import { createCliAdapter, openCommandAdapter } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";
import { askToDeleteInTerminal } from "../utils/data-loss-consent";

import {
  downDatabaseDeps,
  rollbackDeletions,
  planRollback,
  refusalOf,
  rollBackOne,
  type PlannedDown,
} from "./migrate-down";
import {
  previewPluginInstall,
  previewPluginInstallAll,
  previewPluginUninstall,
  runPluginInstallAllCommand,
  runPluginInstallCommand,
  runPluginUninstallCommand,
  type InstallOptions,
  type LifecyclePlugin,
  type PluginLifecycleDeps,
  type PreparedModuleDown,
  type UninstallOptions,
} from "./plugin-lifecycle";
import { pluginModuleDown } from "./plugin-module-rollback";
import { readSqliteSchemaVersion, readTableIdentities } from "./table-identity";

interface RunnerOptions {
  config?: string;
  cwd?: string;
  /**
   * Show what the command would change and change nothing: the database is
   * opened read-only, and no lock, consent, hook or write follows.
   */
  dryRun?: boolean;
}

/**
 * The lifecycle view of each configured plugin.
 *
 * Read from the config rather than from the database: which plugins EXIST is
 * the config's answer, and the database only knows which ones have left
 * traces. An uninstall needs both, and conflating them is how a plugin that
 * was removed from config becomes impossible to uninstall.
 */
function toLifecyclePlugins(
  plugins: readonly PluginDefinition[]
): LifecyclePlugin[] {
  return plugins.map(plugin => ({
    name: plugin.name,
    version: plugin.version,
    enabled: plugin.enabled !== false,
    dependsOn: [
      ...(plugin.dependsOn ? Object.keys(plugin.dependsOn) : []),
      ...(plugin.optionalDependsOn
        ? Object.keys(plugin.optionalDependsOn)
        : []),
    ],
    requires: Object.keys(plugin.dependsOn ?? {}),
    optionallyRequires: Object.keys(plugin.optionalDependsOn ?? {}),
    declaredModules: pluginModules(plugin).map(module => module.name),
    modules: pluginModules(plugin).map(module => ({
      name: module.name,
      // A module with no DOWN on the live dialect cannot be undone. Checked
      // per dialect below, where the dialect is known.
      reversible: true,
    })),
    unshippedModules: [],
  }));
}

/**
 * A plugin's modules in apply order — the order `runPluginMigrations` applies
 * them in, from the one function that decides it. An uninstall undoes them in
 * the reverse of this, so a config listing them in another order cannot make
 * it undo a module before a later one that depends on it.
 */
function pluginModules(
  plugin: Pick<PluginDefinition, "contributes">
): PluginMigration[] {
  return orderedMigrations(plugin.contributes?.schema?.migrations ?? []);
}

/**
 * How long the command waits, after a plugin's `onInstall` or `onUninstall`,
 * for the event handlers it set off before shutting the runtime down: long
 * enough for a deletion's follow-up work, short enough that one handler that
 * never settles cannot hold the command open.
 */
const LIFECYCLE_HANDLER_WAIT_MS = 30_000;

/**
 * The statements a module's DOWN runs on one dialect, one per driver call —
 * the DOWN direction of `pluginModuleStatements`, which the apply path and
 * `migrate:down --plugin` read the same module through.
 */
export function pluginModuleDownStatements(
  module: Pick<PluginMigration, "dialects">,
  dialect: SupportedDialect
): string[] {
  return pluginModuleStatements(module, dialect, "down");
}

/**
 * Refuse a database `nextly migrate` has not yet set up.
 *
 * Both commands read the migration ledger and record into the owner
 * registry, and `nextly migrate` creates both. Without them, an install would
 * fail on a missing table part way through, after deciding nothing useful.
 */
/** The reason the refusal below records, which callers tell it apart by. */
const DATABASE_NOT_MIGRATED = "database-not-migrated";

/**
 * Whether `error` is the refusal of a database `nextly migrate` has not
 * prepared, which `nextly plugins add` reports as a step its build takes
 * rather than as a failure.
 */
export function isDatabaseNotMigrated(error: unknown): boolean {
  return (
    error instanceof NextlyError &&
    error.logContext?.reason === DATABASE_NOT_MIGRATED
  );
}

async function assertMigrated(adapter: DrizzleAdapter): Promise<void> {
  const required = ["nextly_schema_events", SCHEMA_OWNERS_TABLE];
  const present = await Promise.all(
    required.map(table => adapter.tableExists(table))
  );
  const missing = required.filter((_, at) => !present[at]);
  if (missing.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message:
      'This database has not been migrated yet. Run "nextly migrate" before installing or uninstalling a plugin.',
    logContext: { reason: DATABASE_NOT_MIGRATED, missing },
  });
}

/** The core table the release that set the preset grants is recorded in. */
const PRESET_GRANTS_RECORD_TABLE = "nextly_meta";

/**
 * Refuse, in production, a run from a Nextly release older than the one that
 * set the preset roles' grants (`preset-grants-release`), before it writes
 * anything, naming the release to run it from.
 *
 * An install sets every preset role's grants with the release record, and an
 * older release would leave them as the newer one set them, so its install
 * would record the plugin installed, which is what lets a production start
 * serve it, without the grants its permissions are owed. An uninstall from it
 * is refused the same way, so neither command writes from an older release.
 * Production is decided as for a start: anything but Nextly's development
 * mode. A development run goes on, its preset grants left as they are.
 */
async function refuseFromAnOlderRelease(
  adapter: DrizzleAdapter,
  logger: CommandContext["logger"]
): Promise<void> {
  if (process.env.NODE_ENV === "development") return;
  // A database without the table the record is kept in holds no record, so no
  // newer release has set the preset grants there. Asked of the database
  // rather than inferred from a failed read, which could fail for any reason.
  if (!(await adapter.tableExists(PRESET_GRANTS_RECORD_TABLE))) return;
  // Loaded here, as the command's other services are: a file that imports
  // this module for its types or helpers does not load the services with it.
  const { MetaService } = await import(
    "../../domains/meta/services/meta-service"
  );
  const recorded = await readPresetGrantsRelease(
    new MetaService(adapter, {
      debug: m => logger.debug(m),
      info: m => logger.debug(m),
      warn: m => logger.warn(m),
      error: m => logger.error(m),
    })
  );
  const running = getCoreVersion();
  // The one decision of how a release stands against the recorded one.
  const standing = presetGrantsStanding(recorded, running);
  if (standing.kind === "set") return;
  throw NextlyError.conflict({
    reason: "state",
    message:
      `The preset roles' grants were set by Nextly ${standing.recorded}, newer than this release (${running}). ` +
      `Run this command from Nextly ${standing.recorded} or newer.`,
    logContext: {
      reason: "preset-grants-set-by-a-newer-release",
      recorded: standing.recorded,
      running,
    },
  });
}

async function connect(options: RunnerOptions, context: CommandContext) {
  const {
    config,
    configPath,
    appConfig,
    pluginConsent,
    projectRoot,
    fieldsAddedByPlugins,
  } = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });
  // A dry run opens the database read-only; one whose database is not there
  // has said so, and ends here.
  const adapter =
    options.dryRun === true
      ? await openCommandAdapter({ dryRun: true }, context.logger)
      : await createCliAdapter({});
  if (adapter === undefined) return undefined;
  const dialect = adapter.dialect;
  const plugins = toLifecyclePlugins(config.plugins ?? []);

  // Reversibility is a per-DIALECT fact: a module may ship DOWN statements for
  // PostgreSQL and none for SQLite, and an uninstall on the second cannot be
  // completed however complete the first would be.
  const definitions = config.plugins ?? [];

  // Which modules this database has actually APPLIED.
  //
  // The uninstall plan was built from every DECLARED module, so a plugin
  // installed at v1 whose config had since gained a v2 module scheduled v2's
  // DOWN first — dropping a column or table that module never created. The
  // DOWN failed, and because it ran before v1's, the plugin could not be
  // uninstalled at all.
  //
  // Newest row per filename decides it, not the first: `migrate:down` records
  // a rollback by INSERTING a `rolled_back` event after the `applied` one, so
  // the latest state is what "is this applied?" asks. `appliedFilenames` is
  // that rule, shared with `migrate:down`, so the two cannot drift.
  const readAppliedModules = async (): Promise<Set<string>> => {
    const events = new SchemaEventsRepository(
      (adapter as unknown as DrizzleAdapter).getDrizzle(),
      dialect
    );
    return appliedFilenames(
      (await events.listFileApplies()).filter(row =>
        row.filename?.startsWith("plugin:")
      )
    );
  };

  /**
   * Re-derive every plugin's module list from the ledger.
   *
   * A function rather than a value because the answer can change: this reads
   * the ledger, and the uninstall does not hold the migrate lock until later.
   * A list taken at connect time could omit a module another migration applied
   * in between, and the uninstall would then mark the plugin uninstalled while
   * leaving that module's schema and its applied row behind.
   */
  const refreshPlan = async (): Promise<void> => {
    const applied = await readAppliedModules();
    for (const plugin of plugins) {
      const source = definitions.find(d => d.name === plugin.name);
      const modules = (source ? pluginModules(source) : []).filter(module =>
        applied.has(qualifiedFilename(plugin.name, module.name))
      );
      plugin.modules = modules.map(module => ({
        name: module.name,
        // Judged on the statements `runDown` would execute, so "reversible"
        // and "what the rollback runs" cannot disagree about a DOWN whose
        // entries split to nothing.
        reversible: pluginModuleDownStatements(module, dialect).length > 0,
      }));
      // Applied modules the configured definition no longer ships: their
      // DOWN is nowhere to be read, so leaving them out would undo the rest
      // and report a full uninstall over their schema and ledger rows.
      const shipped = new Set(modules.map(module => module.name));
      plugin.unshippedModules = [...applied]
        .filter(filename => pluginOfLedgerRow(filename) === plugin.name)
        .map(filename => filename.slice(filename.lastIndexOf("/") + 1))
        .filter(moduleName => !shipped.has(moduleName));
    }
  };

  // `connect` hands the adapter back only once it has finished, so what
  // throws before then disconnects it here; the callers' `finally` never
  // sees it.
  try {
    await assertMigrated(adapter as unknown as DrizzleAdapter);
    // Refused before anything else is decided, the dry run included, which
    // reports the refusal the command would meet.
    await refuseFromAnOlderRelease(
      adapter as unknown as DrizzleAdapter,
      context.logger
    );
    await refreshPlan();
  } catch (error) {
    await adapter.disconnect();
    throw error;
  }

  const drizzleAdapter = adapter as unknown as DrizzleAdapter;

  /**
   * The plans the latest `prepareDowns` made, by ledger key. `runDown` runs
   * the plan `prepareDowns` judged, so what ran is what was judged.
   */
  let planned = new Map<string, PlannedDown>();

  /**
   * The database side `migrate:down --plugin` runs with, for one plugin.
   * Built per use rather than kept: it holds a Drizzle handle, and the
   * lifecycle hook boots and tears down the runtime between the plan and
   * the DOWNs.
   */
  const rollbackDeps = (plugin: LifecyclePlugin) =>
    downDatabaseDeps({
      adapter: drizzleAdapter,
      dialect,
      plugin: {
        name: plugin.name,
        migrations:
          definitions.find(d => d.name === plugin.name)?.contributes?.schema
            ?.migrations ?? [],
      },
      command: "plugins uninstall",
    });

  /**
   * Every module's DOWN for an uninstall, verified and judged before any of
   * them runs — through the planner and the refusals `migrate:down --plugin`
   * uses, so the two rollback paths cannot disagree about what a DOWN holds
   * or what it may drop.
   *
   * Each module is read from the plugin's own definition and verified as the
   * module that was applied (`pluginModuleDown`): it must still match the
   * checksum it was sealed with and the one its applied ledger row recorded,
   * because the DOWN about to run is taken from the definition as it is now.
   *
   * Every module is judged before the first one runs, so a refusal of an
   * older module cannot come after a newer one's DOWN has committed. A
   * plugin's DOWN is its own code, and nothing else constrains what it
   * drops: unguarded, an uninstall could drop an app-owned or another
   * plugin's table, which is where the data is least recoverable.
   */
  const prepareDowns = async (
    plugin: LifecyclePlugin,
    moduleNames: readonly string[]
  ): Promise<PreparedModuleDown[]> => {
    const definition = definitions.find(d => d.name === plugin.name);
    const migrations = definition?.contributes?.schema?.migrations ?? [];
    const newest = newestEventsByFilename(
      await new SchemaEventsRepository(
        drizzleAdapter.getDrizzle(),
        dialect
      ).listFileApplies()
    );
    const deps = await rollbackDeps(plugin);
    const filenames = moduleNames.map(moduleName =>
      qualifiedFilename(plugin.name, moduleName)
    );
    const plans = await planRollback(filenames, {
      ...deps,
      readDownSql: filename =>
        Promise.resolve(
          pluginModuleDown({
            pluginName: plugin.name,
            migrations,
            filename,
            recordedSha: newest.get(filename)?.sha256,
            dialect,
          })
        ),
    });
    for (const down of plans) {
      const refusal = refusalOf(down, {
        ...deps,
        options: { plugin: plugin.name },
      });
      if (refusal !== undefined) throw refusal;
    }
    planned = new Map(plans.map(down => [down.filename, down]));
    // Each module's DOWN judged by the reader `migrate:down` names a
    // rollback's deletions with, every module read as one run in the order
    // they run: a module that removes rows, converts a column or calls code
    // that may delete is destructive, as one that drops is.
    const deletions = await rollbackDeletions(
      plans,
      dialect,
      deps.readDeletionFacts
    );
    return plans.map((down, at) => ({
      moduleName: moduleNames[at],
      filename: down.filename,
      statements: down.statements,
      transaction: down.transaction,
      deletions: deletions[at] ?? [],
    }));
  };

  /**
   * Undo one prepared module through `migrate:down`'s own executor
   * (`rollBackOne`): in one transaction unless the module is marked
   * `transaction: false`, with its `rolled_back` row and the plugin's schema
   * version written through the handle it ran on, and a failure recorded as
   * a failed rollback under the module's ledger key.
   */
  const runDown = async (
    plugin: LifecyclePlugin,
    down: PreparedModuleDown
  ): Promise<number> => {
    const plan = planned.get(down.filename);
    if (plan === undefined) {
      throw NextlyError.internal({
        logContext: {
          reason: "uninstall DOWN run without a plan",
          filename: down.filename,
        },
      });
    }
    await rollBackOne(plan, {
      ...(await rollbackDeps(plugin)),
      logger: context.logger,
      options: { plugin: plugin.name },
    });
    return plan.statements.length;
  };

  /**
   * Runs `work` under the migrate lock `migrate` takes, waiting for a
   * migration that holds it, and refuses with a CONFLICT when the lock stayed
   * held throughout — `notRun` says what did not happen, in the message
   * "Another migration is holding the migrate lock, so <notRun>."
   */
  const withLockOrRefuse = async <T>(
    work: () => Promise<T>,
    notRun: string,
    logContext: Record<string, unknown>
  ): Promise<T> => {
    const { withMigrateLock } = await import(
      "../../domains/schema/pipeline/locks"
    );
    const outcome = await withMigrateLock(drizzleAdapter, dialect, work, {
      // The schema lock, which `migrate` and every other schema change take. A held one is
      // waited for, about a minute, and then the command stops naming its holder.
      command: "nextly plugins install/uninstall",
      mode: "wait",
      logger: {
        warn: m => context.logger.warn(m),
        info: m => context.logger.info(m),
      },
    });
    if (!outcome.ran) {
      throw new NextlyError({
        code: "CONFLICT",
        publicMessage:
          `Another migration is holding the migrate lock, so ${notRun}. ` +
          "Nothing was changed — re-run once it finishes.",
        logContext: {
          ...logContext,
          reason: "plugin-lifecycle-lock-busy",
          outcome: outcome.reason,
        },
      });
    }
    return outcome.value;
  };

  /**
   * Runs `work` under the migrate lock `migrate` takes, after re-reading
   * every plugin's module list from the ledger.
   *
   * The re-read is inside the lock because the plan taken at connect time
   * predates it: a module applied in between would be missing from it, and
   * the uninstall would then record the plugin uninstalled with that
   * module's schema still in the database.
   *
   * `mode: "wait"`: nothing inside waits on an operator — every refusal is
   * decided before this is called — so waiting for a running migration to
   * finish is cheaper than telling the operator to try again.
   */
  const underMigrateLock = <T>(work: () => Promise<T>): Promise<T> =>
    withLockOrRefuse(
      async () => {
        await refreshPlan();
        // Decided again under the lock, where it holds: a newer release's
        // `nextly migrate` may have recorded itself since `connect` read it.
        await refuseFromAnOlderRelease(drizzleAdapter, context.logger);
        return work();
      },
      "nothing was run",
      {}
    );

  /**
   * The module sets an install of `plugin` applies (`applyMigrations`):
   * none when it ships no modules. Read once for the consent and the run, so
   * the two judge and apply the same modules.
   */
  const installSets = async (
    plugin: LifecyclePlugin
  ): Promise<PluginMigrationSet[]> => {
    const definition = definitions.find(d => d.name === plugin.name);
    const modules = definition?.contributes?.schema?.migrations ?? [];
    if (definition === undefined || modules.length === 0) return [];
    const { pluginMigrationSetsFrom } = await import(
      "../../domains/schema/migrate/plugin/run-plugin-migrations"
    );
    // The plugin AND the dependencies it declares.
    //
    // `pluginMigrationSetsFrom` topologically sorts what it is given and
    // refuses a plugin whose required `dependsOn` is absent from that input —
    // so passing the target alone made `plugins install` fail outright for
    // every plugin that declares one. The configured definitions are right
    // here; the set just was not being built from them.
    //
    // Transitive, because a dependency may declare its own.
    const withDependencies = new Map<string, PluginDefinition>();
    const collect = (plugin: PluginDefinition): void => {
      if (withDependencies.has(plugin.name)) return;
      withDependencies.set(plugin.name, plugin);
      for (const dependency of [
        ...Object.keys(plugin.dependsOn ?? {}),
        ...Object.keys(plugin.optionalDependsOn ?? {}),
      ]) {
        const found = definitions.find(d => d.name === dependency);
        if (found) collect(found);
      }
    };
    collect(definition);

    // Sorted WITH the dependencies, applied WITHOUT them.
    //
    // The sort needs them or it refuses the target outright. Applying them is
    // a different matter: `runPluginMigrations` acts on every set it is given,
    // so passing the dependencies' modules would apply a dependency's schema
    // while owner rows and `onInstall` run for the target alone — a
    // dependency half-installed as a side effect of installing something
    // else. `pluginsWithMigrations` does not prevent that; it gates a
    // different check.
    //
    // Only the target's set is applied. That the dependencies are installed
    // is not left to this step to discover — the target's SQL fails only when
    // it happens to touch a dependency's table — but checked explicitly by
    // `runPluginInstallCommand` before this runs, which refuses and names
    // each dependency to install first.
    const sorted = await pluginMigrationSetsFrom([
      ...withDependencies.values(),
    ]);
    return sorted.filter(set => set.pluginName === definition.name);
  };

  /** What the modules an install of `plugin` applies delete (`PluginLifecycleDeps.installDeletions`). */
  const installDeletions = async (plugin: LifecyclePlugin) => {
    const sets = await installSets(plugin);
    if (sets.length === 0) return [];
    const { pendingPluginDeletions } = await import("./migrate");
    return pendingPluginDeletions(sets, {
      adapter,
      db: drizzleAdapter.getDrizzle(),
      dialect,
    });
  };

  /**
   * Apply this plugin's pending modules, through the phase `migrate` uses.
   *
   * Not a second implementation: `runPluginPhase` owns the ledger, the drop
   * guard and the owner records, and an install that applied modules its own
   * way would record them differently from every later `migrate`. Scoped to
   * the one plugin being installed, which is the only difference.
   *
   * The caller holds the migrate lock (`underMigrateLock`), as `migrateCore`
   * does around the same phase: install keeps it from before the modules
   * apply until after `onInstall`, so an uninstall cannot run in between.
   */
  const applyMigrations = async (plugin: LifecyclePlugin): Promise<void> => {
    const pluginMigrationSets = await installSets(plugin);
    if (pluginMigrationSets.length === 0) return;
    const { runPluginPhase } = await import("./migrate");

    const { compileExtensionSchema } = await import(
      "../../domains/schema/extension/publish"
    );
    const extensionSchema = await compileExtensionSchema({
      dialect,
      plugins: definitions,
      config,
      // The connected server's limits: refuse constructs it cannot hold
      // before plugin installation runs any migration.
      server: drizzleAdapter.getCapabilities(),
      logger: { warn: m => context.logger.warn(m) },
    });

    await runPluginPhase({
      extensionSchema,
      dialect,
      db: drizzleAdapter.getDrizzle(),
      adapter,
      migrationsDir: config.db?.migrationsDir ?? "./src/db/migrations",
      logger: context.logger,
      pluginsWithMigrations: new Set([plugin.name]),
      pluginMigrationSets,
    });
  };

  /**
   * Which of `tables` exist now. An owner row outlives its table when
   * `migrate:down --plugin` rolled the module back: the row is kept as
   * ownership history, and the table is gone.
   */
  const liveTables = async (
    tables: readonly string[]
  ): Promise<ReadonlySet<string>> => {
    const present = await Promise.all(
      tables.map(async table =>
        (await drizzleAdapter.tableExists(table)) ? table : undefined
      )
    );
    return new Set(present.filter(table => table !== undefined));
  };

  /** Which table each of `tables` reaches now (`readTableIdentities`). */
  const tableIdentities = (
    tables: readonly string[]
  ): Promise<ReadonlyMap<string, string | null>> =>
    readTableIdentities(drizzleAdapter, dialect, tables);

  /** SQLite's schema version (`readSqliteSchemaVersion`). */
  const schemaVersion = (): Promise<number | null> =>
    readSqliteSchemaVersion(drizzleAdapter);

  /**
   * Run one plugin's own `onInstall` / `onUninstall` against a real context.
   *
   * Supplied rather than left undefined: while the command called this
   * optionally and nothing passed it, every install reported the hook done
   * and no hook ran — a plugin that seeds a row or registers with an external
   * service in `onInstall` got neither.
   *
   * The hook takes a `PluginContext`, and the only thing that builds one is
   * `registerServices` — so running it means booting the runtime, which no
   * other CLI command does. Two things keep that proportionate:
   *
   * - The boot happens ONLY when this plugin actually declares the hook.
   *   Most do not, and those installs stay exactly as cheap as before.
   * - It reuses the adapter this command already opened, so the boot does not
   *   make a second connection, and the teardown runs in a `finally`: an
   *   install that fails inside a hook — or inside the boot itself — must not
   *   leave running plugins or a registered container behind.
   *
   * Every plugin's `init()` runs during that boot, which is the point — the
   * hook is documented as running against a booted context, and one booted
   * without its siblings is not the context the plugin will live in.
   */
  const runLifecycleHook = async (
    plugin: LifecyclePlugin,
    hook: "onInstall" | "onUninstall",
    opts: { keepData: boolean },
    beforeHook?: () => Promise<void>
  ): Promise<void> => {
    const definition = definitions.find(d => d.name === plugin.name);
    if (definition?.[hook] === undefined) return;

    const {
      registerServices,
      getInitializedPluginContext,
      clearServices,
      destroyRegisteredPlugins,
    } = await import("../../di/register");
    const { isServicesRegistered } = await import("../../di/service-access");
    const { buildServiceConfig } = await import(
      "../../init/build-service-config"
    );
    const { getImageProcessor } = await import("../../storage/image-processor");
    const { getHookRegistry } = await import("../../hooks/hook-registry");
    const { getEventBus } = await import("../../events/event-bus");

    // A registration this command did not make is not this command's to tear
    // down. `registerServices` refuses when one exists, and the cleanup below
    // would otherwise destroy that owner's plugins and clear its container on
    // the way out of the refusal.
    if (isServicesRegistered()) {
      throw new NextlyError({
        code: "CONFLICT",
        publicMessage: `Services are already registered in this process, so ${plugin.name}'s ${hook} was not run.`,
        logContext: {
          reason: "plugin-hook-services-registered",
          plugin: plugin.name,
          hook,
        },
      });
    }

    // What the hook sets off is traced to this, and whether it all finished
    // in time decides, after the teardown, whether the command goes on.
    const cause = Symbol(`${plugin.name} ${hook}`);
    let handlersFinished = true;
    try {
      // Inside the `try`, so the cleanup covers a registration that fails
      // part way. Plugins initialize before registration finishes, so one
      // that throws after that point leaves their `init()` work running with
      // the registered flag never set — and a `registerServices` outside the
      // `try` skipped the cleanup exactly then.
      // As the lifecycle command's boot: the install-state gate would refuse
      // the very plugin this command is installing or uninstalling.
      await asLifecycleCommandBoot(plugin.name, () =>
        registerServices({
          ...buildServiceConfig({
            // The config as the app wrote it. The boot runs every `setup`
            // transformer and contribution fold itself; booting from the
            // loader's `config`, which holds their result, ran each twice, so
            // a transformer that adds a plugin or a collection added it again.
            //
            // Boot migrations off: the hook runs inside the command's migrate
            // lock, which this process may take again, so a boot that
            // migrated would apply a pending module after the uninstall had
            // fixed which ones to undo, on every dialect.
            config: {
              ...appConfig,
              db: { ...appConfig.db, runMigrationsOnBoot: false },
            },
            // The grants the loader read before any `setup` transformer ran.
            pluginConsent,
            adapter: drizzleAdapter,
            imageProcessor: getImageProcessor(),
            hookRegistry: getHookRegistry(),
            logger: context.logger,
          }),
          // The project `--cwd` names, not the directory the CLI ran in: the
          // start check judges the Next.js and React that app installs.
          appRoot: projectRoot,
        })
      );
      const pluginContext = getInitializedPluginContext(plugin.name);
      if (pluginContext === undefined) {
        // Registered, but this plugin was not among the initialized ones —
        // it is disabled in config. Saying so beats running nothing quietly.
        context.logger.warn(
          `${plugin.name} is disabled in config, so ${hook} was not run.`
        );
        return;
      }
      // After the boot, which can change the schema itself, and right before
      // the hook: what the caller reads here is what the hook started from.
      await beforeHook?.();
      // Branched rather than called through `definition[hook]`: the two hooks
      // take different arguments, and a union of them accepts neither call.
      // Run under the hook's cause, so every event it sets off, and every one
      // their handlers emit in turn, is waited for below.
      await getEventBus().runCaused(cause, () =>
        hook === "onInstall"
          ? definition.onInstall?.(pluginContext)
          : definition.onUninstall?.(pluginContext, opts)
      );
    } finally {
      // `destroyRegisteredPlugins` + `clearServices`, NOT `shutdownServices`.
      //
      // Both leave the container unregistered, which is all this needs — a
      // registered one would make the next `registerServices` in the process
      // throw. The difference is that `shutdownServices` also DISCONNECTS the
      // adapter, and this command is not finished with it: an install still
      // has owner rows to record and an uninstall still has DOWN statements to
      // run, both through a Drizzle handle bound to that pool. Reconnecting
      // afterwards did not save it — the handle still pointed at the closed
      // pool — and on MySQL closing the pool also releases the connection-
      // bound migrate lock this command is holding, letting another migration
      // in while the DOWNs run.
      //
      // `destroy()` still runs, through the same helper `shutdownServices`
      // uses. Skipping it left whatever `init()` started running in a process
      // that has finished its work, which can keep a one-shot CLI alive. Both
      // calls are safe after a registration that failed part way: the helper
      // destroys only the plugins that registration recorded (none, if it
      // failed before initializing them), and `clearServices` resets whatever
      // was registered, however much that was.
      //
      // First, the handlers of the events the hook set off are let finish,
      // their own follow-up events included. Emitting is fire-and-forget, so
      // another plugin's handler (removing what it kept about each account an
      // uninstall reports deleted, say) is still running when the hook
      // returns; torn down under it, that work would stop part way. Only
      // those traced to the hook: a producer a plugin started in `init()` and
      // stops in `destroy()` never lets the bus empty. And for a bounded
      // time, so a handler that never settles cannot hold the command open.
      handlersFinished = await getEventBus().settleCaused(
        cause,
        LIFECYCLE_HANDLER_WAIT_MS
      );
      await destroyRegisteredPlugins();
      clearServices();
    }
    // Failed after the teardown, never before it. The command goes no further
    // with work still running that the hook set off: an uninstall's DOWNs
    // would drop the tables that work was reading. Its state stays
    // `uninstalling`, so running it again finishes it.
    if (!handlersFinished) {
      throw new NextlyError({
        code: "CONFLICT",
        publicMessage: `Event handlers that ${plugin.name}'s ${hook} set off were still running after ${LIFECYCLE_HANDLER_WAIT_MS / 1000}s, so the command stopped there. Run it again once what they do can finish.`,
        logContext: {
          reason: "plugin-hook-handlers-running",
          plugin: plugin.name,
          hook,
        },
      });
    }
  };

  /**
   * Every plugin's recorded state, and the write of one: through the
   * lifecycle-state module, the one place either is decided.
   */
  const readLifecycle = async (): Promise<
    ReadonlyMap<string, PluginLifecycleRecord>
  > =>
    readPluginLifecycle(
      new SchemaEventsRepository(drizzleAdapter.getDrizzle(), dialect),
      await new SchemaOwnersRepository(
        drizzleAdapter.getDrizzle(),
        dialect
      ).read()
    );
  /**
   * The access a recorded state brings with it, written in the transaction
   * that records the state, or nothing for a state that brings none.
   *
   * - `installed`: the plugin's declared permissions and roles, and every
   *   preset role's grants with the release record, as `nextly migrate` from
   *   this release sets them (`seedAccessOnCommandConnection`). A plugin
   *   recorded installed, which is what lets a production start serve it,
   *   then has its access whether or not a `nextly migrate` follows. Its
   *   permissions come from the plugin being installed alone, so the install
   *   never declares again a permission that another owner's recorded change
   *   or uninstall orphaned; re-ensuring its own clears their marks, which is
   *   what a reinstall does. The preset grants must be set, or the install
   *   fails (`withPresetGrantsRequired`).
   * - `uninstalled` and `orphaned` (kept data): the plugin's permissions
   *   marked orphaned, every grant kept
   *   (`orphanOwnedPermissionsOnCommandConnection`). No preset grant is set
   *   and no release recorded.
   */
  const accessOf = (
    plugin: LifecyclePlugin,
    record: PluginLifecycleRecord
  ): (() => Promise<void>) | undefined => {
    if (record.state === "installed") {
      const installing = {
        ...config,
        // The app's own permissions and roles come with `nextly migrate`.
        permissions: [],
        roles: [],
        plugins: definitions.filter(d => d.name === plugin.name),
      };
      return async () => {
        // Loaded when a state is recorded, not with this module: the seeding
        // reaches every permission and role service.
        const [
          { withPresetGrantsRequired },
          { seedAccessOnCommandConnection },
        ] = await Promise.all([
          import("../../database/seeders/role-presets"),
          import("../../domains/schema/migrate/command-access"),
        ]);
        await withPresetGrantsRequired(() =>
          seedAccessOnCommandConnection(
            drizzleAdapter,
            { config: installing, configPath },
            context.logger,
            // The plugin being installed, whatever its record says until this
            // transaction writes it: a reinstall declares it again.
            { pluginsAsGiven: true }
          )
        );
      };
    }
    if (record.state === "uninstalled" || record.state === "orphaned") {
      return async () => {
        const { orphanOwnedPermissionsOnCommandConnection } = await import(
          "../../domains/schema/migrate/command-access"
        );
        await orphanOwnedPermissionsOnCommandConnection(
          drizzleAdapter,
          plugin.name,
          config,
          context.logger
        );
      };
    }
    return undefined;
  };

  // The record and the stored schema version in one transaction: an install
  // or an uninstall changes the schema the app serves, so the version's count
  // moves with the record that says it happened (`writeRegistryRows`). The
  // access the state brings (`accessOf`) is written first on the same
  // transaction, so a state is never recorded without it, nor it without the
  // state.
  const recordLifecycle = async (
    plugin: LifecyclePlugin,
    record: PluginLifecycleRecord
  ): Promise<void> => {
    const access = accessOf(plugin, record);
    // A process that already started an instance (a test that booted one) has
    // the services a grants change reaches registered on that instance's own
    // connection, which would wait behind this transaction's locks. There the
    // access is written just before the transaction, as `nextly migrate`'s
    // first-run commit does; the command itself starts none.
    const inside = !container.has("adapter");
    if (!inside) await access?.();
    await writeRegistryRows(drizzleAdapter, async tx => {
      if (inside) await access?.();
      await recordPluginLifecycle(
        new SchemaEventsRepository(tx.getDrizzle(), dialect),
        plugin.name,
        record
      );
    });
  };

  return {
    adapter,
    dialect,
    applyMigrations,
    installDeletions,
    readLifecycle,
    recordLifecycle,
    // Read PER ACCESS, never captured. The same cast `migrate` makes —
    // `CLIDatabaseAdapter` is deliberately connect/disconnect/dialect, and the
    // Drizzle handle underneath it is what any command touching data needs —
    // but a handle taken once wraps the pool that existed then, and the
    // lifecycle hook path tears the container down between uses.
    get db() {
      return drizzleAdapter.getDrizzle();
    },
    plugins,
    definitions,
    refreshPlan,
    readAppliedModules,
    liveTables,
    tableIdentities,
    schemaVersion,
    runLifecycleHook,
    migrationsDir: config.db?.migrationsDir,
    logger: context.logger,
    prepareDowns,
    runDown,
    underMigrateLock,
    // A full uninstall without consent asks the person at a terminal, and is
    // refused at once where nobody can answer: no terminal, `CI` set, or
    // `--non-interactive`.
    interactive: canPrompt(),
    askToDelete: askToDeleteInTerminal,
    // What other owners built on or into the plugin's schema. Loaded when an
    // uninstall asks: nothing else in a command needs the dependents' reader.
    schemaDependents: async (
      plugin: LifecyclePlugin,
      owned: readonly OwnerRecord[]
    ) => {
      const definition = definitions.find(d => d.name === plugin.name);
      const [
        { databaseDependentsSources },
        { findUninstallDependents, pluginEntities },
        { installRegistryResolver },
      ] = await Promise.all([
        import("../../domains/collections/services/collection-dependents"),
        import("../../domains/schema/ownership/uninstall-dependents"),
        import("../utils/registry-resolver"),
      ]);
      // The field registries are read by name through the adapter, which a
      // command has no boot to teach them to: without a resolver the read
      // refuses, and the guard, failing closed, would refuse every full
      // uninstall. Installed on a view of the adapter that shares its
      // connection, not on the adapter: a resolver naming only core tables
      // would make the command's later writes by name (the migrate lock row)
      // refuse a table it does not list.
      const reader = Object.create(drizzleAdapter) as typeof drizzleAdapter;
      installRegistryResolver(reader);
      // What it owns, by the names a host's renames gave it, and the fields
      // the fold's ledgers record it adding to other owners' entities.
      const own = await pluginEntities(definition, fieldsAddedByPlugins);
      const { compileExtensionSchema } = await import(
        "../../domains/schema/extension/publish"
      );
      const extensionSchema = await compileExtensionSchema({
        dialect,
        plugins: definitions,
        config,
        logger: { warn: m => context.logger.warn(m) },
      });
      return findUninstallDependents({
        pluginName: plugin.name,
        owned,
        collectionSlugs: own.collectionSlugs,
        collectionSlugForTable: own.collectionSlugForTable,
        // Its own Singles and field groups go with it, and so do their
        // fields, as do the fields its `extend` added to other entities.
        ownEntities: {
          single: own.single,
          fieldGroup: own.fieldGroup,
          extendedFields: own.extendedFields,
        },
        sources: databaseDependentsSources(reader, () =>
          Promise.resolve(extensionSchema ?? null)
        ),
        recordedRowsOn: tables =>
          new SchemaOwnersRepository(drizzleAdapter.getDrizzle(), dialect).read(
            [...tables]
          ),
        // Every table's indexes, keys and checks, through the schema
        // pipeline's introspection: a key pointing in can sit on any table,
        // its owner's or nobody's, and an element's definition is judged as
        // the database holds it.
        liveSchema: async () => {
          const { introspectLiveSnapshot } = await import(
            "../../domains/schema/pipeline/diff/introspect-live"
          );
          const snapshot = await introspectLiveSnapshot(
            drizzleAdapter.getDrizzle(),
            dialect,
            await drizzleAdapter.listTables()
          );
          return snapshot.tables;
        },
      });
    },
    // A fully uninstalled plugin leaves its lifecycle record and nothing
    // else: its settings, ledger module rows and owner rows go, so a later
    // install starts from nothing. Each delete is a no-op when run again.
    forgetPlugin: async (plugin: LifecyclePlugin) => {
      // Loaded here: the settings tables module carries every dialect's.
      const [{ pluginSettingsTables }, { eq }] = await Promise.all([
        import("../../schemas/plugin-settings"),
        import("drizzle-orm"),
      ]);
      const { nextlyPluginSettings } = pluginSettingsTables(dialect);
      await drizzleAdapter
        .getDrizzle<SettingsDeleteDb>()
        .delete(nextlyPluginSettings)
        .where(eq(nextlyPluginSettings.owner, plugin.name));
      await new SchemaEventsRepository(
        drizzleAdapter.getDrizzle(),
        dialect
      ).deletePluginModuleRows(plugin.name);
      // Its rows only: another owner may share its name.
      await new SchemaOwnersRepository(
        drizzleAdapter.getDrizzle(),
        dialect
      ).deletePluginOwner(plugin.name);
    },
    // Every element the schema pipeline's own introspection reads, so an
    // element is judged present exactly as a push would see it.
    liveElements: async (tables: readonly string[]) => {
      const { introspectLiveSnapshot } = await import(
        "../../domains/schema/pipeline/diff/introspect-live"
      );
      const snapshot = await introspectLiveSnapshot(
        drizzleAdapter.getDrizzle(),
        dialect,
        [...tables]
      );
      return new Map(
        snapshot.tables.map(table => [
          table.name,
          [
            ...table.columns.map(({ name }) => ({
              kind: "column" as const,
              name,
            })),
            ...(table.indexes ?? []).map(({ name }) => ({
              kind: "index" as const,
              name,
            })),
            ...(table.foreignKeys ?? []).map(({ name }) => ({
              kind: "fk" as const,
              name,
            })),
            ...(table.checks ?? []).map(({ name }) => ({
              kind: "check" as const,
              name,
            })),
          ],
        ])
      );
    },
    // Read through the schema pipeline's own introspection, so a column is
    // judged present exactly as a push would see it.
    liveColumns: async (tables: readonly string[]) => {
      const { introspectLiveColumns } = await import(
        "../../domains/schema/pipeline/diff/introspect-live"
      );
      const snapshot = await introspectLiveColumns(
        drizzleAdapter.getDrizzle(),
        dialect,
        [...tables]
      );
      return new Map(
        snapshot.tables.map(table => [
          table.name,
          new Set(table.columns.map(column => column.name)),
        ])
      );
    },
  };
}

/** The one statement forgetting a plugin's settings needs from a Drizzle handle. */
interface SettingsDeleteDb {
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/**
 * A plugin command's dry run: connected read-only, `plan` worked out from the
 * command's own reads and reported, or the refusal the real command would
 * meet, connecting included (a database `nextly migrate` has not prepared).
 */
async function reportPluginDryRun(
  options: RunnerOptions,
  context: CommandContext,
  plan: (deps: PluginLifecycleDeps) => Promise<DryRunPlan>
): Promise<void> {
  let deps: PluginLifecycleDeps | undefined;
  try {
    const report = await plannedOrRefused(async () => {
      deps = await connect(options, context);
      return deps === undefined ? undefined : plan(deps);
    });
    if (report !== undefined) reportDryRun(context.logger, report);
  } finally {
    await deps?.adapter.disconnect();
  }
}

export async function runPluginInstall(
  name: string,
  options: RunnerOptions & InstallOptions,
  context: CommandContext
): Promise<void> {
  if (options.dryRun === true) {
    return reportPluginDryRun(options, context, deps =>
      previewPluginInstall(name, deps)
    );
  }
  const deps = await connect(options, context);
  if (deps === undefined) return;
  try {
    await runPluginInstallCommand(name, deps, { consent: options.consent });
  } finally {
    await deps.adapter.disconnect();
  }
}

/** Install every configured plugin, in the config loader's dependency order. */
export async function runPluginInstallAll(
  options: RunnerOptions & InstallOptions,
  context: CommandContext
): Promise<void> {
  if (options.dryRun === true) {
    return reportPluginDryRun(options, context, previewPluginInstallAll);
  }
  const deps = await connect(options, context);
  if (deps === undefined) return;
  try {
    await runPluginInstallAllCommand(deps, { consent: options.consent });
  } finally {
    await deps.adapter.disconnect();
  }
}

export async function runPluginUninstall(
  name: string,
  options: RunnerOptions & UninstallOptions,
  context: CommandContext
): Promise<void> {
  if (options.dryRun === true) {
    return reportPluginDryRun(options, context, deps =>
      previewPluginUninstall(
        name,
        { keepData: options.keepData, yes: options.yes },
        deps
      )
    );
  }
  const deps = await connect(options, context);
  if (deps === undefined) return;
  try {
    // The command takes the migrate lock itself, through `underMigrateLock`,
    // once every refusal has been decided: the DOWNs, the ledger rows and the
    // final owner state are one decision, and a racing writer between any
    // two of them leaves a state no snapshot describes.
    await runPluginUninstallCommand(
      name,
      {
        keepData: options.keepData,
        yes: options.yes,
        consent: options.consent,
      },
      deps
    );
  } finally {
    await deps.adapter.disconnect();
  }
}
