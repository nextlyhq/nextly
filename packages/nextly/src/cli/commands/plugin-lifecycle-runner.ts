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
import {
  appliedFilenames,
  newestEventsByFilename,
} from "../../domains/schema/events/newest-event";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { executeTransaction } from "../../domains/schema/migrate/migration-transaction";
import {
  orderedMigrations,
  pluginModuleStatements,
  qualifiedFilename,
  type PluginMigration,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import { resolveMigration } from "../../domains/schema/migrate/resolve";
import { assertRunnableStatements } from "../../domains/schema/migrate/split-sql";
import {
  assertNoForeignDrops,
  columnsAfter,
  readLiveColumns,
} from "../../domains/schema/ownership/drop-guard";
import {
  SchemaOwnersRepository,
  tableOwnersByName,
} from "../../domains/schema/ownership/schema-owners-repository";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type { CommandContext } from "../program";
import { createCliAdapter } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import {
  runPluginInstallCommand,
  runPluginUninstallCommand,
  type LifecyclePlugin,
  type PreparedModuleDown,
} from "./plugin-lifecycle";
import {
  recordRollbackFailed,
  verifiedPluginModule,
} from "./plugin-module-rollback";

interface RunnerOptions {
  config?: string;
  cwd?: string;
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

async function connect(options: RunnerOptions, context: CommandContext) {
  const { config } = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });
  const adapter = await createCliAdapter({});
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
    }
  };

  await refreshPlan();

  const drizzleAdapter = adapter as unknown as DrizzleAdapter;

  /**
   * Every module's DOWN for an uninstall, verified and judged before any of
   * them runs.
   *
   * The statements come from the plugin's own definition — the lifecycle
   * view carries module NAMES, not their SQL — through the function
   * `migrate:down --plugin` verifies a module with: the module must still
   * match the checksum it was sealed with and the one its applied ledger row
   * recorded, because the DOWN about to run is taken from the definition as
   * it is now.
   *
   * The drop guard judges each module's statements before the first one
   * runs, so a refusal of an older module cannot come after a newer one's
   * DOWN has committed. A plugin's DOWN is its own code, and nothing else
   * constrains what it drops: unguarded, an uninstall could drop an
   * app-owned or another plugin's table, which is where the data is least
   * recoverable.
   */
  const prepareDowns = async (
    plugin: LifecyclePlugin,
    moduleNames: readonly string[]
  ): Promise<PreparedModuleDown[]> => {
    const definition = definitions.find(d => d.name === plugin.name);
    const migrations = definition ? pluginModules(definition) : [];
    const newest = newestEventsByFilename(
      await new SchemaEventsRepository(
        drizzleAdapter.getDrizzle(),
        dialect
      ).listFileApplies()
    );
    const downs = moduleNames.map(moduleName => {
      const filename = qualifiedFilename(plugin.name, moduleName);
      const module = verifiedPluginModule({
        pluginName: plugin.name,
        migrations,
        moduleName,
        filename,
        recordedSha: newest.get(filename)?.sha256,
      });
      return {
        moduleName,
        filename,
        statements: pluginModuleStatements(module, dialect, "down"),
      };
    });

    const owners = tableOwnersByName(
      await new SchemaOwnersRepository(
        drizzleAdapter.getDrizzle(),
        dialect
      ).read()
    );
    // Rebuilds are judged against the columns their tables will have when
    // each DOWN runs: live now, then as the DOWNs before it leave them.
    let columns = await readLiveColumns(
      drizzleAdapter.getDrizzle(),
      dialect,
      downs.map(down => down.statements)
    );
    for (const down of downs) {
      // A statement the runner's transaction cannot hold, refused with the
      // rest before any module runs.
      assertRunnableStatements(down.statements, dialect, down.filename);
      assertNoForeignDrops({
        liveColumns: columns,
        statements: down.statements,
        stream: `plugin:${plugin.name}`,
        owners,
        dialect,
        source: down.filename,
      });
      columns = columnsAfter(down.statements, dialect, columns);
    }
    return downs;
  };

  /**
   * Undo one prepared module, exactly as the apply path runs its UP: in one
   * transaction, recorded in the ledger.
   *
   * The ledger row is written inside the transaction, so a module whose
   * reversal committed is recorded even when a later module fails — a module
   * left `applied` after its DOWN ran would be selected again by
   * `migrate:down --plugin` and skipped by `migrate` as still applied.
   *
   * A DOWN that fails is recorded `failed` under the module's own ledger key,
   * as `migrate:down` records one, through the same helper.
   */
  const runDown = async (
    _plugin: LifecyclePlugin,
    down: PreparedModuleDown
  ): Promise<number> => {
    if (down.statements.length === 0) return 0;
    try {
      // One transaction for the module, like the UP path: a module half
      // undone is a state no snapshot describes. The ledger row is written
      // through the transaction's own handle, so it commits or rolls back
      // with the statements it records.
      await executeTransaction(drizzleAdapter, async tx => {
        for (const statement of down.statements) {
          await tx.execute(statement);
        }
        await resolveMigration({
          mode: "rolled-back",
          filename: down.filename,
          repo: new SchemaEventsRepository(tx.db, dialect),
          // rolled-back mode does not read these; provide inert resolvers.
          fileExists: () => Promise.resolve(true),
          loadTargetSnapshot: () => Promise.resolve(null),
          introspectLive: () => Promise.resolve({ tables: [] }),
        });
      });
    } catch (error) {
      await recordRollbackFailed({
        repo: new SchemaEventsRepository(drizzleAdapter.getDrizzle(), dialect),
        filename: down.filename,
        dialect,
        note: `plugins uninstall failed: ${describeError(error, { context: false })}`,
      });
      throw error;
    }
    return down.statements.length;
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
    const outcome = await withMigrateLock(
      drizzleAdapter.getDrizzle(),
      dialect,
      work,
      {
        mode: "wait",
        logger: {
          warn: m => context.logger.warn(m),
          info: m => context.logger.info(m),
        },
      }
    );
    if (!outcome.ran) {
      throw new NextlyError({
        code: "CONFLICT",
        publicMessage:
          `Another migration is holding the migrate lock, so ${notRun}. ` +
          "Nothing was changed — re-run once it finishes.",
        statusCode: 409,
        logContext: { ...logContext, reason: outcome.reason },
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
        return work();
      },
      "nothing was run",
      {}
    );

  /**
   * Apply this plugin's pending modules, through the phase `migrate` uses.
   *
   * Not a second implementation: `runPluginPhase` owns the lock, the ledger,
   * the drop guard and the owner records, and an install that applied modules
   * its own way would record them differently from every later `migrate`.
   * Scoped to the one plugin being installed, which is the only difference.
   */
  const applyMigrations = async (plugin: LifecyclePlugin): Promise<void> => {
    const definition = definitions.find(d => d.name === plugin.name);
    const modules = definition?.contributes?.schema?.migrations ?? [];
    if (definition === undefined || modules.length === 0) return;
    const { runPluginPhase } = await import("./migrate");
    const { pluginMigrationSetsFrom } = await import(
      "../../domains/schema/migrate/plugin/run-plugin-migrations"
    );
    // Under the SAME lock `migrate` takes, for the same reason.
    //
    // `runPluginPhase` is normally reached from inside `migrateCore`'s
    // `withMigrateLock`; calling it directly took none, so an install racing a
    // `migrate` run — or a second install — could have both processes read the
    // module as unapplied and execute its DDL. The loser then fails on objects
    // that already exist, and on MySQL, where DDL is not transactional, the
    // earlier statements of its module are already committed and cannot be
    // rolled back.
    //
    // `mode: "wait"` rather than fail-fast: an operator running `plugins
    // install` while boot migrations happen to be running wants it to proceed
    // once they finish, not to be told to try again.
    // Read from the definition, so it is computed before the lock rather than
    // inside it: holding a database lock over work that touches no database
    // just makes every other process wait longer.
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
    const pluginMigrationSets = sorted.filter(
      set => set.pluginName === definition.name
    );

    const { compileExtensionSchema } = await import(
      "../../domains/schema/extension/publish"
    );
    const extensionSchema = await compileExtensionSchema({
      dialect,
      plugins: definitions,
      config,
      logger: { warn: m => context.logger.warn(m) },
    });

    // Refused rather than swallowed when the lock was held throughout: the
    // command goes on to record the plugin active, and doing that over
    // migrations that never ran would report work that was not done.
    await withLockOrRefuse(
      () =>
        runPluginPhase({
          extensionSchema,
          dialect,
          db: drizzleAdapter.getDrizzle(),
          adapter,
          migrationsDir: config.db?.migrationsDir ?? "./src/db/migrations",
          logger: context.logger,
          pluginsWithMigrations: new Set([plugin.name]),
          pluginMigrationSets,
        }),
      `${plugin.name}'s migrations were not applied`,
      { plugin: plugin.name }
    );
  };

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
    opts: { keepData: boolean }
  ): Promise<void> => {
    const definition = definitions.find(d => d.name === plugin.name);
    if (definition?.[hook] === undefined) return;

    const {
      registerServices,
      getInitializedPluginContext,
      clearServices,
      destroyRegisteredPlugins,
      isServicesRegistered,
    } = await import("../../di/register");
    const { buildServiceConfig } = await import(
      "../../init/build-service-config"
    );
    const { getImageProcessor } = await import("../../storage/image-processor");
    const { getHookRegistry } = await import("../../hooks/hook-registry");

    // A registration this command did not make is not this command's to tear
    // down. `registerServices` refuses when one exists, and the cleanup below
    // would otherwise destroy that owner's plugins and clear its container on
    // the way out of the refusal.
    if (isServicesRegistered()) {
      throw new NextlyError({
        code: "CONFLICT",
        publicMessage: `Services are already registered in this process, so ${plugin.name}'s ${hook} was not run.`,
        statusCode: 409,
        logContext: { plugin: plugin.name, hook },
      });
    }

    try {
      // Inside the `try`, so the cleanup covers a registration that fails
      // part way. Plugins initialize before registration finishes, so one
      // that throws after that point leaves their `init()` work running with
      // the registered flag never set — and a `registerServices` outside the
      // `try` skipped the cleanup exactly then.
      await registerServices(
        buildServiceConfig({
          config,
          adapter: drizzleAdapter,
          imageProcessor: getImageProcessor(),
          hookRegistry: getHookRegistry(),
          logger: context.logger,
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
      // Branched rather than called through `definition[hook]`: the two hooks
      // take different arguments, and a union of them accepts neither call.
      if (hook === "onInstall") {
        await definition.onInstall?.(pluginContext);
      } else {
        await definition.onUninstall?.(pluginContext, opts);
      }
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
      await destroyRegisteredPlugins();
      clearServices();
    }
  };

  return {
    adapter,
    dialect,
    applyMigrations,
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
    runLifecycleHook,
    migrationsDir: config.db?.migrationsDir,
    logger: context.logger,
    prepareDowns,
    runDown,
    underMigrateLock,
  };
}

export async function runPluginInstall(
  name: string,
  options: RunnerOptions,
  context: CommandContext
): Promise<void> {
  const deps = await connect(options, context);
  try {
    await runPluginInstallCommand(name, deps);
  } finally {
    await deps.adapter.disconnect();
  }
}

export async function runPluginUninstall(
  name: string,
  options: RunnerOptions & { keepData: boolean; yes: boolean },
  context: CommandContext
): Promise<void> {
  const deps = await connect(options, context);
  try {
    // The command takes the migrate lock itself, through `underMigrateLock`,
    // once every refusal has been decided: the DOWNs, the ledger rows and the
    // final owner state are one decision, and a racing writer between any
    // two of them leaves a state no snapshot describes.
    await runPluginUninstallCommand(
      name,
      { keepData: options.keepData, yes: options.yes },
      deps
    );
  } finally {
    await deps.adapter.disconnect();
  }
}
