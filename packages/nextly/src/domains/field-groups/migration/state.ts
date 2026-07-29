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

/**
 * Highest step the marker will hold, one below the safe-integer ceiling.
 *
 * The bound is enforced identically on read and on write, which is what makes
 * it useful: every accepted step can be incremented exactly, and every step
 * written can be read back afterwards. Allowing the ceiling itself would let a
 * resume hand out `MAX_SAFE_INTEGER + 1`, which increments to itself, be
 * recorded, and then be rejected as corrupt by the very next read — leaving the
 * migration permanently unavailable with no way forward.
 *
 * A real plan has a handful of steps, so this is a corruption bound rather than
 * a capacity one.
 */
export const MAX_MIGRATION_STEP = Number.MAX_SAFE_INTEGER - 1;

/** Which way a run is travelling. `down` reverses a completed or partial `up`. */
export type MigrationDirection = "up" | "down";

/**
 * Storage generation.
 *
 * `legacy` is also what an untouched database reports, so a first run needs no
 * special case for the generation itself. The two are not interchangeable
 * though, and `SettledState.recorded` keeps them apart.
 */
export type StorageGeneration = "legacy" | "field-groups-v2";

/** No run in progress; storage is at one generation or the other. */
export interface SettledState {
  status: "settled";
  generation: StorageGeneration;
  /**
   * Whether a marker actually said this, or it is the default an untouched
   * database reports.
   *
   * Both read as `legacy`, but they are not the same claim, and one decision
   * turns on the difference: an untouched database legitimately has no registry
   * yet, whereas a marker that explicitly records legacy storage was written
   * after a run that left one behind, so a missing registry there is
   * unexplained rather than expected.
   */
  recorded: boolean;
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
    return { status: "settled", generation: "legacy", recorded: false };
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
    return {
      status: "settled",
      generation: marker.generation,
      recorded: true,
    };
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
    // Bounded one below that ceiling as well, so the step a resume derives from
    // this one is itself recordable. A marker holding a number that cannot be
    // incremented, or incremented into a value that cannot be stored, is
    // corrupt rather than resumable.
    if (
      typeof step !== "number" ||
      !Number.isSafeInteger(step) ||
      step < 0 ||
      step > MAX_MIGRATION_STEP
    ) {
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
  // The writer holds itself to the reader's invariants. Persisting a marker the
  // next read would reject leaves the database unavailable with no way forward,
  // and an empty identifier is the easiest way to do that by accident.
  requireIdentifier(args.migrationId, "migrationId");
  requireIdentifier(args.plan.manifestHash, "manifestHash");
  requireIdentifier(args.plan.planHash, "planHash");

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

// Mirrors the non-empty check `readMigrationState` applies, so the two cannot
// drift into a writer that produces markers its own reader refuses.
function requireIdentifier(value: string, field: string): void {
  if (typeof value === "string" && value.length > 0) return;
  throw NextlyError.internal({
    logContext: {
      reason: "migration marker identifier must be a non-empty string",
      field,
    },
  });
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
  // Refuse to record a position that could not be read back. Writing past the
  // bound would settle the marker into a shape the next read rejects as
  // corrupt, which is a worse outcome than declining to advance.
  if (args.step > MAX_MIGRATION_STEP) {
    throw NextlyError.internal({
      logContext: {
        reason: "migration step exceeds the highest recordable position",
        step: args.step,
        max: MAX_MIGRATION_STEP,
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
