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

import type { MigrationState } from "./state";

/** What the caller found in the database. Gathering it is dialect-specific. */
export interface StorageProbe {
  /** A registry table carrying the post-migration name exists. */
  targetRegistryPresent: boolean;
  /** A registry table carrying the pre-migration name exists. */
  legacyRegistryPresent: boolean;
}

/**
 * What the caller should do next.
 *
 * The resume verdict carries the manifest hash the interrupted run was planned
 * against rather than leaving it in the marker for the caller to look up. A
 * resumed step is only meaningful against that same plan, so the value the
 * caller must check is handed to it alongside the step it would otherwise run
 * blind. See `assertManifestUnchanged`.
 */
export type StorageVerdict =
  | { action: "use-legacy" }
  | { action: "use-field-groups-v2" }
  | { action: "resume"; step: number; manifestHash: string };

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
    // a state only the step list can interpret. The recorded manifest hash
    // travels with the step so the resumed run can refuse a changed plan.
    return {
      action: "resume",
      step: state.step + 1,
      manifestHash: state.manifestHash,
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
