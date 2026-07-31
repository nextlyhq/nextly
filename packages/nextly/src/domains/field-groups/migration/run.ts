/**
 * Runs the field-group storage migration end to end.
 *
 * Everything else in this directory decides one thing well: what to rename, what
 * a marker means, how a step verifies itself. This module is the only place that
 * puts them in order, and the order is the safety argument:
 *
 *   read the world → reconcile the plan against it → take the lock →
 *   record the intent → execute → verify structurally → settle
 *
 * Recording before executing is deliberate and costs a write that is usually
 * wasted. MySQL commits DDL as it is issued, so a crash between the first rename
 * and a marker written afterwards would leave renamed objects with nothing
 * recording that a run had started — indistinguishable from a database that was
 * always that way.
 *
 * @module domains/field-groups/migration/run
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { Logger } from "../../../shared/types";
import { MetaService } from "../../meta/services/meta-service";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { readIdentifierCaseRules } from "../../schema/utils/read-identifier-case";
import type { IdentifierCaseRules } from "../../schema/utils/resolve-catalog-name";

import { resolveStorageVerdict } from "./guard";
import {
  buildMigrationManifest,
  hashManifest,
  hashRegistryIdentity,
  MIGRATION_TARGET,
  type ManifestEntry,
  type RegistryRow,
} from "./manifest";
import { createStorageObserver } from "./observer";
import {
  assertNoStaleParentPointers,
  ownedDataTableNames,
} from "./parent-pointers";
import {
  buildMigrationPlan,
  dataStepCount,
  directedRenameEntries,
  renamePositionOffset,
  renameRunRecord,
} from "./plan";
import { probeStorage, reconcilePlan, type TableColumns } from "./reconcile";
import { runMigrationSteps } from "./runner";
import { withMigrationSession, type MigrationDialect } from "./session";
import {
  beginMigration,
  MIGRATION_MARKER_VERSION,
  MIN_COMPLETE_MARKER_VERSION,
  readMigrationState,
  settleMigration,
  type MigrationDirection,
  type StorageGeneration,
} from "./state";

/**
 * Stamped into every refusal this phase raises.
 *
 * Callers that treat a failed file migration as survivable have to tell the two
 * apart, and matching on message text would let a reworded message quietly turn
 * a fatal failure back into a tolerated one.
 */
export const FIELD_GROUP_MIGRATION_PHASE = "field-group-storage-migration";

/** What a run did, for the caller to report. */
export type MigrationOutcome =
  | { ran: false; reason: "already-migrated" | "nothing-to-migrate" }
  | { ran: true; direction: MigrationDirection; steps: number };

export interface RunMigrationArgs {
  adapter: DrizzleAdapter;
  logger: Logger;
  /** `up` unless an operator is explicitly rolling back. */
  direction: MigrationDirection;
}

/**
 * Migrate field-group storage, or report why there was nothing to do.
 *
 * Idempotent: a database already at the target generation returns without
 * touching anything, which is what lets this sit on a path that runs on every
 * deploy rather than needing to be invoked once and remembered.
 */
export async function runFieldGroupMigration(
  args: RunMigrationArgs
): Promise<MigrationOutcome> {
  const { adapter, logger, direction } = args;
  const dialect: MigrationDialect = adapter.getCapabilities().dialect;
  // Read from the server, not derived from the dialect. MySQL folds table names
  // or not depending on `lower_case_table_names`, which is configuration rather
  // than a property of the dialect, and guessing it makes a present table look
  // missing or two distinct tables look like one.
  const identifierCase = await readIdentifierCaseRules(adapter);
  const meta = new MetaService(adapter, logger);
  const generation = direction === "up" ? "field-groups-v2" : "legacy";

  // 🔴 Everything this run decides is read INSIDE the lock, the marker
  // included. Reading it first and contending afterwards leaves a window in
  // which another invocation completes the whole migration and releases the
  // lock: this one would then acquire it holding a marker that says legacy,
  // rebuild an upward plan against already-migrated storage, and overwrite a
  // settled marker with a fresh in-flight one. The same window lets a `db:sync`
  // holding this lock finish a schema change the plan was not built against.
  //
  // The cost is that even an already-migrated database claims the lock to find
  // that out. That is the correct trade here, where being wrong rewrites
  // customer data — but it makes "who calls this, and how often" a decision the
  // entry point owns: this lock refuses rather than waits, so a fleet whose
  // instances all invoke it at boot would have every instance but one refuse.
  return withMigrationSession(
    { adapter, dialect, label: `field-group-migration:${direction}` },
    async session => {
      const state = await readMigrationState(meta);
      const rows = await readRegistryRows(adapter);

      // Settled at the generation this run would produce: the work is done.
      // Confirmed against the catalog rather than taken from the marker alone,
      // because the two can disagree — storage restored from a backup taken
      // before the run, or a table dropped since — and a marker believed on its
      // own would report success over storage the read path cannot serve.
      if (state.status === "settled" && state.generation === generation) {
        // 🔴 Asked before the catalog, because it is the question the catalog
        // cannot answer. A marker written by an older build claims a generation
        // that build defined, and this one performs work that build did not:
        // the tables and columns would all check out while stored field
        // definitions, ledger keys and parent pointers still held the legacy
        // vocabulary. Refusing is the only honest answer — the data steps
        // address the registry under its legacy name, so this build cannot
        // simply finish the job on storage whose registry has already moved.
        if (
          state.generation === "field-groups-v2" &&
          state.version !== undefined &&
          state.version < MIN_COMPLETE_MARKER_VERSION
        ) {
          throw NextlyError.serviceUnavailable({
            logMessage:
              "field-group migration cannot accept a marker written before this build's storage work existed",
            logContext: {
              phase: FIELD_GROUP_MIGRATION_PHASE,
              reason: "settled marker predates work this build performs",
              recordedVersion: state.version,
              requiredVersion: MIN_COMPLETE_MARKER_VERSION,
            },
          });
        }
        await assertStorageAtGeneration({
          adapter,
          dialect,
          rows,
          identifierCase,
          generation,
        });
        return { ran: false, reason: "already-migrated" };
      }

      // A rollback needs the plan that was applied; nothing else can supply it,
      // because the database cannot say which names this migration created.
      if (
        direction === "down" &&
        state.status === "settled" &&
        state.appliedManifest === undefined
      ) {
        throw NextlyError.serviceUnavailable({
          logMessage:
            "field-group migration cannot roll back: no record of what was applied",
          logContext: {
            phase: FIELD_GROUP_MIGRATION_PHASE,
            reason: "rollback has no recorded plan",
          },
        });
      }

      // Derived from the rows so a resume that has to rebuild it - a crash
      // before the marker's first write - produces the same value rather than a
      // second identity for the same work.
      const migrationId =
        state.status === "migrating" ? state.migrationId : newMigrationId(rows);

      // The canonical plan is always legacy-to-migrated. A run in flight
      // executes the one it recorded; a rollback reverses the recorded one; a
      // fresh run builds it from the registry.
      const entries: readonly ManifestEntry[] =
        state.status === "migrating"
          ? state.appliedManifest
          : direction === "down" && state.appliedManifest !== undefined
            ? state.appliedManifest
            : buildMigrationManifest(rows).entries;

      const registryHash = hashRegistryIdentity(rows);
      const manifestHash = hashManifest(entries);

      if (state.status === "migrating") {
        if (state.plan.registryHash !== registryHash) {
          throw NextlyError.serviceUnavailable({
            logMessage:
              "field-group migration cannot resume: the set of field groups changed since the interrupted run",
            logContext: {
              phase: FIELD_GROUP_MIGRATION_PHASE,
              reason:
                "the set of field groups changed since the interrupted run",
              recorded: state.plan.registryHash,
              current: registryHash,
            },
          });
        }
        if (state.direction !== direction) {
          throw NextlyError.serviceUnavailable({
            logMessage: `field-group migration cannot run ${direction}: a ${state.direction} run is in flight`,
            logContext: {
              phase: FIELD_GROUP_MIGRATION_PHASE,
              reason: "a run in the other direction is in flight",
              recorded: state.direction,
              requested: direction,
            },
          });
        }
      }

      const { tables, columns } = await readCatalog(adapter, dialect);

      // Reconciled in the direction that will execute. A rollback scored
      // against the canonical plan asks whether the legacy names are present,
      // finds the migrated ones instead, and refuses the very run that would
      // restore them.
      const directed = directedRenameEntries(direction, entries);
      // Enumerated from what Nextly knows it owns rather than recognised by
      // shape. Nextly runs inside the user's own database, and a table of
      // theirs that happens to carry the parent-pointer column would otherwise
      // be rewritten. Both spellings of every rename are included, because a
      // resumed run can meet either one in the catalog.
      const owned = ownedDataTableNames({ rows, entries: directed });
      const dataSteps = dataStepCount({ meta, migrationId });
      const offset = renamePositionOffset(direction, dataSteps);
      const reconciled = reconcilePlan({
        entries: directed,
        rows,
        tables,
        columns,
        // Translated out of whole-plan coordinates. The marker counts every
        // step, and going up the data rewrites hold the first positions, so a
        // recorded position handed over untranslated would mark that many
        // renames as already verified.
        run: renameRunRecord({
          status: state.status,
          direction: state.status === "migrating" ? state.direction : direction,
          step: state.status === "migrating" ? state.step : 0,
          offset,
        }),
        direction,
        identifierCase,
      });

      // Written before the first statement, never after. A crash between a
      // rename and a post-hoc marker write would leave moved objects with no
      // record that a run had started.
      if (state.status !== "migrating") {
        await beginMigration(meta, {
          direction,
          migrationId,
          plan: { registryHash, manifestHash },
          appliedManifest: entries,
        });
      }

      const steps = buildMigrationPlan({
        direction,
        entries: reconciled,
        identifierCase,
        observer: createStorageObserver(adapter, identifierCase),
        meta,
        migrationId,
        ownedDataTables: owned,
      });

      const fromStep = state.status === "migrating" ? state.step + 1 : 1;
      await runMigrationSteps({
        session,
        meta,
        migrationId,
        steps,
        fromStep,
      });

      // Asked of the database rather than inferred from the steps having run.
      // A step reports its own postcondition; this asks whether the storage as
      // a whole is now what the generation claims, which is the question a
      // settled marker will be believed on afterwards.
      await assertStorageComplete({
        adapter,
        dialect,
        rows: await readRegistryRows(adapter),
        identifierCase,
        // Every name this run renamed away. A row still addressing one of them
        // is content the read path would return nothing for, and it is asked
        // about here rather than per step because the failure worth catching is
        // a data table no step ever observed.
        renamedAway: directed
          .filter(entry => entry.kind === "table")
          .map(entry => entry.from),
        owned,
        generation,
      });

      await settleMigration(
        meta,
        generation === "field-groups-v2"
          ? { generation, appliedManifest: entries }
          : { generation }
      );

      logger.info(
        `Field group storage migrated ${direction} (${String(steps.length)} steps).`
      );
      return { ran: true, direction, steps: steps.length };
    }
  );
}

/**
 * Verification, run before the marker is allowed to settle.
 *
 * Two questions, because storage can be structurally complete and still unable
 * to serve what it holds: the structural one below, and whether any row still
 * addresses a table this run renamed away. The verdict is a judgement about
 * tables and columns and says nothing about what the rows inside them point at.
 */
async function assertStorageComplete(args: {
  adapter: DrizzleAdapter;
  dialect: MigrationDialect;
  rows: readonly RegistryRow[];
  identifierCase: IdentifierCaseRules;
  renamedAway: readonly string[];
  owned: readonly string[];
  generation: StorageGeneration;
}): Promise<void> {
  const { tables, columns } = await readCatalog(args.adapter, args.dialect);
  await assertNoStaleParentPointers({
    query: statement => args.adapter.queryStatement(statement),
    columns,
    identifierCase: args.identifierCase,
    owned: args.owned,
    staleNames: args.renamedAway,
    // Honoured rather than assumed generous: SQLite advertises 999 where the
    // other two advertise 65535, and this runs after every rename has
    // committed, so an over-long statement would strand a finished migration.
    maxParams: args.adapter.getCapabilities().maxParamsPerQuery,
  });
  assertProbeMatchesGeneration({
    rows: args.rows,
    tables,
    columns,
    identifierCase: args.identifierCase,
    generation: args.generation,
    reason: "structural verification failed after the steps ran",
  });
}

/**
 * The structural half on its own, for a run that executed nothing.
 *
 * A marker claiming a generation and storage actually being at one are separate
 * facts, and they come apart in ways no run causes: a restore from a backup
 * taken before the migration, a table dropped by hand, a partial recovery. The
 * marker is the faster answer and the less trustworthy one, so reporting
 * `already-migrated` on its word alone would turn every later invocation into a
 * report of success over storage the read path cannot serve.
 */
async function assertStorageAtGeneration(args: {
  adapter: DrizzleAdapter;
  dialect: MigrationDialect;
  rows: readonly RegistryRow[];
  identifierCase: IdentifierCaseRules;
  generation: StorageGeneration;
}): Promise<void> {
  const { tables, columns } = await readCatalog(args.adapter, args.dialect);
  assertProbeMatchesGeneration({
    rows: args.rows,
    tables,
    columns,
    identifierCase: args.identifierCase,
    generation: args.generation,
    reason: "a settled marker does not match the storage it describes",
  });
}

/**
 * Refuse unless the catalog says what the generation claims.
 *
 * Reuses the read path's own verdict rather than asking a second, similar
 * question: whatever would refuse to *serve* this storage must also refuse to
 * call it migrated, or the two would disagree and the marker would be the more
 * trusted of the pair.
 */
function assertProbeMatchesGeneration(args: {
  rows: readonly RegistryRow[];
  tables: string[];
  columns: TableColumns[];
  identifierCase: IdentifierCaseRules;
  generation: StorageGeneration;
  reason: string;
}): void {
  const probe = probeStorage({
    rows: args.rows,
    tables: args.tables,
    columns: args.columns,
    identifierCase: args.identifierCase,
    generation: args.generation,
  });

  // `resolveStorageVerdict` throws on anything it cannot explain, so reaching a
  // verdict at all is most of the check. What remains is that the verdict names
  // the generation being claimed: an `up` run that leaves storage the read path
  // would still serve as legacy has not finished.
  const expected =
    args.generation === "field-groups-v2"
      ? "use-field-groups-v2"
      : "use-legacy";
  const verdict = resolveStorageVerdict({
    state: {
      status: "settled",
      generation: args.generation,
      recorded: true,
    },
    probe,
  });

  if (verdict.action === expected) return;

  throw NextlyError.serviceUnavailable({
    logMessage:
      "field-group migration will not report success: storage is not in the state the marker claims",
    logContext: {
      phase: FIELD_GROUP_MIGRATION_PHASE,
      reason: args.reason,
      generation: args.generation,
      expected,
      actual: verdict.action,
    },
  });
}

/**
 * Registry rows, read from whichever registry is present.
 *
 * Exported for its own tests: `hasCompanion` decides whether a table enters the
 * rename plan, and that decision is not observable from the outcome of a run
 * that reports there is nothing to do.
 *
 * Legacy first, then the migrated name. The registry renames last, so for every
 * step but the final one the rows are still under the legacy name — and the
 * final step has the same commit-before-marker window as any other, so a resume
 * has to find them under the new one.
 */
export async function readRegistryRows(
  adapter: DrizzleAdapter
): Promise<RegistryRow[]> {
  const table = (await adapter.tableExists(STORAGE_FORMAT.registryTable))
    ? STORAGE_FORMAT.registryTable
    : (await adapter.tableExists(MIGRATION_TARGET.registryTable))
      ? MIGRATION_TARGET.registryTable
      : undefined;
  if (table === undefined) return [];

  const rows = await readRegistryTable(adapter, table);

  const suffix = STORAGE_FORMAT.companionSuffix;
  const out: RegistryRow[] = [];
  for (const row of rows) {
    // 🔴 Both conditions, and neither alone is enough.
    //
    // The catalog is asked because a localized group with no translatable
    // fields has no companion, and the plan must not name a table that was
    // never created. The registry's own flag is asked because presence is not
    // ownership: Nextly runs inside the user's database, and a table of theirs
    // that happens to be called `<field group>_locales` would otherwise be
    // adopted into the plan and renamed out from under them. A group that is
    // not localized has no companion, whatever sits on the derived name.
    //
    // A leftover companion from a group since un-localized is left behind by
    // this rule rather than renamed. That is the safe direction: nothing reads
    // it, whereas renaming a table Nextly does not own is not recoverable.
    const hasCompanion =
      isLocalized(row.localized) &&
      (await adapter.tableExists(`${row.table_name}${suffix}`));
    out.push({
      id: String(row.id),
      slug: String(row.slug),
      tableName: String(row.table_name),
      hasCompanion,
    });
  }
  return out;
}

/** One registry row, as far as reading it here is concerned. */
interface RegistryTableRow {
  id: string;
  slug: string;
  table_name: string;
  localized?: boolean | number | null;
}

/**
 * Whether a registry row's localization flag is set.
 *
 * Both forms are accepted because both are stored: Postgres holds a boolean
 * where MySQL and SQLite hold `1`/`0`. Anything else — including the column
 * being absent on a database that predates it — reads as not localized, which
 * is the true answer there rather than a guess. Matches
 * `di/load-dynamic-tables.ts`, which reads the same column for the same reason.
 */
function isLocalized(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

/**
 * Read the registry, tolerating a database that predates the i18n column.
 *
 * `localized` is added by the core-schema reconcile, so a database that has not
 * run it yet does not have the column and selecting it throws. Such a database
 * also has no companion tables at all, which is why the fallback reports every
 * row as not localized rather than as unknown: that is the true answer there,
 * not a guess. The same tolerance exists in `di/load-dynamic-tables.ts`, for the
 * same reason.
 *
 * Issued as Drizzle statements rather than through the typed query builder: that
 * resolves a table through the schema registry, and mid-run the registry is
 * under whichever name the plan has reached.
 */
async function readRegistryTable(
  adapter: DrizzleAdapter,
  table: string
): Promise<RegistryTableRow[]> {
  const columns = [
    sql.identifier("id"),
    sql.identifier("slug"),
    sql.identifier("table_name"),
  ];
  try {
    return await adapter.queryStatement<RegistryTableRow>(
      sql`SELECT ${sql.join(columns, sql`, `)}, ${sql.identifier("localized")}
          FROM ${sql.identifier(table)}`
    );
  } catch (error) {
    // Only a MISSING column may fall back. A transient, permission or
    // missing-table failure has to propagate: converting one of those into
    // "nothing is localized" would drop every companion from the plan and leave
    // real storage behind under its legacy name.
    const message = error instanceof Error ? error.message : String(error);
    if (
      !/localized|no such column|does not exist|unknown column/i.test(message)
    ) {
      throw error;
    }
    return adapter.queryStatement<RegistryTableRow>(
      sql`SELECT ${sql.join(columns, sql`, `)} FROM ${sql.identifier(table)}`
    );
  }
}

/** Every table name, and the columns of the ones the plan cares about. */
async function readCatalog(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect
): Promise<{ tables: string[]; columns: TableColumns[] }> {
  const tables = await adapter.listTables();
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    dialect,
    tables
  );
  return {
    tables,
    columns: snapshot.tables.map(table => ({
      table: table.name,
      columns: table.columns.map(column => column.name),
    })),
  };
}

/**
 * A run identifier derived from what the run is against.
 *
 * Deterministic rather than random, so a resume that has to rebuild it — a
 * crash before the marker's first write — produces the same value instead of
 * a second identity for the same work.
 */
function newMigrationId(rows: readonly RegistryRow[]): string {
  return `fg-${hashRegistryIdentity(rows).slice(0, 16)}`;
}

/** Exported for the caller that reports what a marker version means. */
export { MIGRATION_MARKER_VERSION };
