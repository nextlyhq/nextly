/**
 * Where the events that can create a hard problem hand it to the early stop.
 *
 * Each such event is a thin call here, made once its own write has
 * committed: a member's draft saved, a role's grants or a user's roles
 * changed, a user deactivated or their email or name changed, a member
 * deleted, a collection's or Single's schema changed, or a registered check
 * source's signal. The early stop
 * (`ReleasesService.stopOnHardProblems`) checks the still-scheduled releases
 * holding what the event names and stops any with a hard problem, telling its
 * owner.
 *
 * Never fails the event. The event's write has already happened, and the
 * drain checks every release again at its instant, so an early stop that
 * could not run is logged and left to it: reporting the save as failed would
 * invite a retry of something that happened.
 *
 * @module domains/releases/early-stop
 * @experimental
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { container } from "../../di/container";
import { getNextlyLogger } from "../../observability/logger";

import type {
  ReleaseRecheckDocument,
  ReleaseRecheckTarget,
} from "./release-recheck";

/** The part of the releases service this calls. */
interface EarlyStop {
  stopOnHardProblems(target: ReleaseRecheckTarget): Promise<unknown>;
}

/** The document a release's own run is writing, while it writes it. */
const releaseRun = new AsyncLocalStorage<ReleaseRecheckDocument>();

/**
 * Perform `write` of `document` as part of a release's own run: the write is
 * not an event for the early stop about that document.
 *
 * The run checks each document as it writes it and stops what it cannot
 * apply itself, keeping a release's documents together. A stop raised by its
 * own write would land between two of its documents, after some were applied
 * and before the rest: the split the run exists to avoid.
 *
 * Only that document. Anything else the write sets off, such as a hook that
 * saves or deletes another document, or changes someone's roles, is an event
 * like any other.
 */
export function asReleaseRun<T>(
  document: ReleaseRecheckDocument,
  write: () => Promise<T>
): Promise<T> {
  return releaseRun.run(document, write);
}

/**
 * What is left of `target` once the document a release's own run is writing
 * is taken out, or `null` when nothing is.
 */
function apartFromRunWrite(
  target: ReleaseRecheckTarget,
  writing: ReleaseRecheckDocument | undefined
): ReleaseRecheckTarget | null {
  if (writing === undefined || !("documents" in target)) return target;
  const documents = target.documents.filter(
    document =>
      document.scopeKind !== writing.scopeKind ||
      document.scopeSlug !== writing.scopeSlug ||
      document.entryId !== writing.entryId
  );
  return documents.length === 0 ? null : { documents };
}

/**
 * Stop the still-scheduled releases holding what an event names, if one of
 * those documents now has a hard problem. Resolves once they are stopped, so
 * a read after the event's call returns sees them stopped.
 *
 * Call it after the event's write has committed (through `afterCommit` where
 * the write may be inside an enclosing transaction), never inside it: the
 * checks read through the database as any reader does, and the stop opens a
 * transaction of its own.
 *
 * @experimental
 */
export async function stopReleasesHolding(
  target: ReleaseRecheckTarget
): Promise<void> {
  // A release's own run decides what its own write stops, and a boot without
  // releases has nothing scheduled to stop.
  const named = apartFromRunWrite(target, releaseRun.getStore());
  if (named === null) return;
  if (!container.has("releasesService")) return;
  try {
    await container.get<EarlyStop>("releasesService").stopOnHardProblems(named);
  } catch (error) {
    getNextlyLogger().error({
      kind: "release-early-stop-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
