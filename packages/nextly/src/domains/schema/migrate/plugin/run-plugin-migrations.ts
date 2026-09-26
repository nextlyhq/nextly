/**
 * Applying each plugin's migrations, in resolver order, under the one lock.
 *
 * Runs between the core reconcile and the app's own files. Plugins go first
 * because app migrations may index entity tables that plugins contribute, and
 * an index on a table that does not exist is not a recoverable error.
 *
 * ## The three-way decision is `reconcileFile`'s, not a second one
 *
 * Each module goes through the SAME state machine the app's files do
 * (`reconcileFile`): live == before runs the UP, live == target records the
 * module as already applied (the dev-push adoption case), and neither is a
 * drift error naming the difference. Adoption is not re-implemented here,
 * because a second comparison would eventually disagree with the first about
 * what "equal" means, and the disagreement would surface as a plugin module
 * that refuses a database the app path would accept.
 *
 * ## The first failure stops everything
 *
 * Later plugins and the app phase do not run. That is today's behaviour for
 * app files, and the reason is the same: migrations after a failed one assume
 * a database state that was never reached.
 *
 * @module domains/schema/migrate/plugin/run-plugin-migrations
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../../database/schema-registry";
import { reconcileFile, type ReconcileRepo } from "../drift-reconcile";
import { assertRunnableStatements } from "../split-sql";
import type { NextlySchemaSnapshot } from "../../pipeline/diff/types";

import {
  assertAppliedUnchanged,
  assertModuleIntact,
  moduleSql,
  orderedMigrations,
  pluginModuleStatements,
  qualifiedFilename,
  type PluginMigration,
} from "./plugin-migration";
import type { PluginDefinition } from "../../../../plugins/plugin-context";
import {
  assertNoForeignDrops,
  type LiveColumns,
} from "../../ownership/drop-guard";
import type { OwnerRecord } from "../../ownership/owner-registry";
import {
  mergeContributions,
  narrowToContributions,
} from "../../migrate-create/app-stream";

import { recordedContributions } from "./recorded-contributions";

/** One plugin's migrations, in the order the resolver placed the plugin. */
export interface PluginMigrationSet {
  pluginName: string;
  pluginVersion: string;
  migrations: readonly PluginMigration[];
}

export interface RunPluginMigrationsDeps {
  dialect: SupportedDialect;
  /** Applied `file_apply` rows keyed by qualified filename. */
  appliedShas: ReadonlyMap<string, string | null>;
  /** The live tables for a set of names, as a snapshot. */
  /**
   * The live tables for a set of names, as THIS stream should see them:
   * elements another stream owns are the caller's to exclude, which is why
   * the stream identity travels with the call.
   */
  introspect: (
    tableNames: readonly string[],
    stream: string
  ) => Promise<NextlySchemaSnapshot>;
  /** Execute one module's UP in one transaction; returns statements run. */
  executeSql: (sql: string) => Promise<number>;
  /** Ledger rows are recorded through this — `reconcileFile`'s own repo. */
  repo: ReconcileRepo;
  /**
   * Owner records for the drop guard. Absent (or empty) when no registry is
   * available, which reads as "no table is claimed" and refuses nothing —
   * exactly the behaviour of a database predating the registry.
   */
  owners?: ReadonlyMap<string, OwnerRecord>;
  /**
   * The live columns of the tables a module's statements rebuild, read just
   * before that module is judged (`readLiveColumns`). Absent, a rebuild is
   * read as the drop it would otherwise be.
   */
  liveColumns?: (statements: readonly string[]) => Promise<LiveColumns>;
  /** Owner-registry upsert after a module lands or is adopted. */
  recordOwner: (args: {
    pluginName: string;
    pluginVersion: string;
    schemaVersion: number;
    tables: readonly string[];
    adopted: boolean;
  }) => Promise<void>;
}

export interface PluginMigrationRunResult {
  applied: number;
  adopted: number;
  skipped: number;
}

/**
 * The sets one run should apply, from the config's plugin list, in the order
 * the resolver produces.
 *
 * Both callers — the CLI command and production boot — build nothing of their
 * own, so the two cannot disagree about which plugins ship migrations or the
 * order they run in.
 */
export async function pluginMigrationSetsFrom(
  plugins: readonly PluginDefinition[]
): Promise<PluginMigrationSet[]> {
  // Dynamic for the same cycle reason the CLI command loads it: the module
  // sits on a cycle that closes through the commands.
  const { topoSortPlugins } = await import("../../../../plugins/topo-sort");
  return (
    topoSortPlugins([...plugins])
      // DISABLED plugins included, matching the compile side. `enabled: false`
      // stops a plugin running, not its tables existing: its schema stays in the
      // compiled model, so its modules have to be applied or production would
      // hold a shape the model says is there and the database does not. The
      // asymmetry was the bug — dev push created the tables from the model while
      // production skipped the modules that create them.
      .filter(
        plugin => (plugin.contributes?.schema?.migrations?.length ?? 0) > 0
      )
      .map(plugin => ({
        pluginName: plugin.name,
        pluginVersion: plugin.version,
        migrations: plugin.contributes!.schema!.migrations!,
      }))
  );
}

/**
 * Apply every pending module for every plugin, stopping at the first failure.
 *
 * The order is the one the resolver produced, and it is the whole contract of
 * this function: a plugin's migration may reference a table a dependency
 * created.
 */
export async function runPluginMigrations(
  sets: readonly PluginMigrationSet[],
  deps: RunPluginMigrationsDeps
): Promise<PluginMigrationRunResult> {
  const result: PluginMigrationRunResult = {
    applied: 0,
    adopted: 0,
    skipped: 0,
  };
  for (const set of sets) {
    const ordered = orderedMigrations(set.migrations);
    for (const [position, migration] of ordered.entries()) {
      // Not caught: the first failure must stop later plugins and the app
      // phase, which assume a state that was never reached.
      result[
        await applyModule(set, migration, ordered.slice(0, position), deps)
      ] += 1;
    }
  }
  return result;
}

async function applyModule(
  set: PluginMigrationSet,
  migration: PluginMigration,
  /** The plugin's modules ordered before this one, for its contributions. */
  earlier: readonly PluginMigration[],
  deps: RunPluginMigrationsDeps
): Promise<"applied" | "adopted" | "skipped"> {
  // Before anything is read from the database: a module whose SQL was edited
  // after generation is refused whatever the live state is.
  assertModuleIntact(set.pluginName, migration);

  const filename = qualifiedFilename(set.pluginName, migration.name);
  const recorded = deps.appliedShas.get(filename);
  if (recorded !== undefined) {
    assertAppliedUnchanged(set.pluginName, migration, recorded);
    return "skipped";
  }

  // Judged for the module as a whole, before anything executes: a module
  // dropping another stream's table is refused with the ledger untouched,
  // never partly applied.
  //
  // Only a module about to run is judged. An applied module runs nothing
  // here, and judging it against today's owners would refuse every later
  // migrate once another stream came to own a name its old SQL dropped.
  //
  // The statements judged are the ones the executor runs: the same text
  // (`moduleSql`, handed to `reconcileFile` below) through the same splitter.
  // A statement the runner's transaction cannot hold is refused here too,
  // before the ledger records an attempt.
  const statements = pluginModuleStatements(migration, deps.dialect, "up");
  assertNoForeignDrops({
    statements,
    stream: `plugin:${set.pluginName}`,
    owners: deps.owners ?? new Map(),
    dialect: deps.dialect,
    source: filename,
    liveColumns: await deps.liveColumns?.(statements),
  });
  assertRunnableStatements(statements, deps.dialect, filename);

  // Both sides include the FOREIGN tables this module contributes elements to,
  // so the reconcile compares against the shape the module's SQL actually
  // produces. Leaving them out would let it judge a module by a target that
  // never mentions the table its ALTER touches.
  const ownedTarget = migration.snapshot[deps.dialect]?.tables ?? [];
  const before: NextlySchemaSnapshot = {
    tables: [
      ...(migration.before[deps.dialect]?.tables ?? []),
      ...(migration.contributedBefore?.[deps.dialect]?.tables ?? []),
    ],
  };
  const target: NextlySchemaSnapshot = {
    tables: [
      ...ownedTarget,
      ...(migration.contributed?.[deps.dialect]?.tables ?? []),
    ],
  };
  // The before side names tables an older module created, so both sides scope
  // the live read — a module dropping a table it no longer wants must still
  // see that table to compare against.
  const names = [
    ...new Set([...before.tables, ...target.tables].map(table => table.name)),
  ];
  // A contributed table is judged on this plugin's elements alone, exactly as
  // the app stream judges the tables it contributes to (`narrowToContributions`,
  // the same function). Its `contributedBefore`/`contributed` copies are the
  // whole table as it was when the module was generated; the owner may have
  // shipped later modules since, which a fresh install applies first, so the
  // live table then matches neither copy and a valid contribution would be
  // refused as drift. The elements that are this plugin's are the ones its
  // modules record either side of this one — the same replay the generator
  // reads them from.
  const sides = narrowToContributions({
    before,
    target,
    live: await deps.introspect(names, `plugin:${set.pluginName}`),
    contributions: mergeContributions(
      recordedContributions(earlier, deps.dialect),
      recordedContributions([...earlier, migration], deps.dialect)
    ),
  });

  const { state } = await reconcileFile({
    file: {
      filename,
      // Split by the executor, like an app file; see `moduleSql`.
      sql: moduleSql(migration, deps.dialect, "up"),
      path: `plugin:${set.pluginName}/${migration.name}`,
      sha256: migration.checksum,
    },
    before: sides.before,
    target: sides.target,
    live: sides.live,
    repo: deps.repo,
    executeSql: deps.executeSql,
  });

  await deps.recordOwner({
    pluginName: set.pluginName,
    pluginVersion: set.pluginVersion,
    schemaVersion: migration.schemaVersion,
    // The tables this plugin OWNS, never the foreign ones it only contributed
    // an element to. `recordOwner` upserts ownership, so a dependency's table
    // listed here would hand this plugin the row naming its real owner — and
    // the drop guard would then let this plugin's DOWN drop it.
    tables: ownedTarget.map(table => table.name),
    adopted: state === "already_applied",
  });
  return state === "already_applied" ? "adopted" : "applied";
}
