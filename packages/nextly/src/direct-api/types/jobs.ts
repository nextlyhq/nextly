/**
 * Direct API — background job types.
 *
 * The queue side of the jobs domain: what a caller passes to schedule work, and
 * what they get back. The RUN side (`defineJob`, the registry, the runner) lives
 * in `domains/jobs`; this is only the shape of asking.
 *
 * @module direct-api/types/jobs
 */

import type { GeneratedTypes } from "./shared";

/**
 * A value that survives the round trip through `nextly_jobs.input`.
 *
 * The column is JSON, so a job's input is stored by serialising it and read back
 * by parsing it. Anything whose identity does not survive that is a type saying
 * one thing while the handler receives another: a `Date` comes back a string, a
 * `Map` comes back `{}`, `undefined` comes back `null`, and a `bigint` or a
 * cycle refuses the write outright.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * What a job's input may be: a JSON OBJECT, or nothing.
 *
 * Narrower than "any JSON value", and deliberately. Two reasons, one of them a
 * bug this shape makes unrepresentable:
 *
 * 1. The adapter parses a STRING bound for a JSON column rather than storing it,
 *    to avoid double-encoding. So a genuine string payload that happens to be
 *    valid JSON text — `"123"`, `"true"`, `"{}"` — is stored and delivered as a
 *    number, a boolean or an object, while the handler stays typed `string`.
 *    Refusing bare scalars at the type level removes the case rather than
 *    patching it downstream, which is the only fix that cannot be forgotten.
 * 2. It is what every durable queue converges on. A payload is a named bag of
 *    fields, and an object is the shape that can gain one without breaking every
 *    existing handler — a scalar input has nowhere to grow.
 */
export type JobInput = { [key: string]: JsonValue } | null;

/**
 * A registered job type's slug.
 *
 * Resolved through the SAME `GeneratedTypes` interface that gives
 * `CollectionSlug` and `SingleSlug` their literals, one key further along.
 * Reusing that extension point rather than adding a parallel registry is
 * deliberate: a second augmentation mechanism would be a second thing to
 * discover, a second thing to document, and a second place for the two to
 * disagree about what a project has declared.
 *
 * Unaugmented it is `string`, exactly as collections are. A union would be the
 * stricter choice and the wrong one — job types are declared in code with
 * `defineJob`, so a project that has not augmented anything still has real jobs
 * to queue, and narrowing to `never` would refuse every one of them.
 *
 * @example
 * ```typescript
 * declare module "nextly" {
 *   export interface GeneratedTypes {
 *     jobs: { "email:welcome": { userId: string } };
 *   }
 * }
 * ```
 */
export type JobSlug = GeneratedTypes extends { jobs: infer J }
  ? keyof J & string
  : string;

/**
 * The input a given job type expects.
 *
 * `unknown` rather than `never` when nothing is declared, for the reason above:
 * unconstrained accepts every call, `never` refuses every one.
 */
export type JobInputFor<TTask extends JobSlug> = GeneratedTypes extends {
  jobs: infer J;
}
  ? TTask extends keyof J
    ? // Intersected with `JobInput` rather than returned verbatim. A project can
      // declare `jobs: { report: Date }`, and returning `J[TTask]` unchanged
      // would type-check a value the JSON column cannot hold — the same
      // corruption this type exists to prevent, reintroduced by the
      // augmentation that was meant to make it safer.
      J[TTask] & JobInput
    : JobInput
  : JobInput;

export interface QueueJobArgs<TTask extends JobSlug = JobSlug> {
  /** Which registered job type to run. */
  task: TTask;
  /**
   * The payload handed to the handler.
   *
   * Required rather than optional even for a job that ignores it. A job with no
   * input writes `input: null`, which is one visible character; making it
   * optional would mean an omitted input and an input the caller forgot to
   * compute produce the same row.
   */
  input: JobInputFor<TTask>;
  // NOTE: unaugmented this is `JobInput` — an object or null — rather than
  // `unknown`. `unknown` accepted a `Date`, a `Map` and a bare string, none of
  // which survive the JSON column they are stored in.
  /**
   * When the job becomes eligible to run. `null` or omitted means "as soon as a
   * trigger sees it".
   *
   * `runAt`, deliberately not Payload's `waitUntil`. This names the instant work
   * may START; `waitUntil` reads as a deadline by which it must have finished,
   * which is the opposite guarantee and one this queue does not make.
   */
  runAt?: Date | null;
  /**
   * The id of the user whose authority the job runs with, reconstructed when it
   * runs and failing closed if that user no longer resolves.
   *
   * `null` or omitted means the job acts as NOBODY. It does not mean "as the
   * system": a handler receiving no identity gets a content client with no
   * authority rather than a privileged one.
   *
   * This is the queuer choosing whose authority to spend, so it must never be
   * taken from untrusted input — a request body that reaches this is a
   * privilege escalation with a delay on it.
   */
  runAs?: string | null;
  /**
   * Suppress a duplicate while an equal key is still outstanding.
   *
   * The key is released when the job reaches a terminal state, so this
   * deduplicates work in flight rather than for all time — "one export per
   * document at a time", not "one export ever".
   */
  dedupeKey?: string | null;
}

export interface QueueJobResult {
  /** The job row's id — the existing row's, when `deduped` is true. */
  id: string;
  /** True when an equal `dedupeKey` already held a row and none was created. */
  deduped: boolean;
}
