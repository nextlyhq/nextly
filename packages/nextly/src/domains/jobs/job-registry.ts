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

/** Attempts a job gets before it is given up on. */
export const DEFAULT_MAX_ATTEMPTS = 5;

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
}

export interface JobRetryPolicy {
  maxAttempts: number;
}

export interface JobDefinition<TInput = unknown> {
  slug: string;
  handler: (input: TInput, context: JobContext) => Promise<void>;
  retry: JobRetryPolicy;
}

export interface JobDefinitionInput<TInput = unknown> {
  slug: string;
  handler: (input: TInput, context: JobContext) => Promise<void>;
  /** Defaults to {@link DEFAULT_MAX_ATTEMPTS} attempts. */
  retry?: Partial<JobRetryPolicy>;
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

  const maxAttempts = input.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    // Zero attempts is not "do not retry", it is "never run" — which is
    // indistinguishable from a job nobody enqueued.
    throw NextlyError.invalidInput({
      message: "A job type must allow at least one attempt.",
      logContext: { slug, maxAttempts },
    });
  }

  return { slug, handler: input.handler, retry: { maxAttempts } };
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
}
