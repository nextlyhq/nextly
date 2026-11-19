/**
 * A Schema Builder save's drift refusal, told with the Builder's way on: the one step that works for
 * a save, whose refusal leaves its files withdrawn.
 *
 * @module domains/schema/builder-save/builder-save-drift
 */
import { NextlyError } from "../../../errors/nextly-error";
import { migrationDriftError, type DriftItem } from "../migrate/drift-error";

/**
 * `error` told with the Builder's way on (`migrationDriftError`'s `builderSave`) where it is a
 * drift refusal naming its differences: the file road's reconcile, the push's check before it
 * (`refuseDriftBeforePush`) and the translations table's (`refuseCompanionDrift`). Each refuses
 * before anything runs, and the save withdraws its files, so `nextly migrate`'s recoveries, which
 * name the file or compare the definitions with the history, have nothing to act on. Any other
 * error is answered as it is: a database never adopted has its own recovery, a refusal after the
 * push (`recordWhatWasPushed`) keeps the files and names the one to record, and so does a refusal
 * that came after an earlier file of the save applied (`partlyAppliedChange` names the `keptFiles`
 * and how to record them): the database already holds part of the change.
 */
export function asBuilderSaveDrift(error: unknown): unknown {
  if (!NextlyError.is(error) || error.code !== "NEXTLY_MIGRATION_DRIFT") {
    return error;
  }
  const context = error.logContext ?? {};
  const driftItems: unknown = context.driftItems;
  if (
    !Array.isArray(driftItems) ||
    !driftItems.every(isDriftItem) ||
    context.unadoptedDatabase === true ||
    context.keptFiles !== undefined ||
    typeof context.migration !== "string"
  ) {
    return error;
  }
  return migrationDriftError({
    migration: context.migration,
    file: `${context.migration}.sql`,
    driftItems,
    builderSave: true,
  });
}

/** Whether `value` is a drift line as `migrationDriftError` records it. */
function isDriftItem(value: unknown): value is DriftItem {
  if (typeof value !== "object" || value === null) return false;
  const { kind, detail } = value as { kind?: unknown; detail?: unknown };
  return (
    (kind === "+" || kind === "-" || kind === "?") && typeof detail === "string"
  );
}
