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
 * A scope can itself be larger than one tick, so a walk also stops inside it
 * once the budget is spent, after recording the last document it finished.
 * The next pass resumes after that document rather than at the start, which is
 * what lets a scope of any size finish.
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
import type { PluginTransaction } from "@nextlyhq/plugin-sdk/schema";

import { backfillScopeKey, type BackfillScope } from "./usage-backfill-scope";

/**
 * Where one run's progress is recorded.
 *
 * Injected rather than owned, for the reason every store in this plugin is:
 * the rules about what counts as finished are testable against values, and the
 * decision about WHERE the rows live belongs to the caller that holds the
 * database. A store is bound to ONE run, so every write it makes is fenced by
 * that run's token: once a newer run has started, each of them is refused.
 */
export interface BackfillStateStore {
  /** Every scope key this run has recorded as walked whole. */
  completed(): Promise<ReadonlySet<string>>;
  /**
   * Record one scope as walked.
   *
   * Called only after its walk reached the end. A scope recorded before the
   * walk finishes is one a crash leaves marked done and permanently
   * unindexed, which is the failure this whole module exists to prevent.
   */
  record(key: string): Promise<void>;
  /**
   * The id of the last document this run's walk of an unfinished scope
   * finished, or `undefined` when the walk has not started.
   */
  cursorOf(key: string): string | undefined;
  /** Record where the walk of a scope got to, so the next tick resumes there. */
  checkpoint(key: string, cursor: string): Promise<void>;
  /**
   * Run an index write only while this run is current, so a pass a newer run
   * replaced writes nothing. The write is handed the transaction the check
   * runs in, and makes its write through it.
   */
  fenced<T>(write: (tx: PluginTransaction) => Promise<T>): Promise<T>;
  /**
   * Called once every scope is walked: clear the dirty mark a failed
   * maintenance write left, if this run started after it.
   */
  finish(): Promise<void>;
}

/** What a walk of one scope is handed, beyond the scope itself. */
export interface ScopeWalk {
  /** Resume after this document id; absent, start at the beginning. */
  after?: string;
  /** Record that every document up to and including `cursor` is done. */
  checkpoint(cursor: string): Promise<void>;
  /**
   * Whether the tick's budget is spent. Asked after each document, so a walk
   * always finishes at least one before it stops and a tick never ends with
   * nothing done.
   */
  stop(): boolean;
  /** Run one index write, fenced by the run, through the transaction it is handed. */
  fenced<T>(write: (tx: PluginTransaction) => Promise<T>): Promise<T>;
}

/** What one walk of a scope reached. */
export interface ScopeWalkOutcome {
  /** Whether the walk reached the scope's end; false when it stopped for the budget. */
  finished: boolean;
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
  /**
   * The completed set as this pass leaves it.
   *
   * Returned so a caller making SEVERAL passes in one handler can thread it
   * rather than have each pass re-read the store. The production store answers
   * `completed()` by paging the whole progress collection, so a handler that
   * walks N scopes was paging it N times — quadratic in the number of scopes,
   * and on a site of many small ones that is most of what the drain does.
   */
  completed: ReadonlySet<string>;
  /**
   * Whether the scope this pass walked reached its end. False when the tick's
   * budget ran out inside it; the next pass resumes it.
   */
  finished: boolean;
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
  /** Repairs one scope, resuming where an earlier tick's walk of it stopped. */
  rebuild: (scope: BackfillScope, walk: ScopeWalk) => Promise<ScopeWalkOutcome>;
  /**
   * Whether the tick's budget is spent, asked inside the walk. Absent, the
   * walk runs to the scope's end.
   */
  stop?: () => boolean;
  /**
   * What is already recorded, when the caller has just been told.
   *
   * Read from the store when absent. A caller threading it across passes gets
   * the same answer for less work — and a more stable one: re-reading folds in
   * whatever another instance recorded meanwhile, which makes the result depend
   * on timing rather than on this handler.
   */
  completed?: ReadonlySet<string>;
}): Promise<BackfillPass> {
  const completed = args.completed ?? (await args.state.completed());
  const outstanding = args.scopes.find(
    scope => !completed.has(backfillScopeKey(scope))
  );

  if (outstanding === undefined) {
    // Nothing to do. Reported as complete WITHOUT re-deriving, because the
    // absence of an outstanding scope is exactly the condition
    // `backfillComplete` tests - asking twice would be a second implementation
    // of one question.
    return { walked: null, complete: true, completed, finished: true };
  }

  const key = backfillScopeKey(outstanding);
  const cursor = args.state.cursorOf(key);
  const walk = await args.rebuild(outstanding, {
    ...(cursor === undefined ? {} : { after: cursor }),
    checkpoint: next => args.state.checkpoint(key, next),
    stop: args.stop ?? (() => false),
    fenced: write => args.state.fenced(write),
  });

  // Stopped inside the scope for the budget. Its cursor is recorded, so the
  // next tick resumes after the last document this one finished; nothing is
  // recorded as walked, because nothing finished.
  if (!walk.finished) {
    return { walked: outstanding, complete: false, completed, finished: false };
  }

  await args.state.record(key);

  // Recomputed against the set this pass started from, plus the scope it just
  // finished. Re-reading the store would be a second round trip to learn
  // something already known, and would also fold in whatever another instance
  // recorded meanwhile - which is not wrong, but makes the answer depend on
  // timing rather than on this pass.
  const after = new Set(completed);
  after.add(key);
  return {
    walked: outstanding,
    complete: backfillComplete(args.scopes, after),
    completed: after,
    finished: true,
  };
}
