/**
 * The background job that fills the usage indexes for documents that already
 * existed.
 *
 * The write hooks maintain the indexes going forward. Nothing fills them for a
 * site that installed this plugin over existing content, or that upgraded into
 * a version which added an index, so without this every component on such a
 * site reads "used on 0 pages" - the answer an author deletes on.
 *
 * ## Why a SWEEP rather than something enqueued
 *
 * Nobody is in a position to enqueue this. There is no request at which the
 * backfill becomes due: it is owed from the moment the plugin meets existing
 * content, and the events that make it owed - an upgrade, a collection gaining
 * a blocks field - are not things any handler sees. A sweep is the runner's
 * answer to exactly that shape; it keeps one queued, so the work needs no
 * trigger and cannot be forgotten. `document-lock:sweep` is here for the same
 * reason.
 *
 * ## Why it acts as the system
 *
 * A sweep runs with no principal, and both usage indexes deny every access rule
 * they declare. `context.content` is bound to that absent identity, so a read
 * through it answers an empty set - indistinguishable from an index with
 * nothing in it, which would make the backfill rewrite rows it had already
 * written, for ever. `JobContext` names this case and says a job needing
 * trusted access takes it explicitly; the stores are injected here so that is
 * one visible dependency rather than an ambient one.
 *
 * @module usage-backfill-job
 */
import { defineJob, type JobDefinition } from "nextly";

import { advanceBackfill, type BackfillStateStore } from "./usage-backfill";
import type { BackfillScope } from "./usage-backfill-scope";

/**
 * The job type this plugin registers.
 *
 * Namespaced by the plugin, because a slug collision is a boot failure and the
 * runner reserves `releases:`, `webhooks:` and `nextly:` for core.
 */
export const USAGE_BACKFILL_JOB = "page-builder:usage-backfill";

/** What the job needs, injected so a pass is testable without a database. */
export interface UsageBackfillDeps {
  /**
   * Every scope that exists NOW, re-derived per pass rather than captured.
   *
   * A list captured when the job was defined is a list from boot. A collection
   * added afterwards, a locale added, drafts turned on - each creates scopes a
   * captured list cannot contain, and the backfill would report itself complete
   * while they stayed unwalked for ever.
   */
  scopes: () => Promise<readonly BackfillScope[]>;
  /** Where completed scopes are recorded. */
  /**
   * The progress store, built when a pass needs it.
   *
   * A PROMISE because building it resolves the Direct API, and the plugin entry
   * that supplies that must import `nextly/runtime` at call time rather than at
   * module scope — the entry is isomorphic and reachable from a browser bundle.
   */
  state: () => Promise<BackfillStateStore>;
  /** Repairs one scope, walking every document in it. */
  rebuild: (scope: BackfillScope) => Promise<void>;
  /**
   * The live clock, injected only so a test can bound a pass deterministically.
   *
   * NOT `JobContext.now`: that is the single instant the runner is treating as
   * the start of the pass, so a loop comparing it to the deadline compares two
   * fixed values and either runs everything or nothing. Reading the real clock
   * is what makes the budget a budget.
   */
  clock?: () => number;
}

/**
 * Build the backfill sweep.
 *
 * Each pass walks scopes one at a time until the runner's deadline passes or
 * nothing is left. The deadline is checked BEFORE starting a scope and never
 * during one, mirroring how the runner treats `maxDurationMs` - it bounds how
 * many units a pass STARTS, because nothing can interrupt a walk in flight. A
 * scope that overruns is therefore possible and accepted: it is the smallest
 * unit that can be recorded, so stopping inside one could only discard work.
 *
 * Stopping discharges nothing. An unwalked scope has no row, so the next tick
 * finds it outstanding - the queue is durable and the sweep is re-queued, which
 * is what makes leaving work safe rather than losing it.
 */
export function usageBackfillJob(deps: UsageBackfillDeps): JobDefinition {
  const now = deps.clock ?? (() => Date.now());

  return defineJob({
    slug: USAGE_BACKFILL_JOB,
    sweep: true,
    handler: async (_input, context) => {
      const scopes = await deps.scopes();
      const state = await deps.state();
      const deadline = context.deadline.getTime();

      for (;;) {
        // Checked BEFORE the work, never after: afterwards would always allow
        // one scope more than the budget, which on a slow scope is the entire
        // overrun this exists to bound.
        if (now() >= deadline) return;

        const pass = await advanceBackfill({
          scopes,
          state,
          rebuild: deps.rebuild,
        });

        // Nothing outstanding, either because this pass finished the last scope
        // or because there was none to begin with. Returning rather than
        // looping is what lets the sweep go quiet on a finished site instead of
        // re-reading its own progress on every tick for ever.
        if (pass.walked === null || pass.complete) return;
      }
    },
  });
}
