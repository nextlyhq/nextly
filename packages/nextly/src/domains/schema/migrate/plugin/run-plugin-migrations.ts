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
import type { NextlySchemaSnapshot } from "../../pipeline/diff/types";

import {
  assertAppliedUnchanged,
  assertModuleIntact,
  orderedMigrations,
  qualifiedFilename,
  type PluginMigration,
} from "./plugin-migration";
import type { PluginDefinition } from "../../../../plugins/plugin-context";
import { assertNoForeignDrops } from "../../ownership/drop-guard";
import type { OwnerRecord } from "../../ownership/owner-registry";

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
  introspect: (tableNames: readonly string[]) => Promise<NextlySchemaSnapshot>;
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
  return topoSortPlugins([...plugins])
    .filter(
      plugin =>
        plugin.enabled !== false &&
        (plugin.contributes?.schema?.migrations?.length ?? 0) > 0
    )
    .map(plugin => ({
      pluginName: plugin.name,
      pluginVersion: plugin.version,
      migrations: plugin.contributes!.schema!.migrations!,
    }));
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
    for (const migration of orderedMigrations(set.migrations)) {
      // Not caught: the first failure must stop later plugins and the app
      // phase, which assume a state that was never reached.
      result[await applyModule(set, migration, deps)] += 1;
    }
  }
  return result;
}

async function applyModule(
  set: PluginMigrationSet,
  migration: PluginMigration,
  deps: RunPluginMigrationsDeps
): Promise<"applied" | "adopted" | "skipped"> {
  // Before anything is read from the database: a module whose SQL was edited
  // after generation is refused whatever the live state is.
  assertModuleIntact(set.pluginName, migration);

  const filename = qualifiedFilename(set.pluginName, migration.name);
  // Judged for the module as a whole, before anything executes: a module
  // dropping another stream's table is refused with the ledger untouched,
  // never partly applied.
  assertNoForeignDrops({
    statements: migration.dialects[deps.dialect]?.up ?? [],
    stream: `plugin:${set.pluginName}`,
    owners: deps.owners ?? new Map(),
    source: filename,
  });
  const recorded = deps.appliedShas.get(filename);
  if (recorded !== undefined) {
    assertAppliedUnchanged(set.pluginName, migration, recorded);
    return "skipped";
  }

  const before: NextlySchemaSnapshot = {
    tables: migration.before[deps.dialect]?.tables ?? [],
  };
  const target: NextlySchemaSnapshot = {
    tables: migration.snapshot[deps.dialect]?.tables ?? [],
  };
  // The before side names tables an older module created, so both sides scope
  // the live read — a module dropping a table it no longer wants must still
  // see that table to compare against.
  const names = [
    ...new Set([...before.tables, ...target.tables].map(table => table.name)),
  ];
  const live = await deps.introspect(names);

  const { state } = await reconcileFile({
    file: {
      filename,
      sql: (migration.dialects[deps.dialect]?.up ?? []).join(";\n"),
      path: `plugin:${set.pluginName}/${migration.name}`,
      sha256: migration.checksum,
    },
    before,
    target,
    live,
    repo: deps.repo,
    executeSql: deps.executeSql,
  });

  await deps.recordOwner({
    pluginName: set.pluginName,
    pluginVersion: set.pluginVersion,
    schemaVersion: migration.schemaVersion,
    tables: target.tables.map(table => table.name),
    adopted: state === "already_applied",
  });
  return state === "already_applied" ? "adopted" : "applied";
}
