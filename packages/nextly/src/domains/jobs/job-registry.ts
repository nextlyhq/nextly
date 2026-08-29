/**
 * Job types: declaring one, and looking one up.
 *
 * A job row stores a `slug` and an opaque `input`; this is what turns that pair
 * back into code to run. Keeping the registry separate from the runner is what
 * lets a job type be declared where it MEANS something — releases declares
 * `releases:apply`, webhooks declares `webhooks:drain` — while one runner
 * executes all of them.
 *
 * ## The shape, and one deliberate divergence
 *
 * `defineJob({ slug, handler, retry })` and `queue({ task, input, runAt })`
 * follow Payload's jobs API, because a large share of the people evaluating
 * Nextly arrive from it and the concepts should transfer without re-learning.
 *
 * The divergence is `runAt` where Payload spells it `waitUntil`. `waitUntil`
 * reads as a deadline — the point by which something must have happened —
 * when the field is the opposite, the earliest instant at which it may start.
 * Choosing the clearer name is worth a small break from familiarity while the
 * API is still cheap to change.
 *
 * @module domains/jobs/job-registry
 */

import { NextlyError } from "../../errors";
import type { UserContext } from "../collections/services/collection-types";

import type { JobContentApi } from "./job-content-api";
import { MAX_PORTABLE_KEY_LENGTH, MAX_SWEEP_SLUG_LENGTH } from "./portable-key";

/** Attempts a job gets before it is given up on. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * The longest slug every supported dialect can store.
 *
 * MySQL holds the slug in `varchar(191)` — the widest utf8mb4 value it will
 * index — while PostgreSQL and SQLite use unbounded text. Validating here means
 * a slug that is too long is refused when the job type is DEFINED, on every
 * dialect, rather than accepted at definition and failing only at enqueue time
 * and only on MySQL.
 */
export const MAX_JOB_SLUG_LENGTH = MAX_PORTABLE_KEY_LENGTH;

export { SWEEP_KEY_PREFIX, MAX_SWEEP_SLUG_LENGTH } from "./portable-key";

/** What a handler is told about the run it is in. */
export interface JobContext {
  /**
   * The identity this job runs AS, or `null` when it genuinely acts as nobody.
   *
   * `null` does NOT mean "as the system". A job whose stored identity no longer
   * resolves never reaches a handler at all — it fails terminally — so a
   * handler that receives `null` can rely on it meaning the job was queued
   * without an identity in the first place.
   */
  user: UserContext | null;
  /** The instant the runner is treating as now. Injected so a job is testable. */
  now: Date;
  /**
   * Content operations, already bound to `user`.
   *
   * Handed to the handler rather than left for it to construct, because the
   * Direct API defaults to `overrideAccess: true` — so a handler importing
   * `nextly` directly runs with trusted-system authority and the resolved
   * identity above does nothing. Using this is how a job actually acts as the
   * person who queued it.
   *
   * A job that genuinely needs trusted access still imports `nextly` itself.
   * That is then one visible line in the handler instead of an invisible
   * default.
   */
  content: JobContentApi;
  /**
   * The instant the pass running this job intends to stop.
   *
   * The runner cannot enforce it. `maxDurationMs` is checked before each CLAIM,
   * so it bounds how many jobs a pass STARTS and nothing more: once a handler is
   * running, nothing here can interrupt a promise mid-flight, and a cancellation
   * the handler did not cooperate with would abandon whatever it had half-done
   * outside the database.
   *
   * So `run-jobs` names two things that bound a running handler — the lease, and
   * "the handler itself being written to fit a tick". This is what makes the
   * second one possible. Without it the runner asks handlers to fit a budget it
   * never tells them, and every handler that wants to comply has to be handed
   * one out of band, which is a second description of the same number.
   *
   * A handler that ignores it is not wrong; most jobs are short. A handler that
   * walks an unbounded set — every due release, every stale entry — should stop
   * when this passes and leave the rest, because the queue is durable and the
   * next tick continues. **Stopping early must DEFER the remainder, never
   * discharge it:** work that was never attempted produces no failure, and an
   * absent failure reads as success.
   */
  deadline: Date;
}

export interface JobRetryPolicy {
  maxAttempts: number;
}

export interface JobDefinition<TInput = unknown> {
  slug: string;
  handler: (input: TInput, context: JobContext) => Promise<void>;
  retry: JobRetryPolicy;
  /**
   * Whether a trigger should keep one of these queued at all times.
   *
   * A job type is normally queued by whoever wants the work: something happens,
   * a row is written, a pass runs it. A SWEEP has no such moment — it asks a
   * question of the database ("which releases have come due?") at an instant
   * with no request attached, so nothing is ever in a position to enqueue it,
   * and a handler that nothing enqueues is a handler that never runs.
   */
  sweep: boolean;
}

export interface JobDefinitionInput<TInput = unknown> {
  slug: string;
  handler: (input: TInput, context: JobContext) => Promise<void>;
  /** Defaults to {@link DEFAULT_MAX_ATTEMPTS} attempts. */
  retry?: Partial<JobRetryPolicy>;
  /** Keep one queued at all times; see {@link JobDefinition.sweep}. */
  sweep?: boolean;
}

/**
 * Declare a job type.
 *
 * The retry budget is resolved HERE rather than in the runner so that every
 * definition carries a bounded one. A definition that left it undefined would
 * put the runner in the position of inventing a policy the author never chose,
 * and the natural reading of "no budget" — retry forever — turns a permanently
 * failing job into an infinite loop.
 */
export function defineJob<TInput = unknown>(
  input: JobDefinitionInput<TInput>
): JobDefinition<TInput> {
  const slug = input.slug.trim();
  if (slug.length === 0) {
    // The slug is the join between a stored row and the code that runs it, so a
    // blank one stores rows nothing can ever claim.
    throw NextlyError.invalidInput({
      message: "A job type needs a non-empty slug.",
    });
  }

  if (slug.length > MAX_JOB_SLUG_LENGTH) {
    throw NextlyError.invalidInput({
      message: `A job slug may be at most ${MAX_JOB_SLUG_LENGTH} characters.`,
      logContext: { slug, length: slug.length },
    });
  }

  // A sweep is charged for its own dedupe key here, where the slug is refused
  // with a message naming the real budget — rather than at enqueue, which runs
  // on a scheduler tick with nobody watching.
  if (input.sweep && slug.length > MAX_SWEEP_SLUG_LENGTH) {
    throw NextlyError.invalidInput({
      message: `A sweep's slug may be at most ${MAX_SWEEP_SLUG_LENGTH} characters, because its dedupe key is derived from it.`,
      logContext: { slug, length: slug.length },
    });
  }

  const maxAttempts = input.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    // Zero attempts is not "do not retry", it is "never run" — which is
    // indistinguishable from a job nobody enqueued.
    throw NextlyError.invalidInput({
      message: "A job type must allow at least one attempt.",
      logContext: { slug, maxAttempts },
    });
  }

  return {
    slug,
    handler: input.handler,
    retry: { maxAttempts },
    sweep: input.sweep ?? false,
  };
}

/**
 * The job types this instance knows how to run.
 *
 * Registration REFUSES a duplicate slug rather than replacing the incumbent.
 * Replacing would make which handler runs depend on plugin load order, and the
 * losing handler would simply never run with nothing anywhere to say so.
 */
export class JobRegistry {
  private readonly definitions = new Map<string, JobDefinition<never>>();

  register<TInput>(definition: JobDefinition<TInput>): void {
    if (this.definitions.has(definition.slug)) {
      throw NextlyError.invalidInput({
        message: `A job type is already registered for "${definition.slug}".`,
        logContext: { slug: definition.slug },
      });
    }
    // No cast: a handler declared for a specific input accepts `never`, so a
    // JobDefinition<TInput> is already a JobDefinition<never>. Storing them
    // under that type is what lets one registry hold job types with unrelated
    // input shapes while the runner still calls them uniformly.
    this.definitions.set(definition.slug, definition);
  }

  get(slug: string): JobDefinition<never> | undefined {
    return this.definitions.get(slug);
  }

  /**
   * Every registered slug, sorted.
   *
   * Exists so a runner can tell an ORPHANED row — one whose slug was deleted
   * from the code while rows were still queued — from a row it simply has not
   * reached. Without it such a row is skipped on every pass forever, and a
   * queue that quietly never drains looks exactly like an empty one.
   */
  slugs(): string[] {
    return [...this.definitions.keys()].sort();
  }

  /**
   * Every job type that must be kept queued, sorted.
   *
   * Read by a trigger before it drains, so the pass finds the sweep it is about
   * to run. Derived from the definitions rather than listed separately: a
   * second list is a second place to forget a job type, and forgetting it here
   * is invisible — the queue simply stays empty.
   */
  sweeps(): JobDefinition<never>[] {
    return [...this.definitions.values()]
      .filter(definition => definition.sweep)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }
}
