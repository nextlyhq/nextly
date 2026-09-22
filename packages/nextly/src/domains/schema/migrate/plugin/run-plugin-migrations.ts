/**
 * Applying each plugin's migrations, in dependency order, under the one lock.
 *
 * Runs between the core reconcile and the app's own files. Plugins go first
 * because app migrations may index entity tables that plugins contribute, and
 * an index on a table that does not exist is not a recoverable error.
 *
 * ## Adoption is not a second code path
 *
 * A plugin's tables may already exist, created by development push before
 * anyone ran a migration. That is the ordinary case for a plugin installed in
 * dev and then deployed, and it must not be a failure — but nor may it be a
 * blind "assume it matches".
 *
 * So each module is decided by comparing the LIVE tables against the module's
 * own `before` and `snapshot`:
 *
 *   live == before   → run the UP
 *   live == snapshot → already applied; record it without running anything
 *   neither          → drift, named
 *
 * The third case is why this is a comparison rather than an existence check:
 * a table created by dev push and then altered by hand matches neither, and
 * running the UP against it would fail halfway or, worse, succeed against a
 * shape nobody intended.
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
import { NextlyError } from "../../../../errors/nextly-error";
import type { TableSpec } from "../../pipeline/diff/types";

import {
  assertAppliedUnchanged,
  assertModuleIntact,
  migrationChecksum,
  orderedMigrations,
  qualifiedFilename,
  type PluginMigration,
} from "./plugin-migration";

/** One plugin's migrations, in the order the resolver placed the plugin. */
export interface PluginMigrationSet {
  pluginName: string;
  pluginVersion: string;
  migrations: readonly PluginMigration[];
}

/** What a module's state turned out to be. */
export type ModuleOutcome = "applied" | "adopted" | "skipped";

export interface RunPluginMigrationsDeps {
  dialect: SupportedDialect;
  /** Ledger rows already recorded, by qualified filename. */
  appliedShas: ReadonlyMap<string, string | null>;
  /** The live tables for one plugin's own tables. */
  introspect: (tableNames: readonly string[]) => Promise<TableSpec[]>;
  /** Execute one module's UP in its own transaction. */
  execute: (statements: readonly string[]) => Promise<number>;
  /**
   * The EXISTING reconciler, injected rather than imported.
   *
   * Injected so this stays testable without a ledger, and `reconcileFile`
   * rather than a local decision so there is one implementation of what
   * "already applied" means.
   */
  reconcile: (args: {
    file: { filename: string; sql: string; path: string; sha256?: string };
    before: { tables: TableSpec[] };
    target: { tables: TableSpec[] };
    live: { tables: TableSpec[] };
    executeSql: (sql: string) => Promise<number>;
  }) => Promise<{ state: "in_sync" | "already_applied" | "drift" }>;
  /** Record the outcome against the ledger and the owner registry. */
  record: (row: {
    filename: string;
    pluginName: string;
    pluginVersion: string;
    schemaVersion: number;
    sha256: string;
    outcome: ModuleOutcome;
    statementsExecuted: number;
    tables: string[];
  }) => Promise<void>;
}

export interface PluginMigrationResult {
  applied: number;
  adopted: number;
  skipped: number;
}

/**
 * Why no adoption logic lives in this file.
 *
 * `reconcileFile` already decides the three outcomes — in_sync,
 * already_applied, drift — by DIFFING the snapshots, and B5 said in terms
 * that there is no second adoption implementation. There was one here, and it
 * compared snapshots with JSON.stringify rather than a diff.
 *
 * That was not merely redundant, it was wrong. `drizzleTableToTableSpec`
 * reports a PostgreSQL boolean as `boolean` and `renderDialectType` reports
 * it as `bool`; `normalizeType` maps both to `bool`, so a real diff sees one
 * type where a string comparison saw two. The duplicate would have reported
 * DRIFT on a database that was entirely correct — precisely the failure
 * adoption exists to prevent.
 */

/**
 * Everything one dialect needs from a module, with its absences resolved once.
 *
 * A module generated before a dialect was supported has no entry for it, and
 * every reader would otherwise repeat the same `?? []`. Resolving here means a
 * missing dialect is "nothing to do" in one place rather than a crash in
 * whichever reader forgot — and a crash during a migration is the worst moment
 * for one.
 */
function endpointsFor(
  migration: PluginMigration,
  dialect: SupportedDialect
): {
  before: TableSpec[];
  target: TableSpec[];
  up: string[];
  names: string[];
} {
  const target = migration.snapshot[dialect]?.tables ?? [];
  return {
    before: migration.before[dialect]?.tables ?? [],
    target,
    up: migration.dialects[dialect]?.up ?? [],
    names: target.map(table => table.name),
  };
}

/**
 * Apply one module: decide, execute if needed, record.
 *
 * Split out so the loop below reads as the ORDER it enforces and this reads as
 * what happens to a single module. The two were one function, and the ordering
 * rule — the property that actually matters — was buried in it.
 */
async function applyModule(
  set: PluginMigrationSet,
  migration: PluginMigration,
  deps: RunPluginMigrationsDeps
): Promise<ModuleOutcome> {
  // Checked before anything is read from the database: a module whose SQL was
  // edited after generation must be refused whatever the live state is.
  assertModuleIntact(set.pluginName, migration);

  const filename = qualifiedFilename(set.pluginName, migration.name);
  const alreadyInLedger = deps.appliedShas.has(filename);
  if (alreadyInLedger) {
    assertAppliedUnchanged(
      set.pluginName,
      migration,
      deps.appliedShas.get(filename) ?? null
    );
  }

  if (alreadyInLedger) return "skipped";

  const { before, target, up, names } = endpointsFor(migration, deps.dialect);

  // The decision is `reconcileFile`'s, not ours. It diffs the snapshots, which
  // is what makes an adopted table that merely SPELLS a type differently — a
  // PostgreSQL `boolean` against a rendered `bool` — compare equal.
  let executed = 0;
  const { state } = await deps.reconcile({
    file: {
      filename,
      sql: up.join(";\n"),
      path: filename,
      sha256: migrationChecksum(migration.dialects),
    },
    before: { tables: before },
    target: { tables: target },
    live: { tables: await deps.introspect(names) },
    executeSql: async (sql: string) => {
      executed = await deps.execute(sql.split(";\n").filter(Boolean));
      return executed;
    },
  });

  const outcome: ModuleOutcome =
    state === "already_applied" ? "adopted" : "applied";

  await deps.record({
    filename,
    pluginName: set.pluginName,
    pluginVersion: set.pluginVersion,
    schemaVersion: migration.schemaVersion,
    sha256: migrationChecksum(migration.dialects),
    outcome,
    statementsExecuted: executed,
    tables: names,
  });
  return outcome;
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
): Promise<PluginMigrationResult> {
  const result: PluginMigrationResult = { applied: 0, adopted: 0, skipped: 0 };
  for (const set of sets) {
    for (const migration of orderedMigrations(set.migrations)) {
      // Not caught: the first failure must stop later plugins and the app
      // phase, which assume a state that was never reached.
      result[await applyModule(set, migration, deps)] += 1;
    }
  }
  return result;
}
