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
import {
  indexCatalog,
  resolveCatalogName,
  type IdentifierCaseRules,
} from "../../schema/utils/resolve-catalog-name";
import {
  forgetFieldGroupStorageNames,
  resolveRegistryNameFromCatalog,
} from "../storage/resolve-storage-names";

import { resolveStorageVerdict } from "./guard";
import {
  buildMigrationManifest,
  hashManifest,
  hashRegistryIdentity,
  MIGRATION_TARGET,
  tableRenamesOf,
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
  | {
      ran: false;
      reason: "dry-run";
      direction: MigrationDirection;
      /**
       * Every table the run would rename, in execution order, companions included.
       *
       * 🔴 Deliberately NOT a step count. A run also rewrites customer rows and passes settlement
       * gates, and those outnumber the renames; reporting a number derived from renames alone
       * would understate the work while looking authoritative, and computing a second definition
       * of the plan's size is how it drifts from the one that executes. What a caller can rely on
       * here is exactly what it says: the storage objects that change name.
       */
      renames: readonly { readonly from: string; readonly to: string }[];
    }
  | { ran: true; direction: MigrationDirection; steps: number };

export interface RunMigrationArgs {
  adapter: DrizzleAdapter;
  logger: Logger;
  /** `up` unless an operator is explicitly rolling back. */
  direction: MigrationDirection;
  /**
   * Report what the run would do without changing any content or recording any intent.
   *
   * 🔴 It is NOT read-only, and the difference matters to whoever runs it. Claiming the session
   * lock creates `nextly_field_group_lock` if absent and writes an owner into it, so a dry run
   * issues DDL on first use and fails outright for a role with read-only privileges. That is a
   * narrower promise than "writes nothing", which is what this said before, and the honest one:
   * no content is touched and no migration marker is recorded, but the lock is real.
   *
   * The lock is deliberate rather than incidental. A plan reported while another run mutates
   * storage describes a world that no longer exists by the time it is read, and this lock refuses
   * rather than waits, so contention surfaces as a refusal instead of a stale answer. Making the
   * preview usable by a read-only operator means building it outside the session, which changes
   * that guarantee rather than preserving it, and is tracked separately.
   *
   * Stops immediately after the plan has been reconciled against the live catalog, which is the
   * last point before anything is recorded. That placement is the whole value: a plan reported
   * before reconciliation describes what the manifest says rather than what this database will
   * actually accept, and the discrepancies between those two are exactly what an operator runs a
   * dry run to find.
   *
   * The session lock is still taken. A report built while another run is mutating storage
   * describes a world that no longer exists by the time it is read, and the lock refuses rather
   * than waits, so contention surfaces as a refusal rather than as a stale answer.
   */
  dryRun?: boolean;
  /**
   * The operator states that a restorable backup exists.
   *
   * Required for a run that writes, and deliberately not defaulted. This migration rewrites stored
   * customer content, and while it is built to be resumable and reversible, neither property helps
   * against the failures that motivate a backup — a half-applied run on a database whose disk fills,
   * a rollback whose recorded plan was lost, an operator who discovers afterwards that the wrong
   * database was targeted.
   *
   * Asked for on every environment rather than only production. The engine cannot tell them apart
   * without reading configuration it otherwise never touches, and every guess is wrong in the
   * direction that matters: a staging database restored from production carries the same content
   * as production.
   *
   * A dry run does not require it, because a dry run writes no content and records no marker.
   * It is not read-only — see `dryRun` — but nothing it touches is a thing a backup would restore.
   */
  backupConfirmed?: boolean;
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
  const {
    adapter,
    logger,
    direction,
    dryRun = false,
    backupConfirmed = false,
  } = args;

  // 🔴 A precondition, so it runs before anything else — before the catalog reads, before the
  // lock. Placing it later would mean a refusal that has already contended for the lock and, on a
  // resumed run, already read a marker; a caller who forgot the acknowledgement would be told so
  // only after this had interfered with whatever else was trying to change schema.
  //
  // A dry run is exempt because it writes no content and records no marker, and exempting it is
  // what makes the gate usable:
  // the operator's first action is to see the plan, and demanding they assert a backup before they
  // are allowed to look at what would happen teaches them to assert it without meaning it.
  if (!dryRun && !backupConfirmed) {
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration refuses to run without a confirmed backup",
      logContext: {
        phase: FIELD_GROUP_MIGRATION_PHASE,
        reason: "no backup acknowledgement",
        direction,
      },
    });
  }

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
      const rows = await readRegistryRows(adapter, dialect, identifierCase);

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
          // The rows are checked as well as the structure. A marker can be
          // current and the content still wrong — restored from a backup taken
          // before the run, or repaired by hand — and a stale `_parent_table`
          // is invisible to a structural check while making nested content
          // invisible to a reader. The recorded plan is what names the storage
          // this run's generation renamed away; without one there is nothing to
          // scan for.
          renamedAway: renamedAwayNames(state.appliedManifest, generation),
          owned: ownedDataTableNames({
            rows,
            entries: state.appliedManifest ?? [],
          }),
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

      // The last point at which nothing has been written. Everything above reads: the marker, the
      // registry, the catalog, and the reconciliation of the plan against them. Returning here
      // reports a plan the database has already been scored against rather than one the manifest
      // merely proposes.
      if (dryRun) {
        // Expanded through the same helper the executable steps use. A localized field group
        // carries its companion `_locales` rename on the SAME manifest entry, so reading `from`
        // and `to` off the entry reports one rename where two will happen -- and the one it omits
        // is the one an operator is least likely to predict.
        // Entries the reconciliation found already applied are dropped. A resumed run starts
        // after the recorded step and a torn step skips a source that is already absent, so
        // reporting a satisfied entry tells the operator an object will be renamed that has
        // already moved — on a resume, which is exactly when they are deciding whether the
        // remaining work is safe to continue.
        const renames = reconciled
          .filter(entry => entry.satisfied !== true)
          .flatMap(entry => tableRenamesOf(entry));
        logger.info?.("field-group migration dry run", {
          phase: FIELD_GROUP_MIGRATION_PHASE,
          direction,
          renames: renames.length,
        });
        return { ran: false, reason: "dry-run", direction, renames };
      }

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
        // Deliberately the un-memoized resolver. Its memoized sibling would
        // answer with a name read before this run moved storage, which is the
        // one answer a check running after the renames must not be given.
        resolveRegistryTable: () => resolveRegistryNameFromCatalog(adapter),
      });

      // The settlement checks are gates rather than recorded work, so a marker
      // never points past them and a resume re-enters them on its own.
      const fromStep = state.status === "migrating" ? state.step + 1 : 1;
      // 🔴 Invalidated whenever the steps may have RUN, not only when the run
      // reports success. A rename can commit and `assertStorageComplete` or
      // `settleMigration` can then throw — at which point the memoized registry
      // name in this process points at a table that no longer exists, and every
      // recovery attempt addresses the wrong one. The memo is a schema fact;
      // the moment storage may have moved, the honest answer is "I no longer
      // know", and one extra catalog read is the whole cost of saying so.
      try {
        await runMigrationSteps({
          session,
          meta,
          migrationId,
          steps,
          fromStep,
        });

        // The structural half of the question the settle steps ask about
        // vocabulary. Asked of the database rather than inferred from the steps
        // having run: a step reports its own postcondition, while this asks
        // whether the storage as a whole is now what the generation claims,
        // which is the question a settled marker will be believed on afterwards.
        await assertStorageComplete({
          adapter,
          dialect,
          rows: await readRegistryRows(adapter, dialect, identifierCase),
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
      } finally {
        forgetFieldGroupStorageNames(adapter);
      }

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
 * The names a completed run of this direction renamed away.
 *
 * Taken from the recorded plan rather than recomputed, for the reason a
 * rollback needs it recorded at all: nothing in the database distinguishes an
 * `fg_*` name this migration created from one an author chose before it
 * existed. Going up, the legacy spellings are the ones no row may still
 * address; going down it is the migrated ones.
 */
function renamedAwayNames(
  applied: readonly ManifestEntry[] | undefined,
  generation: StorageGeneration
): string[] {
  if (applied === undefined) return [];
  return applied
    .filter(entry => entry.kind === "table")
    .map(entry => (generation === "field-groups-v2" ? entry.from : entry.to));
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
  renamedAway: readonly string[];
  owned: readonly string[];
}): Promise<void> {
  const { tables, columns } = await readCatalog(args.adapter, args.dialect);
  await assertNoStaleParentPointers({
    query: statement => args.adapter.queryStatement(statement),
    columns,
    identifierCase: args.identifierCase,
    owned: args.owned,
    staleNames: args.renamedAway,
    maxParams: args.adapter.getCapabilities().maxParamsPerQuery,
  });
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
  adapter: DrizzleAdapter,
  dialect: MigrationDialect,
  identifierCase: IdentifierCaseRules
): Promise<RegistryRow[]> {
  const table = (await adapter.tableExists(STORAGE_FORMAT.registryTable))
    ? STORAGE_FORMAT.registryTable
    : (await adapter.tableExists(MIGRATION_TARGET.registryTable))
      ? MIGRATION_TARGET.registryTable
      : undefined;
  if (table === undefined) return [];

  const rows = await readRegistryTable(adapter, dialect, identifierCase, table);

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
 * Read the registry, asking the catalog whether the i18n column is there.
 *
 * `localized` is added by the core-schema reconcile, so a database that has not
 * run it yet does not have the column and selecting it would throw. Such a
 * database also has no companion tables at all, which is why its absence means
 * every row is not localized rather than unknown: that is the true answer
 * there, not a guess.
 *
 * 🔴 Decided from the catalog rather than by catching the failed select and
 * matching its message. Drizzle wraps a driver error as `Failed query: <the
 * SQL>`, so the query's own text — which names `localized` — is inside every
 * message it can produce. A predicate reading that would fall back on *any*
 * failure, a permission error on that one column included, then classify every
 * companion as absent and settle the migration with localized storage still
 * under its legacy name. Asking what the columns are is the same question
 * without the ambiguity.
 *
 * Issued as Drizzle statements rather than through the typed query builder: that
 * resolves a table through the schema registry, and mid-run the registry is
 * under whichever name the plan has reached.
 */
async function readRegistryTable(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect,
  identifierCase: IdentifierCaseRules,
  table: string
): Promise<RegistryTableRow[]> {
  const columns = [
    sql.identifier("id"),
    sql.identifier("slug"),
    sql.identifier("table_name"),
  ];
  if (await hasLocalizedColumn(adapter, dialect, identifierCase, table)) {
    columns.push(sql.identifier("localized"));
  }
  return adapter.queryStatement<RegistryTableRow>(
    sql`SELECT ${sql.join(columns, sql`, `)} FROM ${sql.identifier(table)}`
  );
}

/** Whether the registry carries the i18n flag, per the catalog. */
async function hasLocalizedColumn(
  adapter: DrizzleAdapter,
  dialect: MigrationDialect,
  identifierCase: IdentifierCaseRules,
  table: string
): Promise<boolean> {
  const snapshot = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
    table,
  ]);
  // Matched under the server's own rules, not by exact spelling: MySQL with
  // `lower_case_table_names=1` reports a lowercased name for a table asked for
  // under another case, and an exact comparison would discard the snapshot
  // describing the very table requested.
  const catalog = indexCatalog(
    snapshot.tables.map(entry => entry.name),
    identifierCase.tables
  );
  const resolved = resolveCatalogName(catalog, table);
  const spec = snapshot.tables.find(entry => entry.name === resolved);
  if (spec === undefined) return false;
  return (
    resolveCatalogName(
      indexCatalog(
        spec.columns.map(column => column.name),
        identifierCase.columns
      ),
      "localized"
    ) !== undefined
  );
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
