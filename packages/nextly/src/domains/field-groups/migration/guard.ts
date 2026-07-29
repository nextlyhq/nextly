/**
 * Decides whether the field-group storage is safe to use.
 *
 * Two facts are combined: the durable marker, and whether objects carrying the
 * post-migration names are actually present. Neither alone is sufficient.
 *
 * The marker alone cannot tell us that a run which claims to be finished really
 * renamed anything. Object presence alone cannot tell us who created what: an
 * `fg_*` table may belong to the host application, and Nextly shares a database
 * with the app it runs inside. Only the pair is conclusive, and every
 * combination the pair cannot explain is refused rather than guessed at.
 *
 * This runs before the registry loads. The registry tolerates a missing data
 * table by design, so a check placed after it would inspect a world that had
 * already silently absorbed the very inconsistency being looked for.
 *
 * @module domains/field-groups/migration/guard
 */

import { NextlyError } from "../../../errors/nextly-error";

import type {
  MigrationDirection,
  MigrationPlanIdentity,
  MigrationState,
} from "./state";

/**
 * Whether every object the migrated registry points at is actually there and
 * actually migrated.
 *
 * `missing` names what was not found, so a refusal tells an operator which
 * objects to restore rather than only that something is wrong.
 */
export type MigratedObjectsVerification =
  | { complete: true }
  | { complete: false; missing: string[] };

/** What the caller found in the database. Gathering it is dialect-specific. */
export interface StorageProbe {
  /** A registry table carrying the post-migration name exists. */
  targetRegistryPresent: boolean;
  /** A registry table carrying the pre-migration name exists. */
  legacyRegistryPresent: boolean;
  /**
   * The result of checking the objects the migrated registry references, not
   * just the registry itself.
   *
   * `null` means no such check was performed. That is never sufficient to serve
   * migrated storage: the registry existing says nothing about whether the data
   * tables it points at survived, and the read path treats a missing data table
   * as an empty result rather than an error.
   */
  migratedObjects: MigratedObjectsVerification | null;
}

/**
 * What the caller should do next.
 *
 * The resume verdict carries everything a resume needs rather than leaving it
 * in the marker to be looked up separately: `direction` selects which step list
 * the step number indexes into, `migrationId` is the identity `advanceStep`
 * checks against, and `plan` is what the rebuilt plan must match. A consumer
 * that follows this type cannot resume in the wrong direction, mint an id that
 * will be rejected, or skip the plan comparison. See `assertPlanUnchanged`.
 */
export type StorageVerdict =
  | { action: "use-legacy" }
  | { action: "use-field-groups-v2" }
  | {
      action: "resume";
      step: number;
      direction: MigrationDirection;
      migrationId: string;
      plan: MigrationPlanIdentity;
    };

/**
 * Resolve state plus probe into an instruction, or throw.
 *
 * Every throw here is a deliberate refusal. None of these situations is
 * recoverable by guessing, and guessing wrong rewrites or drops customer data.
 */
export function resolveStorageVerdict(args: {
  state: MigrationState;
  probe: StorageProbe;
}): StorageVerdict {
  const { state, probe } = args;

  if (state.status === "migrating") {
    // A run died in flight. Resuming is the only safe move: the objects are in
    // a state only the step list can interpret. The run's own identity travels
    // with the step so the resumed run picks the right list, keeps the same id,
    // and can refuse a plan that moved underneath it.
    return {
      action: "resume",
      step: state.step + 1,
      direction: state.direction,
      migrationId: state.migrationId,
      plan: state.plan,
    };
  }

  if (state.generation === "field-groups-v2") {
    if (!probe.targetRegistryPresent) {
      // The marker claims the migration finished but the renamed registry is
      // gone. Something restored an older database under a newer marker, or
      // dropped the table. Serving would read the legacy registry while the
      // runtime writes post-migration names.
      throw refuse(
        "marker reports a completed migration but the migrated registry is absent",
        { generation: state.generation, probe }
      );
    }
    // The registry existing proves only that the registry exists. The objects
    // it points at are what content is actually read from, and the read path
    // treats a missing data table as an empty result rather than an error, so
    // an unverified or incomplete rename would serve blank content instead of
    // failing. Nothing short of a full structural check earns a v2 verdict.
    if (probe.migratedObjects === null) {
      throw refuse(
        "migrated storage was not structurally verified before use",
        { generation: state.generation, probe }
      );
    }
    if (!probe.migratedObjects.complete) {
      throw refuse(
        "objects the migrated registry references are missing or unmigrated",
        {
          generation: state.generation,
          missing: probe.migratedObjects.missing,
        }
      );
    }
    return { action: "use-field-groups-v2" };
  }

  // generation === "legacy"
  if (probe.targetRegistryPresent) {
    // An object carrying our post-migration name exists with no record of us
    // creating it. It belongs to the host application, or to a migration run
    // whose marker was lost. Either way the migration cannot claim the name,
    // and proceeding would rename over data we do not own.
    throw refuse(
      "an object using the migrated storage name exists but no migration recorded it",
      { generation: state.generation, probe }
    );
  }

  return { action: "use-legacy" };
}

/**
 * Refusals are 503 rather than a programmer-error code: the database is in a
 * shape a human has to look at, and the process must not serve until they have.
 * Details go to `logContext` so operators get the full picture while the public
 * message stays generic.
 */
function refuse(reason: string, context: Record<string, unknown>): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group storage refused to start: ${reason}`,
    logContext: { reason, ...context },
  });
}
