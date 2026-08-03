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

import { hashManifest, MIGRATION_TARGET, type ManifestEntry } from "./manifest";

/** `nextly_meta` key holding the marker. */
export const FIELD_GROUP_MIGRATION_KEY = "field_groups.storage_migration";

/**
 * Marker payload version.
 *
 * **Bump this whenever the recorded plan's entry format changes, or whenever the
 * mapping from entries to executable steps changes.** A marker records progress
 * as `step: N`, and a number only means something against a specific step list.
 * The plan itself is persisted rather than rebuilt, so its *contents* cannot
 * drift — but a build that turns those same entries into a different list of
 * steps makes the recorded position address different work, and nothing in the
 * plan's own bytes reveals that. This constant is what does.
 *
 * Version 2 was this rename engine's plan format, in which a localization
 * companion is carried on the entry for the table it belongs to rather than
 * occupying an entry, and therefore a step position, of its own.
 *
 * Version 3 adds the data rewrites to the executable list, ahead of the
 * renames. The recorded entries are unchanged — those steps are derived rather
 * than persisted — so nothing in a version 2 marker's bytes reveals that
 * position N now addresses different work. This constant is what does.
 *
 * Version 4 appends a second settlement check and stops recording either of
 * them: they are gates, re-entered by every invocation, so a marker no longer
 * points past the last rename. A version 3 marker CAN point past it, at a
 * settlement position this build does not record — and a resume computed from
 * that position would begin after the ledger check and never re-enter it,
 * letting a legacy write committed during the interruption settle unseen.
 * Nothing in the marker's bytes distinguishes the two meanings, which is
 * exactly what this constant is for.
 *
 * Bumping this does **not** invalidate a settled marker's recorded plan; see
 * `MIN_READABLE_MANIFEST_VERSION`, which tracks the entry format separately.
 */
export const MIGRATION_MARKER_VERSION = 4;

/**
 * Oldest marker version whose recorded plan this build can still execute.
 *
 * Separate from `MIGRATION_MARKER_VERSION` because the two answer different
 * questions, and answering both with one number throws away the record a
 * rollback depends on. The marker version says how a recorded *step* is to be
 * read, and moves whenever the entries-to-steps mapping changes — even when the
 * entries themselves do not. This says which recorded *entries* are in a shape
 * this build understands, and moves only when that shape changes.
 *
 * A settled marker holds no step, but it does hold the plan a rollback
 * reverses, and nothing else can supply it: no property of the database
 * distinguishes an `fg_*` name this migration created from one an author chose
 * before it existed. Gating that plan on the marker version means every
 * step-list bump silently strips it from every already-migrated installation,
 * and the next `down` refuses for lack of a record it was handed.
 *
 * Version 2 introduced the current entry format, in which a localization
 * companion travels on its owner's entry rather than occupying one of its own.
 * Version 3 changed only the step list. **Raise this only when the persisted
 * entry shape itself changes** — never merely because the marker version moved.
 */
export const MIN_READABLE_MANIFEST_VERSION = 2;

/**
 * Oldest marker version whose *settled* state represents all the work this
 * build performs.
 *
 * The third of the three questions a version answers, and the one that decides
 * whether a finished-looking database is actually finished. `generation` names
 * what the storage reached, but what that generation MEANS is a property of the
 * build that wrote it: version 2 executed renames only, while version 3 also
 * rewrites stored field definitions, ledger keys and parent pointers. A version
 * 2 marker reading `field-groups-v2` therefore describes storage this build
 * would consider half-migrated, and accepting it would report success over
 * legacy vocabulary that no later run would ever revisit.
 *
 * Raise this whenever a version adds work to a run — never merely because the
 * marker version moved. A build that only reorders or renumbers steps leaves
 * what a settled marker claims untouched.
 *
 * Version 4 qualifies. A version 3 run settled without ever re-examining the
 * registries, so a definition saved while that run was in flight could land
 * behind the rewrite that had already passed and be recorded as complete. The
 * `already-migrated` path checks structure and parent pointers, neither of which
 * can see stored vocabulary, so accepting such a marker would report success
 * over legacy field definitions nothing would revisit. What a version 3 marker
 * claims is therefore weaker than what this build means by settled, which is the
 * one thing this constant exists to say.
 *
 * Refusing costs nothing an operator can feel: the migration has no caller, so
 * no database holds a marker of any version, and the refusal names the remedy.
 * A repair path for a state that cannot exist would be dead code carrying a
 * maintenance cost for the life of the project.
 */
export const MIN_COMPLETE_MARKER_VERSION = 4;

/**
 * Whether a marker's recorded plan is in a format this build can execute.
 *
 * Bounded above as well as below: a marker from a newer build may record an
 * entry shape this one has never seen, and reading it optimistically would put
 * a plan this build cannot honour in front of a rollback.
 */
function manifestIsReadable(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= MIN_READABLE_MANIFEST_VERSION &&
    version <= MIGRATION_MARKER_VERSION
  );
}

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
   * Marker version that recorded this, absent when no marker did.
   *
   * Kept because a generation means whatever the build that wrote it made it
   * mean, and only the version says which build that was. See
   * `MIN_COMPLETE_MARKER_VERSION`.
   */
  version?: number;
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
 * The plan is **persisted and read back**, never rebuilt, so the identity does
 * not have to survive a rebuild producing the same bytes. What it must still
 * catch is the world moving underneath a recorded position:
 *
 * - `registryHash` covers which field group rows exist, by id. A group created,
 *   deleted, or replaced mid-run would leave storage the plan never mentions.
 * - `manifestHash` covers the stored plan's own integrity.
 */
export interface MigrationPlanIdentity {
  /**
   * Hash over the registry rows the run was planned against, by id and slug.
   *
   * Answers "is this still the same set of field groups". Row ids rather than
   * table names because `table_name` is rewritten as each rename commits, and
   * rather than slugs alone because a slug cannot tell a group that survived
   * from one deleted and recreated under the same name.
   */
  registryHash: string;
  /**
   * Hash of the persisted plan itself.
   *
   * A corruption check on the stored blob, not a comparison against anything
   * rebuilt: the plan is read back rather than recomputed, so the only question
   * left is whether what was read is what was written.
   */
  manifestHash: string;
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
   * The plan this run is executing, carried for the whole run.
   *
   * Required in both directions, and always in the canonical form: the work
   * that takes storage from legacy to migrated, never its inverse. An `up` run
   * applies it; a `down` run reverses it at execution time. Storing it
   * pre-inverted would let a resume invert it twice and migrate forward while
   * believing it was rolling back.
   *
   * This is what a resume executes. Rebuilding it instead cannot work once the
   * registry's own pointers are rewritten with each rename: a rebuilt plan then
   * omits every row already renamed, so it has fewer entries, different step
   * positions, and a different hash from the one the marker recorded — and the
   * resume would refuse the very plan it is resuming.
   */
  appliedManifest: ManifestEntry[];
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
  registryHash?: string;
  manifestHash?: string;
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

  const writtenByThisBuild = marker.version === MIGRATION_MARKER_VERSION;

  // A settled marker is read whatever wrote it. The version tracks how a
  // recorded *step* is to be interpreted, and a settled marker has none — it
  // states which generation the storage reached, which is the same fact in
  // every build. Gating it would make the next version bump reject every marker
  // left by the previous release, so every already-migrated installation would
  // start refusing reads on upgrade.
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
      version: marker.version,
      // Kept for every build that can still read the entry shape, which is not
      // the same question as whether this build wrote the marker: a step-list
      // bump leaves the recorded entries untouched, and discarding them there
      // would strip the rollback plan from installations that already migrated
      // successfully. Where the shape genuinely is unreadable the plan is
      // omitted rather than parsed, which leaves a rollback to refuse on a plan
      // it does not have instead of every read refusing on one it cannot parse.
      ...(marker.appliedManifest === undefined ||
      !manifestIsReadable(marker.version)
        ? {}
        : { appliedManifest: parseAppliedManifest(marker.appliedManifest) }),
    };
  }

  // In flight, so `step` has to be interpreted against a step list, and only the
  // build that produced that list can say what position N addressed.
  if (!writtenByThisBuild) {
    // Not reported as corruption: the bytes are intact and were written by a
    // build whose step list this one may no longer reproduce. The operator's
    // remedy differs too — finish or roll back the run with the version that
    // started it, rather than investigate a damaged marker.
    throw NextlyError.serviceUnavailable({
      logMessage:
        "field-group migration marker was written by a different version of Nextly",
      logContext: {
        key: FIELD_GROUP_MIGRATION_KEY,
        reason: "migration marker version is not this build's",
        recordedVersion: marker.version,
        supportedVersion: MIGRATION_MARKER_VERSION,
      },
    });
  }

  if (marker.status === "migrating") {
    const { direction, migrationId, step, registryHash, manifestHash } = marker;
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
    if (typeof registryHash !== "string" || registryHash.length === 0) {
      throw markerCorrupt("in-flight marker carries no registry identity hash");
    }
    if (typeof manifestHash !== "string" || manifestHash.length === 0) {
      throw markerCorrupt("in-flight marker carries no manifest hash");
    }
    // A run in flight cannot proceed without the plan it is executing, so an
    // absent one is corruption rather than an optional field.
    if (marker.appliedManifest === undefined) {
      throw markerCorrupt("in-flight marker carries no plan");
    }
    const appliedManifest = parseAppliedManifest(marker.appliedManifest);
    // The plan is read back rather than recomputed, so this is the one check
    // that it is still what was written. Without it a truncated or edited blob
    // would be executed as though it were the recorded plan.
    const actualHash = hashManifest(appliedManifest);
    if (actualHash !== manifestHash) {
      throw markerCorrupt("recorded plan does not match its recorded hash");
    }
    return {
      status: "migrating",
      direction,
      migrationId,
      step,
      plan: { registryHash, manifestHash },
      appliedManifest,
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
 * Starting a run, with the plan it will execute.
 *
 * Required in both directions. A `down` run reverses a recorded plan and cannot
 * derive one, because nothing in the database says which names this migration
 * created. An `up` run cannot rely on rebuilding one either: once each rename
 * rewrites its registry pointer, a rebuild omits the work already done and no
 * longer matches the recorded step positions.
 */
export interface BeginMigrationArgs {
  direction: MigrationDirection;
  migrationId: string;
  plan: MigrationPlanIdentity;
  /**
   * The canonical legacy-to-migrated plan, required in both directions: an `up`
   * run applies it and a `down` run reverses it, and neither can rebuild it.
   */
  appliedManifest: readonly ManifestEntry[];
}

export async function beginMigration(
  meta: MetaService,
  args: BeginMigrationArgs
): Promise<void> {
  // The writer holds itself to the reader's invariants. Persisting a marker the
  // next read would reject leaves the database unavailable with no way forward,
  // and an empty identifier is the easiest way to do that by accident.
  requireIdentifier(args.migrationId, "migrationId");
  requireIdentifier(args.plan.registryHash, "registryHash");
  requireIdentifier(args.plan.manifestHash, "manifestHash");

  // Validated through the same function the read uses, so a write cannot
  // produce a marker its own reader refuses -- which would strand a run after
  // its first step had committed.
  const appliedManifest = parseAppliedManifest(args.appliedManifest);
  // The recorded hash has to describe the plan actually being stored, or the
  // integrity check on read would compare against a number nothing produced.
  const actualHash = hashManifest(appliedManifest);
  if (actualHash !== args.plan.manifestHash) {
    throw NextlyError.internal({
      logContext: {
        reason: "recorded manifest hash does not describe the recorded plan",
        recorded: args.plan.manifestHash,
        actual: actualHash,
      },
    });
  }

  const marker: StoredMarker = {
    version: MIGRATION_MARKER_VERSION,
    status: "migrating",
    direction: args.direction,
    migrationId: args.migrationId,
    step: 0,
    registryHash: args.plan.registryHash,
    manifestHash: args.plan.manifestHash,
    appliedManifest,
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
    registryHash: current.plan.registryHash,
    manifestHash: current.plan.manifestHash,
    // Preserved on every step. Losing it mid-run would leave a crash with a
    // step position and no plan to index into.
    appliedManifest: current.appliedManifest,
  };
  await meta.set(FIELD_GROUP_MIGRATION_KEY, marker);
}

/**
 * Refuse to resume a run whose world is no longer the world it was planned in.
 *
 * The plan itself is read back from the marker rather than rebuilt, so it cannot
 * have drifted; its integrity is checked on read against the recorded hash. What
 * remains is whether the *set of field groups* still matches. A group created or
 * deleted while a run was interrupted is storage the recorded plan never
 * mentions, and continuing would leave it behind at the legacy prefix while
 * everything else moved.
 *
 * Compared by slug rather than by table name because the pointer rewrite that
 * accompanies each rename changes table names as the run progresses; a
 * name-based comparison would refuse every resume past the first step, since the
 * rows the comparison reads have themselves been rewritten by the work already
 * done.
 *
 * Not reconcilable, so it refuses. Callers invoke it once they have read the
 * current registry rows and can hash their slugs.
 */
export function assertPlanUnchanged(args: {
  recorded: MigrationPlanIdentity;
  current: MigrationPlanIdentity;
}): void {
  if (args.recorded.registryHash !== args.current.registryHash) {
    throw planMoved(
      "the set of field groups changed since the interrupted run",
      args.recorded.registryHash,
      args.current.registryHash
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
    const { kind, from, to, table, companion } = raw;
    if (kind !== "registry" && kind !== "table" && kind !== "column") {
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
      ...(companion === undefined
        ? {}
        : { companion: readCompanion(companion) }),
    };
  });
}

/**
 * A recorded companion rename.
 *
 * Validated and carried rather than dropped: the entry returned here is what a
 * resume executes, so a companion the parser did not copy would leave the
 * companion table behind under its old name while its owner moved — the exact
 * split the companion was made a property to prevent.
 */
function readCompanion(value: unknown): { from: string; to: string } {
  if (!isRecord(value)) {
    throw markerCorrupt("recorded companion is not an object");
  }
  const { from, to } = value;
  if (typeof from !== "string" || from.length === 0) {
    throw markerCorrupt("recorded companion has no source name");
  }
  if (typeof to !== "string" || to.length === 0) {
    throw markerCorrupt("recorded companion has no target name");
  }
  return { from, to };
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
