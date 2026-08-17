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

import type { ManifestEntry } from "./manifest";
import { REFUSAL_KIND_KEY, type RefusalKind } from "./refusal-kind";
import { MAX_MIGRATION_STEP } from "./state";
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
      /**
       * The canonical plan the interrupted run was executing.
       *
       * Travels with the verdict in both directions because it cannot be
       * rebuilt: nothing in the database says which names this migration
       * created, and once each rename rewrites its registry pointer a rebuilt
       * plan omits the work already done, so its step positions no longer mean
       * what the recorded position means. An `up` resume applies it from
       * `step + 1`; a `down` resume reverses it.
       */
      appliedManifest: readonly ManifestEntry[];
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
    if (state.step >= MAX_MIGRATION_STEP) {
      // The next position could not be recorded even if its step ran, so a
      // resume from here can never make progress. Refusing belongs at this
      // point rather than in the read: the read must keep accepting every step
      // the writer is allowed to store, or a legitimately recorded marker
      // becomes unreadable, which is the same dead end from the other side.
      throw refuse(
        "the interrupted run stopped at a position it cannot advance past",
        { step: state.step, max: MAX_MIGRATION_STEP }
      );
    }
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
      appliedManifest: state.appliedManifest,
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
        { generation: state.generation, probe },
        // A rollback renames the registry back to its legacy name FIRST, before
        // its own marker settles. A reader holding no lock can therefore read a
        // v2 marker and then a catalog the rollback has already moved past — a
        // pair the database was never in. Re-reading resolves it; a genuinely
        // restored-from-backup database returns the same answer every time.
        "torn-read"
      );
    }
    if (probe.legacyRegistryPresent) {
      // A completed migration renames the legacy registry; it does not leave a
      // copy behind. Both being present means something reintroduced the old
      // one, so there are two tables claiming to be the registry and no way to
      // tell which the runtime should believe. It also strands rollback, whose
      // rename would collide with the table already sitting at the legacy name.
      throw refuse(
        "both the legacy and migrated registries are present after a completed migration",
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
        },
        // The same tear one object further in: a rollback reverting data tables
        // makes them incomplete against a v2 marker an unlocked reader captured
        // beforehand.
        "torn-read"
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
      { generation: state.generation, probe },
      // The mirror going up: a run renames the registry to its migrated name and
      // settles its marker afterwards, so a reader that captured the legacy
      // marker first sees a target that nothing yet accounts for.
      "torn-read"
    );
  }

  if (state.recorded && !probe.legacyRegistryPresent) {
    // A marker that explicitly records legacy storage was written after a run
    // that left a legacy registry behind, so its absence is unexplained. This
    // is the mirror of the migrated case, and refusing keeps the two symmetric.
    // An untouched database is excluded on purpose: it has no marker and no
    // registry yet, and creating one is ordinary first-run behaviour.
    throw refuse(
      "marker records legacy storage but the legacy registry is absent",
      { generation: state.generation, probe },
      // An upward run in flight has renamed the legacy registry away while this
      // reader still holds the legacy marker it captured first.
      "torn-read"
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
function refuse(
  reason: string,
  context: Record<string, unknown>,
  kind: RefusalKind = "permanent"
): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group storage refused to start: ${reason}`,
    logContext: { reason, [REFUSAL_KIND_KEY]: kind, ...context },
  });
}
