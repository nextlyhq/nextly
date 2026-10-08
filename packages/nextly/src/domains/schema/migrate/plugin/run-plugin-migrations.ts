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
import {
  assertNotPartiallyApplied,
  reconcileFile,
  recordAlreadyApplied,
  snapshotsEquivalent,
  type ReconcileRepo,
} from "../drift-reconcile";
import type { MigrationUnit } from "../migration-transaction";
import { assertRunnableStatements } from "../split-sql";
import type { NextlySchemaSnapshot } from "../../pipeline/diff/types";

import {
  assertAppliedUnchanged,
  assertModuleIntact,
  assertUniqueModuleNames,
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
import {
  assertNoOwnerChange,
  type OwnerRecord,
} from "../../ownership/owner-registry";
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
  /**
   * Execute one module's UP — in one transaction unless the module is marked
   * `transaction: false`; returns statements run.
   */
  executeSql: (sql: string, unit: MigrationUnit) => Promise<number>;
  /** Ledger rows are recorded through this — `reconcileFile`'s own repo. */
  repo: ReconcileRepo;
  /**
   * Table-level owner records for the drop guard. Absent (or empty) when no
   * registry is available, which reads as "no table is claimed": a module
   * may then drop only tables it creates itself.
   */
  owners?: ReadonlyMap<string, OwnerRecord>;
  /**
   * Every owner record, element rows included, for the drop guard's column
   * check.
   */
  elementOwners?: readonly OwnerRecord[];
  /**
   * The live columns of the tables a module's statements rebuild, read just
   * before that module is judged (`readLiveColumns`). Absent, a rebuild is
   * read as the drop it would otherwise be.
   */
  liveColumns?: (statements: readonly string[]) => Promise<LiveColumns>;
  /**
   * The tables a module's statements create that exist already, read just
   * before that module is judged (`readLiveTables`), so a table an earlier
   * module of the run made counts. Absent, the guard credits a module with
   * no table it creates.
   */
  liveTables?: (statements: readonly string[]) => Promise<ReadonlySet<string>>;
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
  // Every plugin, before any module of any of them runs: a clash in a later
  // plugin would otherwise be found only after the earlier ones had applied.
  for (const set of sets) {
    assertUniqueModuleNames(set.pluginName, set.migrations);
  }
  const result: PluginMigrationRunResult = {
    applied: 0,
    adopted: 0,
    skipped: 0,
  };
  for (const set of sets) {
    await runSet(set, deps, result);
  }
  return result;
}

/** Apply one plugin's pending modules, counting each outcome into `result`. */
async function runSet(
  set: PluginMigrationSet,
  deps: RunPluginMigrationsDeps,
  result: PluginMigrationRunResult
): Promise<void> {
  const ordered = orderedMigrations(set.migrations);
  let lastOutcome: keyof PluginMigrationRunResult = "skipped";
  for (let position = 0; position < ordered.length; position += 1) {
    const through = await fastForward(set, ordered, position, deps);
    if (through !== undefined) {
      result.adopted += through - position + 1;
      position = through;
      lastOutcome = "adopted";
      continue;
    }
    // Not caught: the first failure must stop later plugins and the app
    // phase, which assume a state that was never reached.
    lastOutcome = await applyModule(
      set,
      ordered[position],
      ordered.slice(0, position),
      deps
    );
    result[lastOutcome] += 1;
  }
  // A module that ran or was adopted just now recorded its ownership itself.
  if (lastOutcome === "skipped") {
    await repairOwnership(set, ordered[ordered.length - 1], deps);
  }
}

/**
 * Record a plugin's ownership again when its last module is recorded applied
 * but the owner rows do not stand where that module leaves them.
 *
 * A module's ledger row and its owner rows are written one after the other,
 * not together, so a run that stops between the two leaves the module
 * recorded applied and its tables unclaimed, or claimed at the previous
 * module's schema version. Every later run skips the module, so nothing else
 * writes those rows again: the drop guard would protect none of the plugin's
 * tables, and the production boot gate would read a schema version the plugin
 * is no longer at, for good. The last module's tables are the plugin's whole
 * owned shape, so recording them is exactly what that module's run would
 * have recorded.
 *
 * Only a row that is missing, or is this plugin's at another schema version,
 * is repaired. A table another owner's row names is left as it is: who owns a
 * table changes only through an explicit transfer, never as a repair.
 */
async function repairOwnership(
  set: PluginMigrationSet,
  last: PluginMigration,
  deps: RunPluginMigrationsDeps
): Promise<void> {
  const owners = deps.owners ?? new Map<string, OwnerRecord>();
  const tables = (last.snapshot[deps.dialect]?.tables ?? []).map(
    table => table.name
  );
  const stale = (row: OwnerRecord): boolean =>
    row.ownerId === set.pluginName && row.schemaVersion !== last.schemaVersion;
  const repaired = tables.filter(name => {
    const row = owners.get(name);
    return row === undefined || stale(row);
  });
  // A plugin left owning no table records its version on the rows it still
  // has (`recordOwner` carries them forward), so those are the ones read.
  const needsRepair =
    tables.length > 0 ? repaired.length > 0 : [...owners.values()].some(stale);
  if (!needsRepair) return;
  await deps.recordOwner({
    pluginName: set.pluginName,
    pluginVersion: set.pluginVersion,
    schemaVersion: last.schemaVersion,
    tables: repaired,
    // The module ran, or was adopted, in an earlier run; nothing runs now.
    adopted: false,
  });
}

/**
 * Adopt a run of pending modules when the database is already past them.
 *
 * Dev push creates a plugin's tables in their CURRENT shape. With more than
 * one module, that shape is the LAST module's result, so the first pending
 * module finds a database matching neither its start nor its end, and the
 * reconcile alone refuses it — although nothing is wrong. Here, when a module
 * would be refused that way, the later modules are asked, latest first,
 * whether the database already stands at their result; if one does, every
 * module up to it is recorded as applied without running.
 *
 * Only then: a module whose start or end the database matches goes through
 * the reconcile as before, so a fresh install and an ordinary upgrade are
 * untouched. "Stands at" is the reconcile's own equivalence, and the ledger
 * rows are the reconcile's own adoption rows. Returns the index of the last
 * module adopted, or undefined when the reconcile should decide.
 */
async function fastForward(
  set: PluginMigrationSet,
  ordered: readonly PluginMigration[],
  position: number,
  deps: RunPluginMigrationsDeps
): Promise<number | undefined> {
  if (await reconcileDecides(set, ordered, position, deps)) return undefined;
  const last = await furthestMatched(set, ordered, position, deps);
  if (last === undefined) return undefined;
  await adoptModules(set, ordered.slice(position, last + 1), deps);
  return last;
}

/** Whether a module has not been recorded as applied yet. */
function isPending(
  set: PluginMigrationSet,
  migration: PluginMigration,
  deps: RunPluginMigrationsDeps
): boolean {
  return !deps.appliedShas.has(
    qualifiedFilename(set.pluginName, migration.name)
  );
}

/**
 * Whether the reconcile alone decides this module: it is recorded already, it
 * is the plugin's last, or the database stands at its start or its end.
 */
async function reconcileDecides(
  set: PluginMigrationSet,
  ordered: readonly PluginMigration[],
  position: number,
  deps: RunPluginMigrationsDeps
): Promise<boolean> {
  if (!isPending(set, ordered[position], deps)) return true;
  if (position === ordered.length - 1) return true;
  const here = await moduleSides(
    set,
    ordered[position],
    ordered.slice(0, position),
    deps
  );
  return (
    snapshotsEquivalent(here.live, here.before) ||
    snapshotsEquivalent(here.live, here.target)
  );
}

/**
 * The latest module after `position` whose result the database already
 * stands at, with every module up to it still pending — or undefined.
 */
async function furthestMatched(
  set: PluginMigrationSet,
  ordered: readonly PluginMigration[],
  position: number,
  deps: RunPluginMigrationsDeps
): Promise<number | undefined> {
  for (let last = ordered.length - 1; last > position; last -= 1) {
    // A recorded module inside the run would be adopted over; the ledger and
    // the database disagree there, which is the reconcile's to report.
    const run = ordered.slice(position, last + 1);
    if (!run.every(migration => isPending(set, migration, deps))) continue;
    const there = await moduleSides(
      set,
      ordered[last],
      ordered.slice(0, last),
      deps
    );
    if (snapshotsEquivalent(there.live, there.target)) return last;
  }
  return undefined;
}

/**
 * Record each module as applied without running it, and its ownership.
 *
 * Every module is checked intact, and not left part-way by a failed attempt
 * (`assertNotPartiallyApplied`), before any row is written, so such a module later in
 * the run refuses the whole adoption rather than leaving the modules before it
 * recorded.
 */
async function adoptModules(
  set: PluginMigrationSet,
  modules: readonly PluginMigration[],
  deps: RunPluginMigrationsDeps
): Promise<void> {
  for (const migration of modules) {
    assertModuleIntact(set.pluginName, migration);
    assertTakesNoOwnedTable(set, migration, deps);
    await assertNotPartiallyApplied(
      {
        filename: qualifiedFilename(set.pluginName, migration.name),
        transaction: migration.transaction !== false,
      },
      deps.dialect,
      deps.repo
    );
  }
  for (const migration of modules) {
    await recordAlreadyApplied(
      {
        filename: qualifiedFilename(set.pluginName, migration.name),
        sha256: migration.checksum,
      },
      deps.repo
    );
    await deps.recordOwner({
      pluginName: set.pluginName,
      pluginVersion: set.pluginVersion,
      schemaVersion: migration.schemaVersion,
      tables: ownedTables(migration, deps.dialect),
      adopted: true,
    });
  }
}

/**
 * The tables a module leaves its plugin OWNING, never the foreign ones it
 * only contributes an element to — the rows `recordOwner` writes for it.
 */
function ownedTables(
  migration: PluginMigration,
  dialect: SupportedDialect
): string[] {
  return (migration.snapshot[dialect]?.tables ?? []).map(table => table.name);
}

/**
 * Refuse, before a module runs or is adopted, one whose tables are recorded
 * as another owner's: a removed plugin's table taken over by a newcomer of
 * the same name. Recording the module would rewrite the owner row and let
 * the newcomer drop the old owner's data, so the decision is made before
 * the ledger or the database changes, not when the row is written.
 */
function assertTakesNoOwnedTable(
  set: PluginMigrationSet,
  migration: PluginMigration,
  deps: RunPluginMigrationsDeps
): void {
  assertNoOwnerChange(
    ownedTables(migration, deps.dialect).map(tableName => ({
      tableName,
      ownerId: set.pluginName,
    })),
    deps.owners?.values() ?? []
  );
}

/**
 * A module's start, end and the live database, scoped and narrowed the way
 * the reconcile judges them.
 */
async function moduleSides(
  set: PluginMigrationSet,
  migration: PluginMigration,
  /** The plugin's modules ordered before this one, for its contributions. */
  earlier: readonly PluginMigration[],
  deps: RunPluginMigrationsDeps
): Promise<{
  before: NextlySchemaSnapshot;
  target: NextlySchemaSnapshot;
  live: NextlySchemaSnapshot;
}> {
  // Both sides include the FOREIGN tables this module contributes elements to,
  // so the reconcile compares against the shape the module's SQL actually
  // produces. Leaving them out would let it judge a module by a target that
  // never mentions the table its ALTER touches.
  const before: NextlySchemaSnapshot = {
    tables: [
      ...(migration.before[deps.dialect]?.tables ?? []),
      ...(migration.contributedBefore?.[deps.dialect]?.tables ?? []),
    ],
  };
  const target: NextlySchemaSnapshot = {
    tables: [
      ...(migration.snapshot[deps.dialect]?.tables ?? []),
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
  return narrowToContributions({
    before,
    target,
    live: await deps.introspect(names, `plugin:${set.pluginName}`),
    contributions: mergeContributions(
      recordedContributions(earlier, deps.dialect),
      recordedContributions([...earlier, migration], deps.dialect)
    ),
  });
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

  assertTakesNoOwnedTable(set, migration, deps);
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
    elementOwners: deps.elementOwners ?? [],
    // The columns this plugin's earlier modules contributed are its own
    // before any element row records them: rows are written once the run
    // ends, and a fresh install runs every module in one run.
    ownedElements: recordedContributions(earlier, deps.dialect),
    dialect: deps.dialect,
    source: filename,
    liveColumns: await deps.liveColumns?.(statements),
    liveTables: await deps.liveTables?.(statements),
  });
  assertRunnableStatements(statements, deps.dialect, filename, {
    transaction: migration.transaction !== false,
    unit: "module",
  });

  const sides = await moduleSides(set, migration, earlier, deps);

  const { state } = await reconcileFile({
    file: {
      filename,
      // Split by the executor, like an app file; see `moduleSql`.
      sql: moduleSql(migration, deps.dialect, "up"),
      path: `plugin:${set.pluginName}/${migration.name}`,
      sha256: migration.checksum,
      transaction: migration.transaction !== false,
    },
    before: sides.before,
    target: sides.target,
    live: sides.live,
    dialect: deps.dialect,
    repo: deps.repo,
    executeSql: deps.executeSql,
    pluginName: set.pluginName,
  });

  await deps.recordOwner({
    pluginName: set.pluginName,
    pluginVersion: set.pluginVersion,
    schemaVersion: migration.schemaVersion,
    // The tables this plugin OWNS, never the foreign ones it only contributed
    // an element to. `recordOwner` upserts ownership, so a dependency's table
    // listed here would hand this plugin the row naming its real owner — and
    // the drop guard would then let this plugin's DOWN drop it.
    tables: ownedTables(migration, deps.dialect),
    adopted: state === "already_applied",
  });
  return state === "already_applied" ? "adopted" : "applied";
}
