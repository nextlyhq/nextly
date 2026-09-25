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

import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { qualifiedFilename } from "../../domains/schema/migrate/plugin/plugin-migration";
import { resolveMigration } from "../../domains/schema/migrate/resolve";
import { assertNoForeignDrops } from "../../domains/schema/ownership/drop-guard";
import {
  SchemaOwnersRepository,
  tableOwnersByName,
} from "../../domains/schema/ownership/schema-owners-repository";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type { CommandContext } from "../program";
import { createCliAdapter } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import { executeTransaction } from "./migrate";
import {
  runPluginInstallCommand,
  runPluginUninstallCommand,
  type LifecyclePlugin,
} from "./plugin-lifecycle";

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
    modules: (plugin.contributes?.schema?.migrations ?? []).map(module => ({
      name: module.name,
      // A module with no DOWN on the live dialect cannot be undone. Checked
      // per dialect below, where the dialect is known.
      reversible: true,
    })),
  }));
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
  // the latest state is what "is this applied?" asks. The same rule
  // `runPluginPhase` uses.
  const appliedModules = new Set<string>();
  {
    const newest = new Map<string, { status: string; at: number }>();
    const events = new SchemaEventsRepository(
      (adapter as unknown as DrizzleAdapter).getDrizzle(),
      dialect
    );
    for (const row of await events.listFileApplies()) {
      if (!row.filename?.startsWith("plugin:")) continue;
      const at = row.startedAt.getTime();
      const seen = newest.get(row.filename);
      if (seen === undefined || at >= seen.at) {
        newest.set(row.filename, { status: row.status, at });
      }
    }
    for (const [filename, state] of newest) {
      if (state.status === "applied") appliedModules.add(filename);
    }
  }

  for (const plugin of plugins) {
    const source = definitions.find(d => d.name === plugin.name);
    const modules = (source?.contributes?.schema?.migrations ?? []).filter(
      module => appliedModules.has(qualifiedFilename(plugin.name, module.name))
    );
    plugin.modules = modules.map(module => ({
      name: module.name,
      reversible: (module.dialects[dialect]?.down ?? []).length > 0,
    }));
  }

  const drizzleAdapter = adapter as unknown as DrizzleAdapter;

  /**
   * Undo one module, newest first, exactly as the apply path runs its UP —
   * guarded like it, and recorded like it.
   *
   * Supplied rather than left undefined: the command calls this optionally,
   * so an absent implementation made `uninstall` log every module as reverted
   * and record the plugin uninstalled while its tables and their data stayed
   * in the database. The statements come from the plugin's own definition —
   * the lifecycle view carries module NAMES, not their SQL.
   *
   * Three things happen around the execution, and leaving any of them out
   * makes uninstall the one destructive path with weaker rules than `migrate`:
   *
   * 1. **The drop guard, before anything runs.** A plugin's DOWN is its own
   *    code, and nothing constrains what it drops. Passing its statements
   *    straight to the executor let a plugin's uninstall drop an app-owned or
   *    another plugin's table — refused everywhere else, and here the data is
   *    least recoverable. Judged for the module as a WHOLE so a refusal leaves
   *    nothing partly undone.
   * 2. **The ledger, after.** The module's latest entry stayed `applied`, so a
   *    later `migrate:down --plugin` could select a module already reverted,
   *    and a later `migrate` treated it as still applied.
   * 3. **Recording inside the transaction.** If a later module fails, the
   *    reversals that already ran are still recorded, because the ledger write
   *    committed with the SQL that earned it.
   */
  const runDown = async (
    plugin: LifecyclePlugin,
    moduleName: string
  ): Promise<number> => {
    const definition = definitions.find(d => d.name === plugin.name);
    const module = (definition?.contributes?.schema?.migrations ?? []).find(
      m => m.name === moduleName
    );
    const statements = module?.dialects[dialect]?.down ?? [];
    if (statements.length === 0) return 0;

    const filename = qualifiedFilename(plugin.name, moduleName);
    const owners = tableOwnersByName(
      await new SchemaOwnersRepository(
        drizzleAdapter.getDrizzle(),
        dialect
      ).read()
    );
    assertNoForeignDrops({
      statements,
      stream: `plugin:${plugin.name}`,
      owners,
      source: filename,
    });

    const repo = new SchemaEventsRepository(
      drizzleAdapter.getDrizzle(),
      dialect
    );
    // One transaction for the module, like the UP path: a module half undone
    // is a state no snapshot describes.
    await executeTransaction(drizzleAdapter, dialect, async () => {
      for (const statement of statements) {
        await drizzleAdapter.executeQuery(statement);
      }
      await resolveMigration({
        mode: "rolled-back",
        filename,
        repo,
        // rolled-back mode does not read these; provide inert resolvers.
        fileExists: () => Promise.resolve(true),
        loadTargetSnapshot: () => Promise.resolve(null),
        introspectLive: () => Promise.resolve({ tables: [] }),
      });
    });
    return statements.length;
  };

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
    const { withMigrateLock } = await import(
      "../../domains/schema/pipeline/locks"
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
    const pluginMigrationSets = await pluginMigrationSetsFrom([definition]);

    const outcome = await withMigrateLock(
      drizzleAdapter.getDrizzle(),
      dialect,
      () =>
        runPluginPhase({
          dialect,
          db: drizzleAdapter.getDrizzle(),
          adapter,
          migrationsDir: config.db?.migrationsDir ?? "./src/db/migrations",
          logger: context.logger,
          pluginsWithMigrations: new Set([plugin.name]),
          pluginMigrationSets,
        }),
      {
        mode: "wait",
        logger: {
          warn: m => context.logger.warn(m),
          info: m => context.logger.info(m),
        },
      }
    );

    if (!outcome.ran) {
      // Reported rather than swallowed: the command goes on to record the
      // plugin active, and doing that over migrations that never ran is the
      // "reports work it did not do" failure this whole path was fixed for.
      throw new NextlyError({
        code: "CONFLICT",
        publicMessage:
          `Another migration is holding the migrate lock, so ${plugin.name}'s migrations were not applied. ` +
          `Nothing was changed — re-run once it finishes.`,
        statusCode: 409,
        logContext: { plugin: plugin.name, reason: outcome.reason },
      });
    }
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
   *   make a second connection, and `shutdownServices` runs in a `finally`:
   *   an install that fails inside a hook must not leave a registered
   *   container behind for the next command in the same process.
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

    const { registerServices, getInitializedPluginContext, shutdownServices } =
      await import("../../di/register");
    const { buildServiceConfig } = await import(
      "../../init/build-service-config"
    );
    const { getImageProcessor } = await import("../../storage/image-processor");
    const { getHookRegistry } = await import("../../hooks/hook-registry");

    await registerServices(
      buildServiceConfig({
        config,
        adapter: drizzleAdapter,
        imageProcessor: getImageProcessor(),
        hookRegistry: getHookRegistry(),
        logger: context.logger,
      })
    );
    try {
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
      // `shutdownServices` disconnects the adapter it was handed, and this
      // command is not done with it — an install still has owner rows to
      // record, an uninstall still has DOWN statements to run. Reconnecting
      // beats skipping the shutdown: a registered container left behind would
      // make the next `registerServices` in this process throw.
      await shutdownServices();
      if (!adapter.isConnected()) await adapter.connect();
    }
  };

  return {
    adapter,
    dialect,
    applyMigrations,
    // The same cast `migrate` makes: `CLIDatabaseAdapter` is deliberately
    // connect/disconnect/dialect, and the Drizzle handle underneath it is
    // what any command touching data needs.
    db: drizzleAdapter.getDrizzle(),
    plugins,
    definitions,
    runLifecycleHook,
    migrationsDir: config.db?.migrationsDir,
    logger: context.logger,
    runDown,
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
    await runPluginUninstallCommand(
      name,
      { keepData: options.keepData, yes: options.yes },
      deps
    );
  } finally {
    await deps.adapter.disconnect();
  }
}
