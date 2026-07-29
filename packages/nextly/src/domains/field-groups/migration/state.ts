/**
 * Durable state for the field-group storage migration.
 *
 * The migration renames tables, columns and stored JSON keys on a live
 * database. Knowing where a previous run stopped cannot be inferred from what
 * objects happen to exist: a half-renamed database and a database that never
 * started look similar from the outside, and an object carrying the target name
 * may belong to the host application rather than to us. So the run records its
 * own progress in `nextly_meta` and every decision is made from that record.
 *
 * The marker is written before the first statement rather than after, because
 * MySQL commits DDL implicitly: a crash between the first rename and a
 * post-hoc marker write would leave renamed objects with no record of them.
 *
 * @module domains/field-groups/migration/state
 */

import { NextlyError } from "../../../errors/nextly-error";
import type { MetaService } from "../../meta/services/meta-service";

/** `nextly_meta` key holding the marker. */
export const FIELD_GROUP_MIGRATION_KEY = "field_groups.storage_migration";

/** Marker payload version, so a later migration can evolve this shape. */
export const MIGRATION_MARKER_VERSION = 1;

/** Which way a run is travelling. `down` reverses a completed or partial `up`. */
export type MigrationDirection = "up" | "down";

/**
 * Storage generation.
 *
 * `legacy` is also what an untouched database reports: absent and legacy are
 * the same starting position, so a first run needs no special case.
 */
export type StorageGeneration = "legacy" | "field-groups-v2";

/** No run in progress; storage is at one generation or the other. */
export interface SettledState {
  status: "settled";
  generation: StorageGeneration;
}

/**
 * What a run was planned against.
 *
 * A step is recorded as a number, and a number only indexes into a plan. Two
 * independent things can change that plan out from under an interrupted run,
 * and either one makes the recorded step mean something different:
 *
 * - `manifestHash` covers the object map: which tables, columns and stored keys
 *   this database's field groups resolve to. It moves when the application's
 *   schema changes.
 * - `planHash` covers the ordered step list the running build produces. It
 *   moves when Nextly itself is upgraded and steps are added, removed or
 *   reordered, which can happen while the application's schema is untouched.
 *
 * Neither subsumes the other, so both are recorded and both are compared.
 */
export interface MigrationPlanIdentity {
  manifestHash: string;
  planHash: string;
}

/**
 * A run is in flight, or died in flight.
 *
 * `step` is the last step whose postcondition verified, so a resume starts at
 * `step + 1`. `direction` and `migrationId` are recorded because a resume needs
 * both: the direction selects the step list, and `advanceStep` refuses an id it
 * does not recognise.
 */
export interface MigratingState {
  status: "migrating";
  direction: MigrationDirection;
  migrationId: string;
  step: number;
  plan: MigrationPlanIdentity;
}

export type MigrationState = SettledState | MigratingState;

/** Stored shape. Kept separate from the public union so reads can validate it. */
interface StoredMarker {
  version: number;
  status: "settled" | "migrating";
  generation?: StorageGeneration;
  direction?: MigrationDirection;
  migrationId?: string;
  step?: number;
  manifestHash?: string;
  planHash?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read the marker.
 *
 * An absent marker is `settled/legacy`. A marker that is present but malformed
 * is NOT treated as absent: that would silently restart a migration that may
 * have already renamed objects, so it throws instead.
 *
 * Absence is decided by whether the row exists, never by whether its value
 * decodes to `null`. A row holding SQL NULL or the JSON literal `null` is a
 * marker we wrote and can no longer read, which is the corrupt case, not the
 * untouched one.
 */
export async function readMigrationState(
  meta: MetaService
): Promise<MigrationState> {
  const entry = await meta.getEntry<unknown>(FIELD_GROUP_MIGRATION_KEY);
  if (!entry.present) {
    return { status: "settled", generation: "legacy" };
  }

  if (entry.value === null || entry.value === undefined) {
    throw markerCorrupt("marker row exists but carries no value");
  }

  if (!isRecord(entry.value)) {
    throw markerCorrupt("marker is not an object");
  }

  const marker = entry.value as unknown as StoredMarker;

  if (marker.version !== MIGRATION_MARKER_VERSION) {
    throw markerCorrupt(
      `marker version ${String(marker.version)} is not supported by this build`
    );
  }

  if (marker.status === "settled") {
    if (
      marker.generation !== "legacy" &&
      marker.generation !== "field-groups-v2"
    ) {
      throw markerCorrupt("settled marker carries no known generation");
    }
    return { status: "settled", generation: marker.generation };
  }

  if (marker.status === "migrating") {
    const { direction, migrationId, step, manifestHash, planHash } = marker;
    if (direction !== "up" && direction !== "down") {
      throw markerCorrupt("in-flight marker carries no known direction");
    }
    if (typeof migrationId !== "string" || migrationId.length === 0) {
      throw markerCorrupt("in-flight marker carries no migration id");
    }
    // Safe rather than merely integral: at 2^53 and above `step + 1 === step`,
    // so a resume would compute the same position forever instead of advancing.
    // A marker holding a number that cannot be incremented is corrupt, not
    // resumable.
    if (typeof step !== "number" || !Number.isSafeInteger(step) || step < 0) {
      throw markerCorrupt("in-flight marker carries no valid step");
    }
    if (typeof manifestHash !== "string" || manifestHash.length === 0) {
      throw markerCorrupt("in-flight marker carries no manifest hash");
    }
    if (typeof planHash !== "string" || planHash.length === 0) {
      throw markerCorrupt("in-flight marker carries no plan hash");
    }
    return {
      status: "migrating",
      direction,
      migrationId,
      step,
      plan: { manifestHash, planHash },
    };
  }

  throw markerCorrupt(`unknown marker status ${String(marker.status)}`);
}

/**
 * Record that a run is starting. Must be called before the first statement.
 *
 * `step: 0` means "planned, nothing verified yet", so a crash immediately after
 * this write resumes at step 1 and re-runs the first step from scratch. Every
 * step is idempotent precisely so that re-run is safe.
 */
export async function beginMigration(
  meta: MetaService,
  args: {
    direction: MigrationDirection;
    migrationId: string;
    plan: MigrationPlanIdentity;
  }
): Promise<void> {
  const marker: StoredMarker = {
    version: MIGRATION_MARKER_VERSION,
    status: "migrating",
    direction: args.direction,
    migrationId: args.migrationId,
    step: 0,
    manifestHash: args.plan.manifestHash,
    planHash: args.plan.planHash,
  };
  await meta.set(FIELD_GROUP_MIGRATION_KEY, marker);
}

/**
 * Check off a step whose postcondition has verified.
 *
 * Refuses to move backwards or skip: a caller that has lost track of its
 * position should re-read the marker rather than assert a new one.
 */
export async function advanceStep(
  meta: MetaService,
  args: { migrationId: string; step: number }
): Promise<void> {
  const current = await readMigrationState(meta);
  if (current.status !== "migrating") {
    throw NextlyError.internal({
      logContext: {
        reason: "advanceStep called with no migration in flight",
        step: args.step,
      },
    });
  }
  if (current.migrationId !== args.migrationId) {
    throw NextlyError.internal({
      logContext: {
        reason: "advanceStep called for a different migration run",
        expected: current.migrationId,
        received: args.migrationId,
      },
    });
  }
  if (args.step !== current.step + 1) {
    throw NextlyError.internal({
      logContext: {
        reason: "migration steps must advance by exactly one",
        from: current.step,
        to: args.step,
      },
    });
  }

  const marker: StoredMarker = {
    version: MIGRATION_MARKER_VERSION,
    status: "migrating",
    direction: current.direction,
    migrationId: current.migrationId,
    step: args.step,
    manifestHash: current.plan.manifestHash,
    planHash: current.plan.planHash,
  };
  await meta.set(FIELD_GROUP_MIGRATION_KEY, marker);
}

/**
 * Refuse to resume a run whose plan is no longer the plan that was interrupted.
 *
 * Steps are identified by position, and a position only means something
 * relative to the plan it was checked off under. Two different changes can
 * invalidate it, and they are reported separately because they point an
 * operator at different causes:
 *
 * - The object map moved: the application's schema changed between the
 *   interrupted run and this one, so step N now names different objects.
 * - The step list moved: Nextly was upgraded and its steps were added, removed
 *   or reordered, so step N is a different operation even though the database's
 *   own objects are untouched.
 *
 * Neither is reconcilable, so both refuse. Callers invoke this once they have
 * rebuilt the plan and can supply its identity, which is necessarily after the
 * resume decision itself is made.
 */
export function assertPlanUnchanged(args: {
  recorded: MigrationPlanIdentity;
  current: MigrationPlanIdentity;
}): void {
  if (args.recorded.manifestHash !== args.current.manifestHash) {
    throw planMoved(
      "migration object map changed since the interrupted run",
      args.recorded.manifestHash,
      args.current.manifestHash
    );
  }
  if (args.recorded.planHash !== args.current.planHash) {
    throw planMoved(
      "migration step list changed since the interrupted run",
      args.recorded.planHash,
      args.current.planHash
    );
  }
}

function planMoved(
  reason: string,
  recorded: string,
  current: string
): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group migration cannot resume: ${reason}`,
    logContext: { reason, recorded, current },
  });
}

/**
 * Settle the marker at a generation.
 *
 * Called only after structural verification passes, so the generation the
 * marker reports is one that has been checked rather than assumed.
 */
export async function settleMigration(
  meta: MetaService,
  generation: StorageGeneration
): Promise<void> {
  const marker: StoredMarker = {
    version: MIGRATION_MARKER_VERSION,
    status: "settled",
    generation,
  };
  await meta.set(FIELD_GROUP_MIGRATION_KEY, marker);
}

// A marker that exists but cannot be read is refused rather than ignored:
// treating it as absent would restart a run that may already have renamed
// objects. Serving is unsafe until an operator looks, hence 503 rather than a
// programmer-error code.
function markerCorrupt(reason: string): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group migration marker is unreadable: ${reason}`,
    logContext: { key: FIELD_GROUP_MIGRATION_KEY, reason },
  });
}
