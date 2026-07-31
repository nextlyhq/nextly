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
import { assertNoStaleParentPointers } from "./parent-pointers";
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
  readMigrationState,
  settleMigration,
  type MigrationDirection,
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

  const state = await readMigrationState(meta);

  // Settled at the target generation and going up: the work is done. Asked
  // before anything else so the ordinary case costs one read.
  if (
    state.status === "settled" &&
    ((direction === "up" && state.generation === "field-groups-v2") ||
      (direction === "down" && state.generation === "legacy"))
  ) {
    return { ran: false, reason: "already-migrated" };
  }

  // A rollback needs the plan that was applied; nothing else can supply it,
  // because the database cannot say which names this migration created.
  if (direction === "down" && state.status === "settled") {
    if (state.appliedManifest === undefined) {
      throw NextlyError.serviceUnavailable({
        logMessage:
          "field-group migration cannot roll back: no record of what was applied",
        logContext: {
          phase: FIELD_GROUP_MIGRATION_PHASE,
          reason: "rollback has no recorded plan",
        },
      });
    }
  }

  // Everything the plan is derived from is read INSIDE the lock. Reading the
  // registry, the catalog and the marker first and contending afterwards leaves
  // a window in which a `db:sync` holding this same lock finishes a schema
  // change, and the run then executes a plan describing a world that has moved.
  return withMigrationSession(
    { adapter, dialect, label: `field-group-migration:${direction}` },
    async session => {
      const rows = await readRegistryRows(adapter);

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
      const generation = direction === "up" ? "field-groups-v2" : "legacy";
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
 * to serve what it holds. The first reuses the read-path's own verdict rather
 * than asking a second, similar question: whatever would refuse to *serve* this
 * storage must also refuse to declare the migration finished, or the two would
 * disagree and the marker would be the more trusted of the pair. The second asks
 * the rows, because the verdict is a judgement about tables and columns and says
 * nothing about what the rows inside them address.
 */
async function assertStorageComplete(args: {
  adapter: DrizzleAdapter;
  dialect: MigrationDialect;
  rows: readonly RegistryRow[];
  identifierCase: IdentifierCaseRules;
  renamedAway: readonly string[];
  generation: "legacy" | "field-groups-v2";
}): Promise<void> {
  const { tables, columns } = await readCatalog(args.adapter, args.dialect);
  await assertNoStaleParentPointers({
    query: statement => args.adapter.queryStatement(statement),
    columns,
    identifierCase: args.identifierCase,
    staleNames: args.renamedAway,
  });
  const probe = probeStorage({
    rows: args.rows,
    tables,
    columns,
    identifierCase: args.identifierCase,
    generation: args.generation,
  });

  // `resolveStorageVerdict` throws on anything it cannot explain, so reaching a
  // verdict at all is most of the check. What remains is that the verdict names
  // the generation this run claims to have produced: an `up` run that leaves
  // storage the read path would still serve as legacy has not finished.
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
      "field-group migration will not settle: storage is not in the state the run claims",
    logContext: {
      phase: FIELD_GROUP_MIGRATION_PHASE,
      reason: "structural verification failed after the steps ran",
      generation: args.generation,
      expected,
      actual: verdict.action,
    },
  });
}

/**
 * Registry rows, read from whichever registry is present.
 *
 * Legacy first, then the migrated name. The registry renames last, so for every
 * step but the final one the rows are still under the legacy name — and the
 * final step has the same commit-before-marker window as any other, so a resume
 * has to find them under the new one.
 */
async function readRegistryRows(
  adapter: DrizzleAdapter
): Promise<RegistryRow[]> {
  const table = (await adapter.tableExists(STORAGE_FORMAT.registryTable))
    ? STORAGE_FORMAT.registryTable
    : (await adapter.tableExists(MIGRATION_TARGET.registryTable))
      ? MIGRATION_TARGET.registryTable
      : undefined;
  if (table === undefined) return [];

  // Issued as a Drizzle statement rather than through the typed query builder:
  // that resolves a table through the schema registry, and mid-run the registry
  // is under whichever name the plan has reached.
  const rows = await adapter.queryStatement<{
    id: string;
    slug: string;
    table_name: string;
  }>(
    sql`SELECT ${sql.identifier("id")}, ${sql.identifier("slug")}, ${sql.identifier("table_name")}
        FROM ${sql.identifier(table)}`
  );

  const suffix = STORAGE_FORMAT.companionSuffix;
  const out: RegistryRow[] = [];
  for (const row of rows) {
    // Read from the catalog rather than inferred from a `localized` flag: a
    // localized group with no translatable fields has no companion, and the
    // plan must not name a table that was never created.
    const hasCompanion = await adapter.tableExists(
      `${row.table_name}${suffix}`
    );
    out.push({
      id: String(row.id),
      slug: String(row.slug),
      tableName: String(row.table_name),
      hasCompanion,
    });
  }
  return out;
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
