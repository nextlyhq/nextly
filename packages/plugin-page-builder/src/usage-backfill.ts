/**
 * Advancing an index backfill by one scope, and deciding when it is finished.
 *
 * The write hooks maintain the usage indexes going FORWARD. Nothing fills them
 * for documents that already existed, so a site that adds this plugin - or
 * upgrades into a version that added an index - starts with an empty table
 * whose every answer is "references nothing". That is the answer a delete check
 * acts on, and it is indistinguishable from a component genuinely used nowhere.
 *
 * ## Why one scope per pass
 *
 * A rebuild walks every document in its scope, so a backfill that did all of
 * them would be unbounded in the size of the site. It runs from a sweep, which
 * shares a drain with every other job, so an unbounded pass is one that starves
 * them - and on a serverless deploy it is one that hits a request timeout and
 * is retried from the beginning for ever, never finishing and never recording
 * that it got anywhere.
 *
 * One scope is the smallest unit a rebuild can be asked to complete, so it is
 * the largest one that is certain to make progress.
 *
 * ## Why completion is recomputed rather than latched
 *
 * A stored "backfill is done" flag is true about the site it was written for.
 * Add a collection with a blocks field, add a locale, or turn on drafts, and
 * new scopes exist that no walk ever visited - while the flag still says the
 * index is whole. Completion is therefore derived from the scopes that exist
 * NOW against the scopes recorded as done, so a site that grows goes back to
 * reporting a floor until the new work is finished.
 *
 * @module usage-backfill
 */
import { backfillScopeKey, type BackfillScope } from "./usage-backfill-scope";

/**
 * Where completed scopes are recorded.
 *
 * Injected rather than owned, for the reason every store in this plugin is:
 * the rules about what counts as finished are testable against values, and the
 * decision about WHERE the rows live belongs to the caller that holds the
 * Direct API.
 */
export interface BackfillStateStore {
  /** Every scope key already recorded as walked. */
  completed(): Promise<ReadonlySet<string>>;
  /**
   * Record one scope as walked.
   *
   * Called only after its rebuild resolved. A scope recorded before the walk
   * finishes is one a crash leaves marked done and permanently unindexed,
   * which is the failure this whole module exists to prevent.
   */
  record(key: string): Promise<void>;
}

/** What one pass of the backfill did. */
export interface BackfillPass {
  /**
   * The scope this pass walked, or `null` when there was nothing left.
   *
   * Named rather than counted, so a caller logging progress says which work
   * happened rather than that some did.
   */
  walked: BackfillScope | null;
  /** Whether every scope that exists now is recorded as walked. */
  complete: boolean;
}

/**
 * Whether every scope that exists right now has been walked.
 *
 * Pure, and the one place completion is decided. An empty scope list is
 * COMPLETE: a site with no blocks field anywhere has no documents to index, so
 * the index is not short - it is finished, and reporting a floor there would
 * caveat every count on a site that can never have one.
 */
export function backfillComplete(
  scopes: readonly BackfillScope[],
  completed: ReadonlySet<string>
): boolean {
  return scopes.every(scope => completed.has(backfillScopeKey(scope)));
}

/**
 * Walk at most one outstanding scope, and say whether that finished the job.
 *
 * The scope chosen is the first outstanding one in the order given, so a
 * caller enumerating collections deterministically gets a deterministic
 * sequence and a stalled scope is visible as the same one being retried rather
 * than as work that wanders.
 *
 * A rebuild that REJECTS is left unrecorded and propagates. The next pass picks
 * the same scope up, which is what makes a transient database failure a delay
 * instead of a permanent hole - and the job runner is what decides how often to
 * retry, since it is the thing holding the backoff.
 */
export async function advanceBackfill(args: {
  /** Every scope that exists now, from the current configuration. */
  scopes: readonly BackfillScope[];
  state: BackfillStateStore;
  /** Repairs one scope, walking every document in it. */
  rebuild: (scope: BackfillScope) => Promise<void>;
}): Promise<BackfillPass> {
  const completed = await args.state.completed();
  const outstanding = args.scopes.find(
    scope => !completed.has(backfillScopeKey(scope))
  );

  if (outstanding === undefined) {
    // Nothing to do. Reported as complete WITHOUT re-deriving, because the
    // absence of an outstanding scope is exactly the condition
    // `backfillComplete` tests - asking twice would be a second implementation
    // of one question.
    return { walked: null, complete: true };
  }

  await args.rebuild(outstanding);
  await args.state.record(backfillScopeKey(outstanding));

  // Recomputed against the set this pass started from, plus the scope it just
  // finished. Re-reading the store would be a second round trip to learn
  // something already known, and would also fold in whatever another instance
  // recorded meanwhile - which is not wrong, but makes the answer depend on
  // timing rather than on this pass.
  const after = new Set(completed);
  after.add(backfillScopeKey(outstanding));
  return {
    walked: outstanding,
    complete: backfillComplete(args.scopes, after),
  };
}
