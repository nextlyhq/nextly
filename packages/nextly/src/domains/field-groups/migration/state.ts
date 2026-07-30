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
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { MetaService } from "../../meta/services/meta-service";

import { MIGRATION_TARGET, type ManifestEntry } from "./manifest";

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
  /**
   * The plan that produced this generation, kept so a rollback can reverse it.
   *
   * A rollback cannot derive the reverse mapping: nothing in the database
   * distinguishes a `fg_*` name this migration created from one an author chose
   * before it existed, so renaming by prefix on the way down would destroy the
   * latter. Only the record of what was applied carries that distinction, which
   * is why it survives settlement rather than being discarded with the run.
   *
   * Absent on a `legacy` generation that no run produced, and on markers written
   * before a plan was recorded.
   */
  appliedManifest?: ManifestEntry[];
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
  /**
   * The plan being applied, carried for the whole run.
   *
   * Always the plan that was applied to reach migrated storage, never its
   * inverse. A rollback reverses it at execution time; storing it pre-inverted
   * would let a resume invert it twice and migrate forward while believing it
   * was rolling back.
   *
   * A `down` run reverses what an earlier `up` recorded, so the record has to
   * survive the transition out of `settled` and every step after it. Writing it
   * only at settlement would lose it the moment a rollback started, leaving a
   * crashed run with a step position and no plan to index into.
   */
  appliedManifest?: ManifestEntry[];
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
  appliedManifest?: unknown;
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
      ...(marker.appliedManifest === undefined
        ? {}
        : { appliedManifest: parseAppliedManifest(marker.appliedManifest) }),
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
      ...(marker.appliedManifest === undefined
        ? {}
        : { appliedManifest: parseAppliedManifest(marker.appliedManifest) }),
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
/**
 * Starting a run, with the plan required exactly where a run cannot do without it.
 *
 * A `down` run reverses a recorded plan; it cannot derive one, because nothing in
 * the database says which names this migration created. An `up` run builds its
 * plan from registry rows, so it has none to carry in. Expressing that as a union
 * rather than an optional field with a comment means the unsafe call does not
 * typecheck — a comment saying "required" while the type says otherwise is the
 * kind of claim that goes unenforced.
 */
export type BeginMigrationArgs =
  | {
      direction: "up";
      migrationId: string;
      plan: MigrationPlanIdentity;
      appliedManifest?: undefined;
    }
  | {
      direction: "down";
      migrationId: string;
      plan: MigrationPlanIdentity;
      appliedManifest: readonly ManifestEntry[];
    };

export async function beginMigration(
  meta: MetaService,
  args: BeginMigrationArgs
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
    // Carried from the settled marker rather than dropped: a rollback has no
    // other source for the plan it is reversing. Validated through the same
    // function the read uses, so a write cannot produce a marker its own reader
    // refuses -- which would strand a run after its first step had committed.
    ...(args.appliedManifest === undefined
      ? {}
      : { appliedManifest: parseAppliedManifest(args.appliedManifest) }),
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
    // Preserved on every step. Losing it mid-run would leave a crash with a
    // step position and no plan to index into.
    ...(current.appliedManifest === undefined
      ? {}
      : { appliedManifest: current.appliedManifest }),
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
/**
 * Settling, with the plan required exactly where a rollback will need it.
 *
 * Settling at `field-groups-v2` is the only moment the plan that produced it can
 * still be recorded, and a rollback has no other source for it. Settling back at
 * `legacy` is the end of a reversal, with nothing left to reverse. Making the
 * distinction a union stops the v2 case being settled without a plan, which the
 * previous optional argument allowed and which no comment could prevent.
 */
export type SettleArgs =
  | { generation: "field-groups-v2"; appliedManifest: readonly ManifestEntry[] }
  | { generation: "legacy" };

export async function settleMigration(
  meta: MetaService,
  settled: SettleArgs
): Promise<void> {
  const { generation } = settled;
  const appliedManifest =
    settled.generation === "field-groups-v2"
      ? settled.appliedManifest
      : undefined;
  const marker: StoredMarker = {
    version: MIGRATION_MARKER_VERSION,
    status: "settled",
    generation,
    // Recorded so a later process can reverse this run. Inverting a persisted
    // plan is the only safe rollback: the reverse cannot be derived from the
    // database, which cannot say which names this migration created.
    ...(appliedManifest === undefined
      ? {}
      : { appliedManifest: parseAppliedManifest(appliedManifest) }),
  };
  await meta.set(FIELD_GROUP_MIGRATION_KEY, marker);
}

/**
 * Validate a persisted plan on the way back in.
 *
 * A rollback acts on this, so a marker carrying something unreadable must
 * refuse rather than hand back a partial plan that would revert some objects
 * and silently leave others migrated.
 */
function parseAppliedManifest(value: unknown): ManifestEntry[] {
  if (!Array.isArray(value)) {
    throw markerCorrupt("recorded plan is not a list");
  }
  // Every plan renames the registry exactly once, so a recorded plan without
  // that entry is a fragment rather than a plan. Accepting one would let a
  // rollback reverse the data tables and leave the registry migrated, which is
  // a state no direction can then interpret. An empty list fails here too.
  const registryEntries = value.filter(
    raw => isRecord(raw) && raw.kind === "registry"
  );
  if (registryEntries.length !== 1) {
    throw markerCorrupt(
      `recorded plan renames the registry ${String(registryEntries.length)} times, not once`
    );
  }
  // Counting the entry is not enough: it has to be *the* registry rename, in the
  // one direction a record of applied work can have.
  //
  // `appliedManifest` always holds the plan that was applied to reach migrated
  // storage — legacy to target. It is a record of what happened, not of what is
  // about to happen, and a rollback inverts it at execution time rather than
  // storing it pre-inverted. Accepting the inverted form would let a rollback
  // invert it a second time and generate legacy-to-migrated operations while
  // claiming to restore legacy.
  const registry = registryEntries[0] as Record<string, unknown>;
  if (
    registry.from !== STORAGE_FORMAT.registryTable ||
    registry.to !== MIGRATION_TARGET.registryTable
  ) {
    throw markerCorrupt(
      "recorded plan's registry entry is not the applied registry rename"
    );
  }
  return value.map(raw => {
    if (!isRecord(raw)) {
      throw markerCorrupt("recorded plan contains a non-object entry");
    }
    const { kind, from, to, table } = raw;
    if (
      kind !== "registry" &&
      kind !== "table" &&
      kind !== "companion" &&
      kind !== "column"
    ) {
      throw markerCorrupt("recorded plan entry has no known kind");
    }
    if (typeof from !== "string" || from.length === 0) {
      throw markerCorrupt("recorded plan entry has no source name");
    }
    if (typeof to !== "string" || to.length === 0) {
      throw markerCorrupt("recorded plan entry has no target name");
    }
    // A column rename is addressed through its table, so an entry without one
    // cannot be executed or reversed. Accepting it would hand a rollback a plan
    // that reverts some objects and silently skips others.
    if (kind === "column") {
      if (typeof table !== "string" || table.length === 0) {
        throw markerCorrupt("recorded column entry names no table");
      }
    } else if (table !== undefined && typeof table !== "string") {
      throw markerCorrupt("recorded plan entry has an invalid table");
    }
    return {
      kind,
      from,
      to,
      ...(table === undefined ? {} : { table }),
    };
  });
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
